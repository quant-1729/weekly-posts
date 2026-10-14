import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTokenKeyForTests } from "@/lib/connections/crypto";
import { getConnection, saveConnection } from "@/lib/connections/service";
import type { MockDb } from "@/lib/db/mock";
import { listOutbox } from "@/lib/email/outbox";
import { createPublisher } from "@/lib/publish";
import { POLL_TIMEOUT_MS } from "@/lib/publish/instagram";
import { createMockStorage } from "@/lib/storage/mock";
import {
  closeDb,
  fakeFetch,
  graphError,
  makeOwner,
  openDb,
  stubMetaEnv,
  when,
  type Call,
  type Handler,
  type Owner,
  type Reply,
} from "../connections/helpers";
import { publicStorage, queueRow, seedPost, type SeedPost } from "./helpers";

let db: MockDb;
let owner: Owner;

const IG = "17841400000000001";
const IG_TOKEN = "IGAAlong-lived-token-ZZZZ1234567890";
const FB_TOKEN = "EAAPageAccessToken-QQQQ1234567890";
const PAGE = "1001";
const FEED = "https://graph.instagram.com";

beforeAll(async () => {
  db = await openDb();
});
afterAll(async () => {
  await closeDb(db);
});
beforeEach(async () => {
  stubMetaEnv();
  resetTokenKeyForTests();
  owner = await makeOwner(db);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const connectIg = (expiresInDays = 40) =>
  saveConnection({ brandId: owner.brandId, userId: owner.userId, provider: "instagram", accountId: IG, accountName: "@cornerbakery", scopes: [], platformUserId: null, expiresAt: new Date(Date.now() + expiresInDays * 86400_000), token: IG_TOKEN });
const connectFb = () =>
  saveConnection({ brandId: owner.brandId, userId: owner.userId, provider: "facebook", accountId: PAGE, accountName: "Corner Bakery", scopes: [], platformUserId: null, expiresAt: null, token: FB_TOKEN });

/** The Instagram API as it behaves when everything works. Container ids are C1, C2, ... */
function igOk(o: { quotaUsage?: number; statuses?: Reply[]; extra?: Handler[] } = {}): Handler[] {
  let n = 0;
  return [
    ...(o.extra ?? []),
    when("GET", /\/content_publishing_limit$/, { body: { data: [{ quota_usage: o.quotaUsage ?? 2, config: { quota_total: 100, quota_duration: 86400 } }] } }),
    when("POST", /\/media$/, () => ({ body: { id: `C${++n}` } })),
    when("GET", /\/C\d+$/, o.statuses ?? { body: { status_code: "FINISHED" } }),
    when("POST", /\/media_publish$/, { body: { id: "M1" } }),
    when("GET", /\/M1$/, { body: { permalink: "https://www.instagram.com/p/ABC123/" } }),
  ];
}

function fbOk(extra: Handler[] = []): Handler[] {
  let n = 0;
  return [
    ...extra,
    when("POST", /\/photos$/, (c: Call) => (c.params.get("published") === "false" ? { body: { id: `P${++n}` } } : { body: { id: "555", post_id: `${PAGE}_555` } })),
    when("POST", /\/feed$/, { body: { id: `${PAGE}_777` } }),
    when("GET", /\/1001_\d+$/, (c: Call) => ({ body: { permalink_url: `https://www.facebook.com${c.path.replace(/^\/v[\d.]+/, "").replace(/^\/1001_/, "/Page/posts/")}` } })),
  ];
}

function publisher(handlers: Handler[], extra: { now?: () => Date; storage?: ReturnType<typeof publicStorage> } = {}) {
  const f = fakeFetch(handlers);
  const sleeps: number[] = [];
  const publish = createPublisher({ fetch: f.fetch, sleep: async (ms) => void sleeps.push(ms), storage: extra.storage ?? publicStorage(), now: extra.now });
  return { publish, calls: f.calls, sleeps };
}

async function run(seed: SeedPost, handlers: Handler[], extra: Parameters<typeof publisher>[1] = {}) {
  const s = await seedPost(db, owner, seed);
  const p = publisher(handlers, extra);
  const result = await p.publish({ itemId: s.itemId, brandId: owner.brandId });
  return { result, seeded: s, ...p };
}

describe("Instagram: one picture", () => {
  it("creates a container from a signed URL of the portrait picture, polls until FINISHED, publishes and returns the permalink", async () => {
    await connectIg();
    const { result, calls, sleeps, seeded } = await run(
      { images: { square: "square.png", portrait: "portrait.png", vertical: "vertical.png" }, caption: "Fresh sourdough today.", hashtags: ["bakery", "#sourdough"] },
      igOk({ statuses: [{ body: { status_code: "IN_PROGRESS" } }, { body: { status_code: "IN_PROGRESS" } }, { body: { status_code: "FINISHED" } }] }),
    );
    expect(result).toEqual({ ok: true, platformPostId: "M1", permalink: "https://www.instagram.com/p/ABC123/" });

    expect(calls.map((c) => `${c.method} ${c.path.replace(/^\/v23\.0/, "")}`)).toEqual([
      `GET /${IG}/content_publishing_limit`,
      `POST /${IG}/media`,
      "GET /C1",
      "GET /C1",
      "GET /C1",
      `POST /${IG}/media_publish`,
      "GET /M1",
    ]);
    const create = calls.find((c) => c.method === "POST" && c.path.endsWith("/media"))!;
    expect(create.host).toBe("graph.instagram.com");
    expect(create.params.get("image_url")).toBe(`https://storage.example.com/renders/${owner.brandId}/${seeded.postId}/portrait.png?X-Expires=3600&sig=abc`);
    expect(create.params.get("caption")).toBe("Fresh sourdough today.\n\n#bakery #sourdough");
    expect(create.params.get("media_type")).toBeNull();
    expect(create.params.get("access_token")).toBe(IG_TOKEN); // sent to Meta (in the form body), not logged
    expect(calls.find((c) => c.path.endsWith("/media_publish"))!.params.get("creation_id")).toBe("C1");
    // Backoff between status checks grows.
    expect(sleeps).toHaveLength(2);
    expect(sleeps[1]).toBeGreaterThan(sleeps[0]);
  });

  it("uses the square picture when there is no portrait one", async () => {
    await connectIg();
    const { result, calls, seeded } = await run({ images: { square: "square.png", landscape: "l.png" } }, igOk());
    expect(result.ok).toBe(true);
    expect(calls.find((c) => c.path.endsWith("/media"))!.params.get("image_url")).toContain(`${seeded.postId}/square.png`);
  });

  it("works when Meta does not return a permalink", async () => {
    await connectIg();
    const { result } = await run({}, igOk({ extra: [when("GET", /\/M1$/, graphError(100, "nope"))] }));
    expect(result).toEqual({ ok: true, platformPostId: "M1", permalink: null });
  });
});

describe("Instagram: story", () => {
  it("posts a vertical-only post as a story, without a caption", async () => {
    await connectIg();
    const { result, calls, seeded } = await run({ images: { vertical: "vertical.png" } }, igOk());
    expect(result.ok).toBe(true);
    const create = calls.find((c) => c.path.endsWith("/media"))!;
    expect(create.params.get("media_type")).toBe("STORIES");
    expect(create.params.get("image_url")).toContain(`${seeded.postId}/vertical.png`);
    expect(create.params.has("caption")).toBe(false);
  });
});

describe("Instagram: carousel", () => {
  it("makes a child container per slide, then a CAROUSEL container, then publishes", async () => {
    await connectIg();
    const { result, calls, seeded } = await run(
      { images: { square: "square.png" }, slides: [{ square: "s0.png" }, { square: "s1.png" }, { square: "s2.png" }], caption: "Three things we love", hashtags: ["bakery"] },
      igOk(),
    );
    expect(result).toEqual({ ok: true, platformPostId: "M1", permalink: "https://www.instagram.com/p/ABC123/" });
    const creates = calls.filter((c) => c.method === "POST" && c.path.endsWith("/media"));
    expect(creates).toHaveLength(4);
    creates.slice(0, 3).forEach((c, i) => {
      expect(c.params.get("is_carousel_item")).toBe("true");
      expect(c.params.get("image_url")).toContain(`${seeded.slideIds[i]}/s${i}.png`);
      expect(c.params.has("caption")).toBe(false);
    });
    const parent = creates[3];
    expect(parent.params.get("media_type")).toBe("CAROUSEL");
    expect(parent.params.get("children")).toBe("C1,C2,C3");
    expect(parent.params.get("caption")).toBe("Three things we love\n\n#bakery");
    expect(calls.find((c) => c.path.endsWith("/media_publish"))!.params.get("creation_id")).toBe("C4");
  });
});

describe("Facebook Page", () => {
  it("posts one photo with its caption using the Page token", async () => {
    await connectFb();
    const { result, calls, seeded } = await run({ channel: "facebook", images: { square: "square.png", vertical: "v.png" }, caption: "Open late tonight", hashtags: ["bakery"] }, fbOk());
    expect(result).toEqual({ ok: true, platformPostId: `${PAGE}_555`, permalink: "https://www.facebook.com/Page/posts/555" });
    const photo = calls.find((c) => c.method === "POST")!;
    expect(photo.host).toBe("graph.facebook.com");
    expect(photo.path).toBe(`/v23.0/${PAGE}/photos`);
    expect(photo.params.get("url")).toContain(`${seeded.postId}/square.png`);
    expect(photo.params.get("message")).toBe("Open late tonight\n\n#bakery");
    expect(photo.params.get("access_token")).toBe(FB_TOKEN);
  });

  it("posts a carousel as unpublished photos then one feed post with attached_media", async () => {
    await connectFb();
    const { result, calls } = await run({ channel: "facebook", images: { square: "q.png" }, slides: [{ square: "a.png" }, { square: "b.png" }], caption: "Two favourites", hashtags: [] }, fbOk());
    expect(result.ok && result.platformPostId).toBe(`${PAGE}_777`);
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts.map((c) => c.path.replace(/^\/v23\.0\//, ""))).toEqual([`${PAGE}/photos`, `${PAGE}/photos`, `${PAGE}/feed`]);
    expect(posts[0].params.get("published")).toBe("false");
    expect(posts[1].params.get("published")).toBe("false");
    const feed = posts[2];
    expect(feed.params.get("message")).toBe("Two favourites");
    expect(feed.params.get("attached_media[0]")).toBe(JSON.stringify({ media_fbid: "P1" }));
    expect(feed.params.get("attached_media[1]")).toBe(JSON.stringify({ media_fbid: "P2" }));
  });
});

describe("refusals before anything is sent", () => {
  it.each(["draft", "generating", "failed", "ready", "skipped", "posted"])("does not publish a post whose status is %s", async (status) => {
    await connectIg();
    const { result, calls } = await run({ status }, igOk());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(false);
      expect(result.message).toMatch(/not approved|already shared/i);
    }
    expect(calls).toHaveLength(0);
  });

  it("publishes an approved post (auto-approved ones carry the same status)", async () => {
    await connectIg();
    expect((await run({ status: "approved" }, igOk())).result.ok).toBe(true);
  });

  it("answers not_connected when nothing is connected, the channel cannot be automated, or the item is a delivery", async () => {
    const a = await run({}, igOk());
    expect(a.result).toMatchObject({ ok: false, reason: "not_connected", retryable: false });
    await connectIg();
    const b = await run({ channel: "linkedin" }, igOk());
    expect(b.result).toMatchObject({ ok: false, reason: "not_connected" });
    const c = await run({ mode: "deliver" }, igOk());
    expect(c.result).toMatchObject({ ok: false, retryable: false });
    expect([...a.calls, ...b.calls, ...c.calls]).toHaveLength(0);
  });

  it("an expired or ended connection pauses publishing without calling Meta", async () => {
    await connectIg();
    await db.withAdmin((tx) => tx.query("update public.channel_connections set status = 'expired' where brand_id = $1", [owner.brandId]));
    const a = await run({}, igOk());
    expect(a.result).toMatchObject({ ok: false, reason: "token_expired", retryable: false });

    await db.withAdmin((tx) => tx.query("update public.channel_connections set status = 'active', expires_at = now() - interval '1 day' where brand_id = $1", [owner.brandId]));
    const b = await run({}, igOk());
    expect(b.result).toMatchObject({ ok: false, reason: "token_expired" });
    expect(a.calls.length + b.calls.length).toBe(0);
    expect((await getConnection(owner.brandId, "instagram"))!.status).toBe("expired");
  });

  it("a disconnected account is not_connected", async () => {
    await connectIg();
    await db.withAdmin((tx) => tx.query("update public.channel_connections set status = 'revoked' where brand_id = $1", [owner.brandId]));
    expect((await run({}, igOk())).result).toMatchObject({ ok: false, reason: "not_connected" });
  });

  it("does not post twice: an item that already has a platform post id is reported as done", async () => {
    await connectIg();
    const { result, calls } = await run({ platformPostId: "OLD1" }, igOk());
    expect(result).toEqual({ ok: true, platformPostId: "OLD1", permalink: null });
    expect(calls).toHaveLength(0);
  });

  it("refuses an unknown item and another brand's item", async () => {
    await connectIg();
    const s = await seedPost(db, owner);
    const p = publisher(igOk());
    expect(await p.publish({ itemId: "00000000-0000-4000-8000-000000000000", brandId: owner.brandId })).toMatchObject({ ok: false, retryable: false });
    const other = await makeOwner(db);
    expect(await p.publish({ itemId: s.itemId, brandId: other.brandId })).toMatchObject({ ok: false, retryable: false });
    expect(p.calls).toHaveLength(0);
  });

  it("never changes the queue row", async () => {
    await connectIg();
    const s = await seedPost(db, owner);
    const before = await queueRow(db, s.itemId);
    await publisher(igOk()).publish({ itemId: s.itemId, brandId: owner.brandId });
    expect(await queueRow(db, s.itemId)).toEqual(before);
  });

  it("refuses picture links Meta cannot fetch (the mock storage) without calling Meta", async () => {
    await connectIg();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000"); // what the mock storage links to in development
    const f = fakeFetch(igOk());
    const publish = createPublisher({ fetch: f.fetch, sleep: async () => undefined, storage: createMockStorage() });
    const s = await seedPost(db, owner);
    expect(await publish({ itemId: s.itemId, brandId: owner.brandId })).toMatchObject({ ok: false, reason: "media_rejected", retryable: false });
    expect(f.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("reports a post with no picture", async () => {
    await connectIg();
    const { result, calls } = await run({ images: {} }, igOk());
    expect(result).toMatchObject({ ok: false, reason: "media_rejected", retryable: false });
    expect(calls).toHaveLength(0);
  });
});

describe("the publishing limit", () => {
  it("returns rate_limited (retryable) at the limit, without creating a container", async () => {
    await connectIg();
    const { result, calls } = await run({}, igOk({ quotaUsage: 100 }));
    expect(result).toMatchObject({ ok: false, reason: "rate_limited", retryable: true });
    expect(calls.map((c) => c.method + c.path.replace(/^\/v23\.0/, ""))).toEqual([`GET/${IG}/content_publishing_limit`]);
  });

  it("goes ahead below the limit and when the limit check itself is unavailable", async () => {
    await connectIg();
    expect((await run({}, igOk({ quotaUsage: 99 }))).result.ok).toBe(true);
    expect((await run({}, igOk({ extra: [when("GET", /\/content_publishing_limit$/, graphError(2, "unavailable", { status: 500 }))] }))).result.ok).toBe(true);
  });
});

describe("container status", () => {
  it("an ERROR status is media_rejected and not retried", async () => {
    await connectIg();
    const { result, calls } = await run({}, igOk({ statuses: [{ body: { status_code: "ERROR", status: "Error: Media upload has failed with error code 2207026" } }] }));
    expect(result).toMatchObject({ ok: false, reason: "media_rejected", retryable: false });
    expect(calls.some((c) => c.path.endsWith("/media_publish"))).toBe(false);
  });

  it("an EXPIRED container can be retried", async () => {
    await connectIg();
    const { result } = await run({}, igOk({ statuses: [{ body: { status_code: "EXPIRED" } }] }));
    expect(result).toMatchObject({ ok: false, retryable: true });
  });

  it("gives up waiting after the timeout with a retryable network result", async () => {
    await connectIg();
    const { result, sleeps } = await run({}, igOk({ statuses: [{ body: { status_code: "IN_PROGRESS" } }] }));
    expect(result).toMatchObject({ ok: false, reason: "network", retryable: true });
    const waited = sleeps.reduce((a, b) => a + b, 0);
    expect(waited).toBeGreaterThanOrEqual(POLL_TIMEOUT_MS);
    expect(Math.max(...sleeps)).toBeLessThanOrEqual(10_000);
  });
});

describe("error mapping", () => {
  const cases: Array<[string, Reply, string, boolean]> = [
    ["190 token", graphError(190, "Error validating access token: Session has expired"), "token_expired", false],
    ["102 session", graphError(102, "Session key invalid"), "token_expired", false],
    ["OAuth subcode 463", graphError(190, "expired", { subcode: 463 }), "token_expired", false],
    ["10 permission", graphError(10, "Application does not have permission for this action"), "token_expired", false],
    ["200 permission", graphError(200, "Requires pages_manage_posts permission"), "token_expired", false],
    ["4 app limit", graphError(4, "Application request limit reached"), "rate_limited", true],
    ["17 user limit", graphError(17, "User request limit reached"), "rate_limited", true],
    ["32 page limit", graphError(32, "Page request limit reached"), "rate_limited", true],
    ["613 call limit", graphError(613, "Calls to this api have exceeded the rate limit"), "rate_limited", true],
    ["HTTP 429", { status: 429, body: { error: { message: "slow down", code: 0 } } }, "rate_limited", true],
    ["2207026 media", graphError(100, "Unsupported video format", { subcode: 2207026 }), "media_rejected", false],
    ["2207011 media", graphError(100, "Media not found", { subcode: 2207011 }), "media_rejected", false],
    ["2207003 media (try again)", graphError(100, "Timeout while downloading media", { subcode: 2207003 }), "media_rejected", true],
    ["9004 media URI", graphError(9004, "Media URI doesn't meet our requirements"), "media_rejected", false],
    ["HTTP 500", { status: 500, body: { error: { message: "Internal error", code: 1 } } }, "network", true],
    ["HTTP 503 no body", { status: 503, body: {} }, "network", true],
    ["code 2 unavailable", graphError(2, "Service temporarily unavailable", { status: 400 }), "network", true],
    ["a cut connection", new Error("socket hang up"), "network", true],
    ["invalid parameter", graphError(100, "Invalid parameter"), "unknown", false],
  ];

  it.each(cases)("%s", async (_name, reply, reason, retryable) => {
    await connectIg();
    const { result } = await run({}, igOk({ extra: [when("POST", /\/media$/, reply)] }));
    expect(result).toMatchObject({ ok: false, reason, retryable });
  });

  it("maps Facebook errors the same way", async () => {
    await connectFb();
    const a = await run({ channel: "facebook" }, fbOk([when("POST", /\/photos$/, graphError(190, "bad token"))]));
    expect(a.result).toMatchObject({ ok: false, reason: "token_expired", retryable: false });
    await connectFb();
    const b = await run({ channel: "facebook" }, fbOk([when("POST", /\/photos$/, graphError(32, "limit"))]));
    expect(b.result).toMatchObject({ ok: false, reason: "rate_limited", retryable: true });
    const c = await run({ channel: "facebook" }, fbOk([when("POST", /\/photos$/, graphError(324, "Missing or invalid image file"))]));
    expect(c.result).toMatchObject({ ok: false, reason: "media_rejected", retryable: false });
  });

  it("a token error marks the connection expired and emails the owner exactly once", async () => {
    await connectIg();
    const before = (await listOutbox()).filter((e) => e.brandId === owner.brandId).length;
    const a = await run({}, igOk({ extra: [when("POST", /\/media$/, graphError(190, "Session has expired"))] }));
    expect(a.result).toMatchObject({ reason: "token_expired" });
    const conn = await getConnection(owner.brandId, "instagram");
    expect(conn!.status).toBe("expired");
    expect(conn!.lastError).toContain("Session has expired");
    // A second item hits the already-expired connection: no new email.
    await run({}, igOk());
    const mails = (await listOutbox()).filter((e) => e.brandId === owner.brandId && e.kind === "connection_problem");
    expect(mails).toHaveLength(1);
    expect((await listOutbox()).filter((e) => e.brandId === owner.brandId).length).toBe(before + 1);
  });

  it("an error that is not about the token does not touch the connection", async () => {
    await connectIg();
    await run({}, igOk({ extra: [when("POST", /\/media$/, graphError(4, "limit"))] }));
    expect((await getConnection(owner.brandId, "instagram"))!.status).toBe("active");
  });
});

describe("the token never leaks", () => {
  it("is not in results, errors or logs, even when Meta echoes it back", async () => {
    await connectIg();
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const echo = (code: number, status = 400) => ({ status, body: { error: { message: `Invalid OAuth access token ${IG_TOKEN} (access_token=${IG_TOKEN})`, type: "OAuthException", code } } });
    const results = [];
    for (const reply of [echo(190), echo(100), echo(4), echo(1, 500), new Error(`fetch failed for ?access_token=${IG_TOKEN}`)] as Reply[]) {
      await connectIg();
      results.push((await run({}, igOk({ extra: [when("POST", /\/media$/, reply)] }))).result);
    }
    results.push((await run({}, igOk())).result);
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls.map((c) => c.map((x) => String(x)))));
    expect(JSON.stringify(results)).not.toContain(IG_TOKEN);
    expect(JSON.stringify(results)).not.toContain("ZZZZ1234567890");
    expect(logged).not.toContain(IG_TOKEN);
    const mails = JSON.stringify(await listOutbox());
    expect(mails).not.toContain(IG_TOKEN);
  });

  it("is not in the stored connection either", async () => {
    await connectIg();
    const rows = JSON.stringify(await db.withAdmin((tx) => Promise.all([tx.query("select * from public.channel_connections"), tx.query("select * from public.channel_tokens")])));
    expect(rows).not.toContain(IG_TOKEN);
    expect(rows).not.toContain(FB_TOKEN);
  });

  it("an unreadable stored token is a plain failure that names no secret", async () => {
    await connectIg();
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64")); // the key changed after saving
    const { result, calls } = await run({}, igOk());
    expect(result).toMatchObject({ ok: false, retryable: false });
    expect(JSON.stringify(result)).not.toContain(IG_TOKEN);
    expect(calls).toHaveLength(0);
    expect((await getConnection(owner.brandId, "instagram"))!.status).toBe("active"); // a key problem is not the owner's fault
  });
});

describe("the Instagram base URL", () => {
  it("uses graph.instagram.com and the configured Graph version", async () => {
    await connectIg();
    vi.stubEnv("META_GRAPH_VERSION", "v24.0");
    const { calls } = await run({}, igOk());
    expect(calls.every((c) => c.host === FEED.replace("https://", "") && c.path.startsWith("/v24.0/"))).toBe(true);
  });
});

describe("a publish that gets no answer (double-post guard)", () => {
  const CAPTION = "Fresh sourdough today.\n\n#bakery #sourdough";
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString().replace(/\.\d{3}Z$/, "+0000");
  const listing = (...items: Array<Record<string, unknown>>) => when("GET", /\/media$/, { body: { data: items } });
  const lost = (reply: Reply = new Error("socket hang up")) => when("POST", /\/media_publish$/, reply);

  it("Instagram: finds the post that went live, returns it and does not ask for a retry", async () => {
    await connectIg();
    const { result, calls } = await run({}, igOk({ extra: [lost(), listing({ id: "M9", caption: CAPTION, timestamp: ago(5_000), permalink: "https://www.instagram.com/p/LIVE/" })] }));
    expect(result).toEqual({ ok: true, platformPostId: "M9", permalink: "https://www.instagram.com/p/LIVE/" });
    const look = calls.find((c) => c.method === "GET" && c.path.endsWith(`/${IG}/media`))!;
    expect(look.params.get("fields")).toBe("id,caption,timestamp,permalink");
    expect(look.params.get("limit")).toBe("5");
    expect(calls.filter((c) => c.path.endsWith("/media_publish"))).toHaveLength(1); // never published a second time
  });

  it("Instagram: also checks after a server error, and allows 2 minutes of clock skew", async () => {
    await connectIg();
    const a = await run({}, igOk({ extra: [lost({ status: 503, body: { error: { message: "down", code: 2 } } }), listing({ id: "M8", caption: CAPTION, timestamp: ago(90_000), permalink: null })] }));
    expect(a.result).toMatchObject({ ok: true, platformPostId: "M8", permalink: null });
  });

  it.each([
    ["nothing new", [] as Array<Record<string, unknown>>],
    ["a post with the same caption from before this attempt", [{ id: "OLD", caption: CAPTION, timestamp: ago(3_600_000), permalink: "x" }]],
    ["a new post with a different caption", [{ id: "OTHER", caption: "Something else", timestamp: ago(1_000), permalink: "x" }]],
  ])("Instagram: %s means a retryable network result", async (_name, items) => {
    await connectIg();
    const { result } = await run({}, igOk({ extra: [lost(), listing(...items)] }));
    expect(result).toMatchObject({ ok: false, reason: "network", retryable: true });
  });

  it("Instagram: if the look-up fails too, the original retryable network result stands", async () => {
    await connectIg();
    const { result } = await run({}, igOk({ extra: [lost(), when("GET", /\/media$/, graphError(190, "bad token"))] }));
    expect(result).toMatchObject({ ok: false, reason: "network", retryable: true });
  });

  it("Instagram: a clear refusal from Meta is not second-guessed (no look-up)", async () => {
    await connectIg();
    const { result, calls } = await run({}, igOk({ extra: [lost(graphError(100, "Invalid parameter", { subcode: 2207026 })), listing({ id: "M9", caption: CAPTION, timestamp: ago(1_000) })] }));
    expect(result).toMatchObject({ ok: false, reason: "media_rejected" });
    expect(calls.some((c) => c.method === "GET" && c.path.endsWith(`/${IG}/media`))).toBe(false);
  });

  it("Instagram carousel: the same check uses the carousel caption", async () => {
    await connectIg();
    const { result } = await run(
      { images: { square: "q.png" }, slides: [{ square: "a.png" }, { square: "b.png" }], caption: "Two favourites", hashtags: [] },
      igOk({ extra: [lost(), listing({ id: "MC", caption: "Two favourites", timestamp: ago(2_000), permalink: "https://www.instagram.com/p/CAR/" })] }),
    );
    expect(result).toMatchObject({ ok: true, platformPostId: "MC" });
  });

  const fbPosts = (...items: Array<Record<string, unknown>>) => when("GET", /\/1001\/posts$/, { body: { data: items } });

  it("Facebook photo: finds the Page post that went live", async () => {
    await connectFb();
    const { result, calls } = await run(
      { channel: "facebook", caption: "Open late tonight", hashtags: [] },
      fbOk([when("POST", /\/photos$/, new Error("timeout")), fbPosts({ id: `${PAGE}_900`, message: "Open late tonight", created_time: ago(3_000), permalink_url: "https://www.facebook.com/Page/posts/900" })]),
    );
    expect(result).toEqual({ ok: true, platformPostId: `${PAGE}_900`, permalink: "https://www.facebook.com/Page/posts/900" });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("Facebook multi-photo: the final feed post is checked", async () => {
    await connectFb();
    const { result } = await run(
      { channel: "facebook", images: { square: "q.png" }, slides: [{ square: "a.png" }, { square: "b.png" }], caption: "Two favourites", hashtags: [] },
      fbOk([when("POST", /\/feed$/, { status: 502, body: {} }), fbPosts({ id: `${PAGE}_901`, message: "Two favourites", created_time: ago(1_000) })]),
    );
    expect(result).toEqual({ ok: true, platformPostId: `${PAGE}_901`, permalink: `https://www.facebook.com/${PAGE}_901` });
  });

  it("Facebook: no match means a retryable network result", async () => {
    await connectFb();
    const a = await run({ channel: "facebook", caption: "Open late tonight", hashtags: [] }, fbOk([when("POST", /\/photos$/, new Error("timeout")), fbPosts({ id: "x", message: "Open late tonight", created_time: ago(3_600_000) })]));
    expect(a.result).toMatchObject({ ok: false, reason: "network", retryable: true });
    const b = await run({ channel: "facebook", caption: "Open late tonight", hashtags: [] }, fbOk([when("POST", /\/photos$/, new Error("timeout")), fbPosts()]));
    expect(b.result).toMatchObject({ ok: false, reason: "network", retryable: true });
  });
});
