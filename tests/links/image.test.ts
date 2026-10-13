import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { emailImagePath, serveEmailImage } from "@/lib/links/image";
import { signLink } from "@/lib/links/tokens";
import { tempStorage } from "../weekly/helpers";
import { seedReadyWeek, type SeededWeek } from "./helpers";

let db: MockDb;
let store: Awaited<ReturnType<typeof tempStorage>>;
let a: SeededWeek;
let b: SeededWeek;

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
  store = await tempStorage();
  a = await seedReadyWeek(db, store.storage);
  b = await seedReadyWeek(db, store.storage);
}, 120_000);
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
  await store.cleanup();
});

const imgToken = (brandId: string, postId: string, extra: Record<string, string> = { format: "square" }, now?: Date) =>
  signLink({ brandId, postId, act: "img", extra, now });
const serve = (token: string, now?: Date) => serveEmailImage({ token, storage: store.storage, now });

describe("/i/[token] email images", () => {
  it("serves a 600 px wide JPEG with a private one-day cache", async () => {
    const res = await serve(await imgToken(a.brandId, a.postIds[0]));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const bytes = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(600);
    expect(res.headers.get("content-length")).toBe(String(bytes.length));
  });

  it("caches the JPEG in storage at renders/{brand}/{post}/email.jpg and serves it from there", async () => {
    const postId = a.postIds[1];
    expect(await store.storage.get("renders", emailImagePath(a.brandId, postId))).toBeNull();
    const first = Buffer.from(await (await serve(await imgToken(a.brandId, postId))).arrayBuffer());
    const cached = await store.storage.get("renders", `${a.brandId}/${postId}/email.jpg`);
    expect(cached?.contentType).toBe("image/jpeg");
    expect(Buffer.from(cached!.bytes).equals(first)).toBe(true);
    // The cached file is what is served next time.
    const marker = await sharp({ create: { width: 600, height: 600, channels: 3, background: "#00ff00" } }).jpeg().toBuffer();
    await store.storage.put("renders", `${a.brandId}/${postId}/email.jpg`, marker, "image/jpeg");
    const second = Buffer.from(await (await serve(await imgToken(a.brandId, postId))).arrayBuffer());
    expect(second.equals(marker)).toBe(true);
  });

  it("is a 404 after 14 days, and fine just before", async () => {
    const t0 = new Date("2026-11-09T08:00:00Z");
    const token = await imgToken(a.brandId, a.postIds[2], { format: "square" }, t0);
    expect((await serve(token, new Date(t0.getTime() + 13 * 24 * 3600_000 + 23 * 3600_000))).status).toBe(200);
    expect((await serve(token, new Date(t0.getTime() + 14 * 24 * 3600_000 + 60_000))).status).toBe(404);
  });

  it("is a 404 when the post does not belong to the brand in the token", async () => {
    const res = await serve(await imgToken(a.brandId, b.postIds[0]));
    expect(res.status).toBe(404);
    const other = await serve(await imgToken(b.brandId, a.postIds[0]));
    expect(other.status).toBe(404);
  });

  it("is a 404 for forged, other-act, wrong-format and unknown-post tokens", async () => {
    expect((await serve("junk")).status).toBe(404);
    const approve = await signLink({ brandId: a.brandId, postId: a.postIds[0], act: "approve" });
    expect((await serve(approve)).status).toBe(404);
    expect((await serve(await imgToken(a.brandId, a.postIds[0], { format: "panorama" }))).status).toBe(404);
    expect((await serve(await imgToken(a.brandId, a.postIds[0], {}))).status).toBe(404);
    expect((await serve(await imgToken(a.brandId, "99999999-9999-4999-8999-999999999999"))).status).toBe(404);
    expect((await serve(approve)).headers.get("cache-control")).toBe("no-store");
  });
});
