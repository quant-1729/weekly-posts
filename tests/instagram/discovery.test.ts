import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFields, discoverInstagram, isInstagramImageHost, mapGraphError, parseDiscovery } from "@/lib/instagram/discovery";
import { DEFAULT_GRAPH_VERSION, instagramConfig, instagramMode } from "@/lib/instagram/config";
import type { InstagramConfig } from "@/lib/instagram/config";

const cfg: InstagramConfig = { version: "v23.0", userId: "17841400000000001", token: "SECRET-TOKEN-123" };

function reply(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as typeof fetch;
}
const err = (code: number, message: string, extra: Record<string, unknown> = {}) => ({ error: { message, type: "OAuthException", code, ...extra } });

const business = (media: unknown[]) => ({
  business_discovery: { username: "cornerbakery", name: "Corner Bakery", followers_count: 900, media_count: media.length, media: { data: media } },
  id: cfg.userId,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("environment", () => {
  it("is unavailable without the id and token, live with both, fixture when asked", () => {
    vi.stubEnv("INSTAGRAM_MODE", "");
    vi.stubEnv("INSTAGRAM_LOOKUP_USER_ID", "");
    vi.stubEnv("INSTAGRAM_LOOKUP_TOKEN", "");
    expect(instagramMode()).toBe("unavailable");
    expect(instagramConfig()).toBeNull();
    vi.stubEnv("INSTAGRAM_LOOKUP_USER_ID", "17841400000000001");
    expect(instagramMode()).toBe("unavailable"); // the token alone is missing
    vi.stubEnv("INSTAGRAM_LOOKUP_TOKEN", "tok");
    expect(instagramMode()).toBe("live");
    expect(instagramConfig()).toEqual({ version: DEFAULT_GRAPH_VERSION, userId: "17841400000000001", token: "tok" });
    vi.stubEnv("META_GRAPH_VERSION", "v24.0");
    expect(instagramConfig()?.version).toBe("v24.0");
    vi.stubEnv("META_GRAPH_VERSION", "latest; drop table");
    expect(instagramConfig()?.version).toBe(DEFAULT_GRAPH_VERSION);
    vi.stubEnv("INSTAGRAM_MODE", "fixture");
    expect(instagramMode()).toBe("fixture");
  });
});

describe("the request", () => {
  it("asks Business Discovery on our account with the handle, the fields and the token", async () => {
    const seen: URL[] = [];
    const f = (async (u: URL) => {
      seen.push(new URL(String(u)));
      return new Response(JSON.stringify(business([])), { status: 200 });
    }) as unknown as typeof fetch;
    await discoverInstagram("cornerbakery", { mode: "live", config: cfg, fetch: f });
    expect(seen).toHaveLength(1);
    expect(seen[0].origin + seen[0].pathname).toBe(`https://graph.facebook.com/v23.0/${cfg.userId}`);
    expect(seen[0].searchParams.get("fields")).toBe(buildFields("cornerbakery"));
    expect(seen[0].searchParams.get("fields")).toContain("business_discovery.username(cornerbakery){username,name,followers_count,media_count,media.limit(25){");
    expect(seen[0].searchParams.get("fields")).toContain("thumbnail_url");
    expect(seen[0].searchParams.get("access_token")).toBe(cfg.token);
  });

  it("refuses a handle that is not a plain Instagram name before calling anything", async () => {
    const f = vi.fn();
    const r = await discoverInstagram("bad)name{", { mode: "live", config: cfg, fetch: f as unknown as typeof fetch });
    expect(r).toEqual({ ok: false, reason: "not_found" });
    expect(f).not.toHaveBeenCalled();
  });

  it("is unavailable without settings and makes no call", async () => {
    const f = vi.fn();
    expect(await discoverInstagram("cornerbakery", { mode: "unavailable", fetch: f as unknown as typeof fetch })).toEqual({ ok: false, reason: "unavailable" });
    expect(await discoverInstagram("cornerbakery", { mode: "live", config: null, fetch: f as unknown as typeof fetch })).toEqual({ ok: false, reason: "unavailable" });
    expect(f).not.toHaveBeenCalled();
  });

  it("gives up when Instagram is too slow and reports a network problem", async () => {
    const f = (async (_u: URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "TimeoutError")));
      })) as unknown as typeof fetch;
    const r = await discoverInstagram("cornerbakery", { mode: "live", config: cfg, fetch: f, timeoutMs: 30 });
    expect(r).toEqual({ ok: false, reason: "network" });
  });

  it("retries once with the sure fields when Meta rejects a field", async () => {
    const urls: string[] = [];
    let n = 0;
    const f = (async (u: URL) => {
      urls.push(new URL(String(u)).searchParams.get("fields") ?? "");
      n += 1;
      return n === 1
        ? new Response(JSON.stringify(err(100, "(#100) Tried accessing nonexisting field (thumbnail_url) on node type (Media)")), { status: 400 })
        : new Response(JSON.stringify(business([{ id: "1", caption: "A caption long enough", media_type: "IMAGE", media_url: "https://scontent.cdninstagram.com/a.jpg" }])), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await discoverInstagram("cornerbakery", { mode: "live", config: cfg, fetch: f });
    expect(r.ok).toBe(true);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("thumbnail_url");
    expect(urls[1]).not.toContain("thumbnail_url");
  });
});

describe("error mapping", () => {
  const cases: Array<[string, number, unknown, string]> = [
    ["a personal account", 400, err(110, "This account is not a business or creator account"), "not_business"],
    ["an age-gated account", 400, err(100, "The account is age restricted and cannot be accessed"), "not_business"],
    ["no such account", 400, err(110, "Invalid user id"), "not_found"],
    ["no such account (other wording)", 400, err(100, "Cannot find that Instagram user"), "not_found"],
    ["HTTP 429", 429, err(4, "Too many calls"), "rate_limited"],
    ["app limit code 4", 400, err(4, "(#4) Application request limit reached"), "rate_limited"],
    ["Instagram limit code 80002", 400, err(80002, "There have been too many calls to this Instagram account."), "rate_limited"],
    ["code 17", 400, err(17, "User request limit reached"), "rate_limited"],
    ["expired token", 400, err(190, "Error validating access token: Session has expired", { error_subcode: 463 }), "token_problem"],
    ["invalid token", 401, err(190, "Invalid OAuth access token."), "token_problem"],
    ["missing permission", 403, err(10, "Application does not have permission for this action"), "token_problem"],
    ["permission code 200", 400, err(200, "(#200) Requires instagram_basic permission"), "token_problem"],
    ["our account id is wrong", 400, err(100, "Unsupported get request. Object with ID '123' does not exist"), "token_problem"],
    ["Meta is down", 500, err(2, "Service temporarily unavailable"), "network"],
    ["an unknown error", 400, err(1, "An unknown error occurred"), "network"],
    ["not JSON", 502, null, "network"],
  ];
  it.each(cases)("maps %s", async (_name, status, body, reason) => {
    expect(mapGraphError(status, body)).toBe(status >= 500 ? "network" : reason);
    const r = await discoverInstagram("cornerbakery", { mode: "live", config: cfg, fetch: reply(status, body) });
    expect(r).toEqual({ ok: false, reason });
  });

  it("treats a 200 with no account as not found", async () => {
    const r = await discoverInstagram("cornerbakery", { mode: "live", config: cfg, fetch: reply(200, { id: cfg.userId }) });
    expect(r).toEqual({ ok: false, reason: "not_found" });
  });

  it("maps a thrown network error and never puts the token in a log or a result", async () => {
    const logs: unknown[] = [];
    const spies = (["log", "warn", "error", "info", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation((...a) => void logs.push(a)));
    const boom = (async () => {
      throw new TypeError(`fetch failed for https://graph.facebook.com/v23.0/x?access_token=${cfg.token}`);
    }) as unknown as typeof fetch;
    const r = await discoverInstagram("cornerbakery", { mode: "live", config: cfg, fetch: boom });
    const bad = await discoverInstagram("cornerbakery", { mode: "live", config: cfg, fetch: reply(400, err(190, `bad token ${cfg.token}`)) });
    spies.forEach((s) => s.mockRestore());
    expect(r).toEqual({ ok: false, reason: "network" });
    expect(bad).toEqual({ ok: false, reason: "token_problem" });
    expect(JSON.stringify(r)).not.toContain(cfg.token);
    expect(JSON.stringify(bad)).not.toContain(cfg.token);
    expect(JSON.stringify(logs)).not.toContain(cfg.token);
  });
});

describe("reading the media", () => {
  it("reads a business account with its posts", async () => {
    const r = await discoverInstagram("cornerbakery", {
      mode: "live",
      config: cfg,
      fetch: reply(
        200,
        business([
          { id: "111", caption: "Fresh bread today!", media_type: "IMAGE", media_url: "https://scontent.cdninstagram.com/1.jpg", permalink: "https://www.instagram.com/p/AAA/", timestamp: "2026-10-10T09:30:00+0000" },
        ]),
      ),
    });
    expect(r).toEqual({
      ok: true,
      account: { username: "cornerbakery", name: "Corner Bakery", followers: 900, mediaCount: 1 },
      media: [
        {
          id: "111",
          caption: "Fresh bread today!",
          mediaType: "IMAGE",
          permalink: "https://www.instagram.com/p/AAA/",
          postedAt: "2026-10-10T09:30:00.000Z",
          imageUrl: "https://scontent.cdninstagram.com/1.jpg",
        },
      ],
    });
  });

  it("copes with a missing caption, missing fields and an account with no media", () => {
    const parsed = parseDiscovery(
      business([
        { id: "1", media_type: "IMAGE", media_url: "https://scontent.cdninstagram.com/1.jpg" },
        { id: "2", caption: "   ", media_type: "IMAGE" },
        { id: "3", caption: "x", media_type: "IMAGE", permalink: "https://evil.example/p/1", timestamp: "not a date" },
        { caption: "no id at all" },
        "junk",
        null,
      ]),
    )!;
    expect(parsed.media.map((m) => m.id)).toEqual(["1", "2", "3"]);
    expect(parsed.media[0]).toMatchObject({ caption: null, permalink: null, postedAt: null });
    expect(parsed.media[1]).toMatchObject({ caption: null, imageUrl: null });
    expect(parsed.media[2]).toMatchObject({ permalink: null, postedAt: null });
    expect(parseDiscovery({ business_discovery: { username: "quiet" } })!.media).toEqual([]);
    expect(parseDiscovery({ business_discovery: { name: "no username" } })).toBeNull();
    expect(parseDiscovery({})).toBeNull();
  });

  it("uses a video's thumbnail, never the video file", () => {
    const parsed = parseDiscovery(
      business([
        { id: "v1", caption: "Watch us bake", media_type: "VIDEO", media_url: "https://video.cdninstagram.com/clip.mp4", thumbnail_url: "https://scontent.cdninstagram.com/thumb.jpg" },
        { id: "v2", caption: "No thumbnail", media_type: "VIDEO", media_url: "https://video.cdninstagram.com/clip2.mp4" },
      ]),
    )!;
    expect(parsed.media[0].imageUrl).toBe("https://scontent.cdninstagram.com/thumb.jpg");
    expect(parsed.media[1].imageUrl).toBeNull();
  });

  it("uses a carousel's first image child, skipping videos, and falls back to the cover", () => {
    const parsed = parseDiscovery(
      business([
        {
          id: "c1",
          caption: "Three loaves",
          media_type: "CAROUSEL_ALBUM",
          media_url: "https://scontent.cdninstagram.com/cover.jpg",
          children: {
            data: [
              { media_type: "VIDEO", media_url: "https://video.cdninstagram.com/c.mp4" },
              { media_type: "IMAGE", media_url: "https://scontent.cdninstagram.com/second.jpg" },
              { media_type: "IMAGE", media_url: "https://scontent.cdninstagram.com/third.jpg" },
            ],
          },
        },
        { id: "c2", caption: "No children", media_type: "CAROUSEL_ALBUM", media_url: "https://scontent.cdninstagram.com/cover2.jpg" },
      ]),
    )!;
    expect(parsed.media[0]).toMatchObject({ mediaType: "CAROUSEL_ALBUM", imageUrl: "https://scontent.cdninstagram.com/second.jpg" });
    expect(parsed.media[1].imageUrl).toBe("https://scontent.cdninstagram.com/cover2.jpg");
  });

  it("only trusts https picture addresses", () => {
    const parsed = parseDiscovery(business([{ id: "p1", caption: "x", media_type: "IMAGE", media_url: "http://scontent.cdninstagram.com/1.jpg" }]))!;
    expect(parsed.media[0].imageUrl).toBeNull();
  });
});

describe("isInstagramImageHost", () => {
  it("accepts Instagram's picture hosts over https only", () => {
    expect(isInstagramImageHost("https://scontent-lhr8-1.cdninstagram.com/v/t51/a.jpg?x=1")).toBe(true);
    expect(isInstagramImageHost("https://instagram.fabc1-1.fna.fbcdn.net/v/a.jpg")).toBe(true);
    expect(isInstagramImageHost("http://scontent.cdninstagram.com/a.jpg")).toBe(false);
    expect(isInstagramImageHost("https://cdninstagram.com.evil.example/a.jpg")).toBe(false);
    expect(isInstagramImageHost("https://evilcdninstagram.com/a.jpg")).toBe(false);
    expect(isInstagramImageHost("https://user:pw@scontent.cdninstagram.com/a.jpg")).toBe(false);
    expect(isInstagramImageHost("https://169.254.169.254/latest")).toBe(false);
    expect(isInstagramImageHost("data:image/png;base64,AAAA")).toBe(false);
    expect(isInstagramImageHost("not a url")).toBe(false);
  });
});
