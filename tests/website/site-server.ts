// Local servers for the website reader tests: nothing here touches the real internet.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FetchEnv } from "@/lib/website/fetch";

export const SITES_DIR = path.resolve(process.cwd(), "test-data/v2/websites");

export interface TestServer {
  origin: string;
  /** Request paths (with query), in arrival order, including /robots.txt. */
  requests: string[];
  /** Request headers of every request, in arrival order. */
  headers: Array<IncomingMessage["headers"]>;
  close(): Promise<void>;
}

/** Fetch settings for tests: the only place allowPrivate is switched on. */
export const LOCAL_ENV: FetchEnv = { allowPrivate: true, timeoutMs: 2000 };

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

export async function serve(handler: Handler): Promise<TestServer> {
  const requests: string[] = [];
  const headers: TestServer["headers"] = [];
  const server: Server = createServer((req, res) => {
    requests.push(req.url ?? "");
    headers.push(req.headers);
    handler(req, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    headers,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".txt": "text/plain; charset=utf-8" };

/** Serves test-data/v2/websites/<site> as a static site. "/" is index.html. */
export function serveSite(site: string, overrides: Record<string, Handler> = {}): Promise<TestServer> {
  return serve((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://x").pathname;
    const override = overrides[pathname];
    if (override) return override(req, res);
    const file = path.join(SITES_DIR, site, pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""));
    if (!file.startsWith(path.join(SITES_DIR, site)) || !existsSync(file)) {
      res.writeHead(404, { "content-type": "text/html" }).end("<h1>Not found</h1>");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
}

export function pathsOf(server: TestServer): string[] {
  return server.requests.map((r) => new URL(r, "http://x").pathname);
}

/**
 * A single-page app: every path answers 200 with the same empty-root shell (test-data/v2/websites/<site>/index.html),
 * except the files robots.txt and sitemap.xml, which are served from the folder when they exist ({{origin}} in them becomes this server's origin).
 */
export async function serveSpa(site: string, overrides: Record<string, Handler> = {}): Promise<TestServer> {
  let origin = "";
  const server = await serve((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://x").pathname;
    const override = overrides[pathname];
    if (override) return override(req, res);
    const dir = path.join(SITES_DIR, site);
    const file = pathname === "/robots.txt" || pathname === "/sitemap.xml" ? path.join(dir, pathname.slice(1)) : path.join(dir, "index.html");
    if (!existsSync(file)) {
      res.writeHead(404, { "content-type": "text/html" }).end("<h1>Not found</h1>");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/xml" });
    res.end(readFileSync(file, "utf8").replaceAll("{{origin}}", origin)); // robots.txt and sitemap.xml may name this server as {{origin}}
  });
  origin = server.origin;
  return server;
}
