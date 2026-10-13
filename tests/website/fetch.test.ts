import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchError, safeFetch, type FetchEnv, type Transport, type TransportResponse } from "@/lib/website/fetch";
import { classifyIp } from "@/lib/website/ip";
import { LOCAL_ENV, serve, type TestServer } from "./site-server";

const PUBLIC_IP = "93.184.216.34";
const publicResolver = async () => [{ address: PUBLIC_IP, family: 4 }];

function htmlResponse(body: string, headers: Record<string, string> = {}): TransportResponse {
  return {
    status: 200,
    headers: { "content-type": "text/html", ...headers },
    readBody: async () => ({ body: Buffer.from(body), truncated: false }),
    destroy() {},
  };
}
function redirectResponse(location: string, status = 302): TransportResponse {
  return { status, headers: { location }, readBody: async () => ({ body: Buffer.alloc(0), truncated: false }), destroy() {} };
}

/** A transport that must never be reached: proves a request was refused before any connection. */
function neverTransport() {
  return vi.fn<Transport>(async () => {
    throw new Error("transport must not be called");
  });
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof FetchError) return e.code;
    throw e;
  }
  return "no error";
}

describe("classifyIp", () => {
  it.each([
    ["8.8.8.8"],
    ["93.184.216.34"],
    ["1.1.1.1"],
    ["172.32.0.1"], // just outside 172.16/12
    ["100.128.0.1"], // just outside CGNAT
    ["2606:4700:4700::1111"],
    ["::ffff:8.8.8.8"],
  ])("accepts public %s", (ip) => {
    expect(classifyIp(ip).ok).toBe(true);
  });

  it.each([
    ["0.0.0.0"],
    ["10.0.0.1"],
    ["10.255.255.255"],
    ["100.64.0.1"],
    ["100.100.100.200"],
    ["127.0.0.1"],
    ["127.255.255.254"],
    ["169.254.169.254"],
    ["169.254.170.2"],
    ["172.16.0.1"],
    ["172.31.255.255"],
    ["192.0.0.192"],
    ["192.168.0.1"],
    ["198.18.0.1"],
    ["224.0.0.1"],
    ["239.255.255.250"],
    ["240.0.0.1"],
    ["255.255.255.255"],
    ["::"],
    ["::1"],
    ["::ffff:127.0.0.1"],
    ["::ffff:7f00:1"],
    ["::ffff:169.254.169.254"],
    ["::ffff:10.0.0.1"],
    ["::127.0.0.1"],
    ["fe80::1"],
    ["fc00::1"],
    ["fd00:ec2::254"], // AWS IPv6 metadata
    ["ff02::1"],
    ["2001:db8::1"],
    ["2002:7f00:1::1"],
    ["64:ff9b::7f00:1"], // NAT64 of 127.0.0.1
    ["not-an-ip"],
    ["fe80::1%eth0"],
  ])("refuses %s", (ip) => {
    expect(classifyIp(ip).ok).toBe(false);
  });
});

describe("SSRF: nothing is connected to", () => {
  const refused: Array<[string, string, string]> = [
    ["127.0.0.1", "http://127.0.0.1/", "blocked_address"],
    ["127.0.0.1 with the standard port", "http://127.0.0.1:80/admin", "blocked_address"],
    ["10.x", "http://10.1.2.3/", "blocked_address"],
    ["172.16.x", "https://172.16.0.5/", "blocked_address"],
    ["192.168.x", "http://192.168.1.1/", "blocked_address"],
    ["cloud metadata 169.254.169.254", "http://169.254.169.254/latest/meta-data/", "blocked_address"],
    ["IPv6 loopback [::1]", "http://[::1]/", "blocked_address"],
    ["IPv4-mapped IPv6 ::ffff:127.0.0.1", "http://[::ffff:127.0.0.1]/", "blocked_address"],
    ["IPv4-mapped IPv6 metadata", "http://[::ffff:169.254.169.254]/", "blocked_address"],
    ["AWS IPv6 metadata", "http://[fd00:ec2::254]/", "blocked_address"],
    ["link-local IPv6", "http://[fe80::1]/", "blocked_address"],
    ["decimal IPv4 2130706433", "http://2130706433/", "blocked_address"],
    ["hex IPv4 0x7f000001", "http://0x7f000001/", "blocked_address"],
    ["unspecified 0.0.0.0", "http://0.0.0.0/", "blocked_address"],
    ["CGNAT", "http://100.64.0.1/", "blocked_address"],
    ["multicast", "http://224.0.0.1/", "blocked_address"],
    ["localhost", "http://localhost/", "blocked_address"],
    ["sub.localhost", "http://app.localhost/", "blocked_address"],
    ["metadata.google.internal", "http://metadata.google.internal/", "blocked_address"],
    ["port 8080", "http://example.com:8080/", "bad_port"],
    ["port 22 over https", "https://example.com:22/", "bad_port"],
    ["file:", "file:///etc/passwd", "bad_scheme"],
    ["ftp:", "ftp://example.com/file", "bad_scheme"],
    ["javascript:", "javascript:alert(1)", "bad_scheme"],
    ["data:", "data:text/html,hello", "bad_scheme"],
    ["user:pass@ credentials", "http://user:pass@example.com/", "bad_url"],
    ["user@ only", "https://admin@example.com/", "bad_url"],
    ["not a URL", "not a url", "bad_url"],
  ];

  it.each(refused)("refuses %s", async (_name, url, code) => {
    const transport = neverTransport();
    expect(await codeOf(safeFetch(url, { accept: "text/html", resolver: publicResolver, transport }))).toBe(code);
    expect(transport).not.toHaveBeenCalled();
  });

  it("refuses a hostname that resolves to a private IP", async () => {
    const transport = neverTransport();
    const resolver = async () => [{ address: "10.0.0.7", family: 4 }];
    expect(await codeOf(safeFetch("https://innocent.example/", { accept: "text/html", resolver, transport }))).toBe("blocked_address");
    expect(transport).not.toHaveBeenCalled();
  });

  it("refuses a hostname when ANY resolved address is private", async () => {
    const transport = neverTransport();
    const resolver = async () => [
      { address: PUBLIC_IP, family: 4 },
      { address: "::1", family: 6 },
    ];
    expect(await codeOf(safeFetch("https://mixed.example/", { accept: "text/html", resolver, transport }))).toBe("blocked_address");
    expect(transport).not.toHaveBeenCalled();
  });

  it("refuses a hostname that resolves to an IPv4-mapped loopback address", async () => {
    const transport = neverTransport();
    const resolver = async () => [{ address: "::ffff:127.0.0.1", family: 6 }];
    expect(await codeOf(safeFetch("https://mapped.example/", { accept: "text/html", resolver, transport }))).toBe("blocked_address");
  });

  it("reports an unresolvable host as dns, without connecting", async () => {
    const transport = neverTransport();
    const resolver = async () => {
      throw new Error("ENOTFOUND");
    };
    expect(await codeOf(safeFetch("https://nope.example/", { accept: "text/html", resolver, transport }))).toBe("dns");
    expect(transport).not.toHaveBeenCalled();
  });

  it("refuses a redirect to a private IP and never connects to it", async () => {
    const transport = vi.fn<Transport>(async () => redirectResponse("http://169.254.169.254/latest/meta-data/"));
    expect(await codeOf(safeFetch("http://good.example/", { accept: "text/html", resolver: publicResolver, transport }))).toBe("blocked_address");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect to a name that resolves to a private IP", async () => {
    const resolver = async (host: string) => (host === "evil.example" ? [{ address: "192.168.0.10", family: 4 }] : [{ address: PUBLIC_IP, family: 4 }]);
    const transport = vi.fn<Transport>(async () => redirectResponse("https://evil.example/"));
    expect(await codeOf(safeFetch("https://good.example/", { accept: "text/html", resolver, transport }))).toBe("blocked_address");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["file:", "file:///etc/passwd", "bad_scheme"],
    ["a non-standard port", "https://good.example:8443/", "bad_port"],
    ["credentials", "https://u:p@good.example/", "bad_url"],
  ])("refuses a redirect to %s", async (_n, location, code) => {
    const transport = vi.fn<Transport>(async () => redirectResponse(location));
    expect(await codeOf(safeFetch("https://good.example/", { accept: "text/html", resolver: publicResolver, transport }))).toBe(code);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect from https down to http", async () => {
    const transport = vi.fn<Transport>(async () => redirectResponse("http://good.example/plain"));
    expect(await codeOf(safeFetch("https://good.example/", { accept: "text/html", resolver: publicResolver, transport }))).toBe("bad_redirect");
  });

  it("connects to the IP it checked, not to a second DNS answer (DNS rebinding)", async () => {
    let calls = 0;
    // First answer is public, any later answer would be loopback.
    const resolver = async () => (++calls === 1 ? [{ address: PUBLIC_IP, family: 4 }] : [{ address: "127.0.0.1", family: 4 }]);
    const transport = vi.fn<Transport>(async () => htmlResponse("<p>ok</p>"));
    await safeFetch("https://rebind.example/page", { accept: "text/html", resolver, transport });
    expect(transport).toHaveBeenCalledTimes(1);
    const req = transport.mock.calls[0][0];
    expect(req.ip).toBe(PUBLIC_IP);
    expect(req.url.hostname).toBe("rebind.example"); // Host and TLS name stay the name
    expect(calls).toBe(1);
  });

  it("re-resolves and re-checks on every redirect hop", async () => {
    const seen: string[] = [];
    const resolver = async (host: string) => {
      seen.push(host);
      return [{ address: PUBLIC_IP, family: 4 }];
    };
    let n = 0;
    const transport = vi.fn<Transport>(async () => (n++ === 0 ? redirectResponse("https://www.good.example/") : htmlResponse("<p>ok</p>")));
    const res = await safeFetch("https://good.example/", { accept: "text/html", resolver, transport });
    expect(seen).toEqual(["good.example", "www.good.example"]);
    expect(res.url).toBe("https://www.good.example/");
    expect(res.redirects).toEqual(["https://www.good.example/"]);
  });

  it("follows at most 3 redirects", async () => {
    let n = 0;
    const transport = vi.fn<Transport>(async () => redirectResponse(`https://good.example/r${++n}`));
    expect(await codeOf(safeFetch("https://good.example/", { accept: "text/html", resolver: publicResolver, transport }))).toBe("too_many_redirects");
    expect(transport).toHaveBeenCalledTimes(4); // the original request plus 3 followed redirects

    let m = 0;
    const ok = vi.fn<Transport>(async () => (m++ < 3 ? redirectResponse(`https://good.example/r${m}`) : htmlResponse("<p>done</p>")));
    const res = await safeFetch("https://good.example/", { accept: "text/html", resolver: publicResolver, transport: ok });
    expect(res.text).toBe("<p>done</p>");
  });

  it("allowPrivate defaults to off, and is refused in production", async () => {
    const transport = neverTransport();
    expect(await codeOf(safeFetch("http://127.0.0.1/", { accept: "text/html", transport }))).toBe("blocked_address");
    vi.stubEnv("NODE_ENV", "production");
    try {
      await expect(safeFetch("http://127.0.0.1/", { accept: "text/html", allowPrivate: true, transport })).rejects.toThrow(/tests only/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("is not switched on by an environment variable", async () => {
    vi.stubEnv("ALLOW_PRIVATE", "true");
    vi.stubEnv("WEBSITE_ALLOW_PRIVATE", "1");
    try {
      const transport = neverTransport();
      expect(await codeOf(safeFetch("http://10.0.0.1/", { accept: "text/html", transport }))).toBe("blocked_address");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("requests", () => {
  it("sends the WeeklyPostsBot user agent", async () => {
    const transport = vi.fn<Transport>(async () => htmlResponse("<p>ok</p>"));
    await safeFetch("https://good.example/", { accept: "text/html", resolver: publicResolver, transport });
    const ua = transport.mock.calls[0][0].headers["User-Agent"];
    expect(ua).toMatch(/^WeeklyPostsBot\/1\.0 \(\+https?:\/\/[^)]+\/bot\)$/);
  });

  it("uses the app URL from the environment in the user agent", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://weeklyposts.example/");
    try {
      const transport = vi.fn<Transport>(async () => htmlResponse("<p>ok</p>"));
      await safeFetch("https://good.example/", { accept: "text/html", resolver: publicResolver, transport });
      expect(transport.mock.calls[0][0].headers["User-Agent"]).toBe("WeeklyPostsBot/1.0 (+https://weeklyposts.example/bot)");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("tries the next checked address when the first does not connect", async () => {
    const resolver = async () => [
      { address: "2606:4700:4700::1111", family: 6 },
      { address: PUBLIC_IP, family: 4 },
    ];
    const tried: string[] = [];
    const transport = vi.fn<Transport>(async (req) => {
      tried.push(req.ip);
      if (req.ip === PUBLIC_IP) throw new Error("ECONNREFUSED");
      return htmlResponse("<p>via v6</p>");
    });
    const res = await safeFetch("https://dual.example/", { accept: "text/html", resolver, transport });
    expect(tried).toEqual([PUBLIC_IP, "2606:4700:4700::1111"]); // IPv4 first
    expect(res.text).toBe("<p>via v6</p>");
  });
});

describe("limits (real connections to a local server)", () => {
  let server: TestServer | null = null;
  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it("connects to the checked IP and keeps the host name in the Host header", async () => {
    server = await serve((_req, res) => res.writeHead(200, { "content-type": "text/html" }).end("<p>hello</p>"));
    const port = new URL(server.origin).port;
    const env: FetchEnv = { ...LOCAL_ENV, resolver: async () => [{ address: "127.0.0.1", family: 4 }] };
    const res = await safeFetch(`http://site.test:${port}/page?x=1`, { ...env, accept: "text/html" });
    expect(res.text).toBe("<p>hello</p>");
    expect(server.headers[0].host).toBe(`site.test:${port}`);
    expect(server.requests[0]).toBe("/page?x=1");
    expect(String(server.headers[0]["user-agent"])).toMatch(/^WeeklyPostsBot\/1\.0/);
  });

  it("cuts an oversize body off at 1.5 MB", async () => {
    server = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      const chunk = "<p>" + "x".repeat(60_000) + "</p>";
      let sent = 0;
      const write = () => {
        while (sent < 6_000_000) {
          sent += chunk.length;
          if (!res.write(chunk)) return void res.once("drain", write);
        }
        res.end();
      };
      write();
    });
    const res = await safeFetch(`${server.origin}/big`, { ...LOCAL_ENV, accept: "text/html" });
    expect(res.truncated).toBe(true);
    expect(res.text.length).toBe(1_500_000);
  });

  it("cuts a gzip body off by its decompressed size", async () => {
    const bomb = gzipSync(Buffer.from("<p>" + "a".repeat(5_000_000) + "</p>"));
    server = await serve((_req, res) => res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" }).end(bomb));
    const res = await safeFetch(`${server.origin}/`, { ...LOCAL_ENV, accept: "text/html" });
    expect(res.truncated).toBe(true);
    expect(res.text.length).toBe(1_500_000);
  });

  it("reads a normal gzip page", async () => {
    server = await serve((_req, res) => res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" }).end(gzipSync("<p>zipped</p>")));
    expect((await safeFetch(`${server.origin}/`, { ...LOCAL_ENV, accept: "text/html" })).text).toBe("<p>zipped</p>");
  });

  it("times out when the server never answers", async () => {
    server = await serve(() => {
      /* never respond */
    });
    const t = Date.now();
    expect(await codeOf(safeFetch(`${server.origin}/`, { ...LOCAL_ENV, timeoutMs: 300, accept: "text/html" }))).toBe("timeout");
    expect(Date.now() - t).toBeLessThan(3000);
  });

  it("times out when the body stalls after the headers", async () => {
    server = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.write("<p>start");
    });
    expect(await codeOf(safeFetch(`${server.origin}/`, { ...LOCAL_ENV, timeoutMs: 300, accept: "text/html" }))).toBe("timeout");
  });

  it("the default timeout is 8 seconds", async () => {
    const { FETCH_TIMEOUT_MS, MAX_BODY_BYTES, MAX_REDIRECTS } = await import("@/lib/website/fetch");
    expect([FETCH_TIMEOUT_MS, MAX_BODY_BYTES, MAX_REDIRECTS]).toEqual([8000, 1_500_000, 3]);
  });

  it.each([
    ["application/json", '{"a":1}'],
    ["image/png", "PNG"],
    ["application/pdf", "%PDF"],
    ["text/plain", "just text"],
  ])("refuses %s as a page", async (type, body) => {
    server = await serve((_req, res) => res.writeHead(200, { "content-type": type }).end(body));
    expect(await codeOf(safeFetch(`${server.origin}/`, { ...LOCAL_ENV, accept: "text/html" }))).toBe("wrong_content_type");
  });

  it("refuses a page with no content type", async () => {
    server = await serve((_req, res) => {
      res.writeHead(200);
      res.end("<p>hi</p>");
    });
    expect(await codeOf(safeFetch(`${server.origin}/`, { ...LOCAL_ENV, accept: "text/html" }))).toBe("wrong_content_type");
  });

  it("accepts only text/plain for robots.txt", async () => {
    server = await serve((_req, res) => res.writeHead(200, { "content-type": "text/html" }).end("<p>nope</p>"));
    expect(await codeOf(safeFetch(`${server.origin}/robots.txt`, { ...LOCAL_ENV, accept: "text/plain" }))).toBe("wrong_content_type");
  });

  it("returns the status for non-2xx responses without reading a body", async () => {
    server = await serve((_req, res) => res.writeHead(404, { "content-type": "text/html" }).end("<h1>gone</h1>"));
    const res = await safeFetch(`${server.origin}/missing`, { ...LOCAL_ENV, accept: "text/html" });
    expect(res.status).toBe(404);
    expect(res.text).toBe("");
  });

  it("follows redirects on a real connection and reports the final URL", async () => {
    server = await serve((req, res) => {
      if (req.url === "/old") return void res.writeHead(301, { location: "/new" }).end();
      res.writeHead(200, { "content-type": "text/html" }).end("<p>new</p>");
    });
    const res = await safeFetch(`${server.origin}/old`, { ...LOCAL_ENV, accept: "text/html" });
    expect(res.url).toBe(`${server.origin}/new`);
    expect(res.redirects).toEqual([`${server.origin}/new`]);
    expect(server.requests).toEqual(["/old", "/new"]);
  });

  it("decodes the declared charset", async () => {
    server = await serve((_req, res) => res.writeHead(200, { "content-type": "text/html; charset=iso-8859-1" }).end(Buffer.from([0x3c, 0x70, 0x3e, 0x63, 0x61, 0x66, 0xe9, 0x3c, 0x2f, 0x70, 0x3e])));
    expect((await safeFetch(`${server.origin}/`, { ...LOCAL_ENV, accept: "text/html" })).text).toBe("<p>café</p>");
  });
});
