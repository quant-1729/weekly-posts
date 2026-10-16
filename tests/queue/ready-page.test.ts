import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { linkNonce } from "@/lib/links/csrf";
import { handleLinkGet, handleLinkPost } from "@/lib/links/dispatch";
import { signLink, verifyLink } from "@/lib/links/tokens";
import type { MockDb } from "@/lib/db/mock";
import { newCsrfSecret } from "@/lib/auth/continue";
import { closeDb, openDb } from "../helpers/details";
import { NOW, makeShop, postStatus, rows, seedApproved, seedBrief, seedPost, type Shop } from "./helpers";

let db: MockDb;
let shop: Shop;
let other: Shop;

beforeAll(async () => {
  db = await openDb();
  shop = await makeShop(db);
  other = await makeShop(db, { name: "Other Shop" });
});
afterAll(async () => {
  await closeDb(db);
});

const ready = (s: Shop, postId: string, now = NOW) => signLink({ brandId: s.brandId, postId, act: "ready", now });

/** What a browser does: it holds a CSRF cookie and presses a button with the nonce of that cookie. */
async function press(token: string, fields: Record<string, string>, now: Date) {
  const claims = (await verifyLink(token, { now }))!;
  return post(token, claims.jti, newCsrfSecret(), fields, now);
}

async function post(token: string, jti: string, secret: string, fields: Record<string, string>, now: Date) {
  const form = new FormData();
  form.set("nonce", linkNonce(jti, secret));
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return handleLinkPost(token, form, secret, now);
}

describe("the ready page of a post made from a brief", () => {
  it("shows every size the channel needs with its own Download, plus Copy; no story button when the main size is already vertical", async () => {
    const x = await seedApproved(db, shop, ["instagram", "whatsapp"]);
    const ig = await handleLinkGet(await ready(shop, x.posts[0].id), undefined, NOW);
    expect(ig.status).toBe(200);
    expect(ig.csp).toContain("script-src"); // the share script, by hash
    expect(ig.html).toContain("Download square");
    expect(ig.html).toContain("Download portrait");
    expect(ig.html).toContain("Copy caption");
    expect(ig.html).toContain("Mark as posted");
    expect(ig.html).toContain("For Instagram");
    expect(ig.html).toContain("Fresh bread every morning at Corner Bakery.");
    expect(ig.html).not.toContain("Share as story or status"); // Instagram feed has no vertical size here

    const wa = await handleLinkGet(await ready(shop, x.posts[1].id), undefined, NOW);
    expect(wa.html).toContain("Download story size");
    expect(wa.html).not.toContain("Share as story or status"); // the main picture IS the story size
    expect(wa.html).toContain("For WhatsApp");
  });

  it("a carousel: Share sends every slide, and each slide has its own Download", async () => {
    const x = await seedApproved(db, shop, ["instagram"], { carousel: 4 });
    const page = await handleLinkGet(await ready(shop, x.posts[0].id), undefined, NOW);
    expect(page.status).toBe(200);
    expect(page.html).toContain("Share all 4 slides");
    const urls = /data-urls="([^"]*)"/.exec(page.html)![1].split(" ");
    expect(urls).toHaveLength(4);
    expect(/data-filenames="([^"]*)"/.exec(page.html)![1].split(" ")).toEqual(["instagram-slide-1.png", "instagram-slide-2.png", "instagram-slide-3.png", "instagram-slide-4.png"]);
    for (const n of [1, 2, 3, 4]) expect(page.html).toContain(`download="instagram-slide-${n}.png"`);
    expect(page.html).toContain("Copy caption");
    expect(page.html).toContain("Mark as posted");
  });

  it("a post that is not approved has no share buttons", async () => {
    const briefId = await seedBrief(db, shop, { channels: ["facebook"] });
    const draft = await seedPost(db, shop, briefId, "facebook", { status: "draft" });
    const page = await handleLinkGet(await ready(shop, draft.id), undefined, NOW);
    expect(page.status).toBe(200);
    expect(page.html).not.toContain("data-share-root");
    expect(page.html).not.toContain("Mark as posted");
    expect(page.csp).toBeUndefined();
  });

  it("Mark as posted, and 'Not posted yet' within a day (not after); both are logged", async () => {
    const x = await seedApproved(db, shop, ["whatsapp"]);
    const token = await ready(shop, x.posts[0].id);
    const done = await press(token, { op: "posted" }, NOW);
    expect(done.html).toContain("Marked as posted.");
    expect(done.html).toContain("Posted on 14 Oct");
    expect(done.html).toContain("Not posted yet");
    expect(await postStatus(db, x.posts[0].id)).toBe("posted");
    // Doing it twice is a quiet no-op.
    await press(token, { op: "posted" }, NOW);
    expect((await rows<{ n: number }>(db, "select count(*)::int as n from public.post_actions where post_id = $1 and action = 'posted'", [x.posts[0].id]))[0].n).toBe(1);

    const undone = await press(token, { op: "unposted" }, new Date(NOW.getTime() + 3 * 3600_000));
    expect(undone.html).toContain("Moved back to approved.");
    expect(await postStatus(db, x.posts[0].id)).toBe("approved");

    await press(token, { op: "posted" }, NOW);
    const late = await press(token, { op: "unposted" }, new Date(NOW.getTime() + 25 * 3600_000));
    expect(late.html).toContain("more than a day ago");
    expect(await postStatus(db, x.posts[0].id)).toBe("posted");
  });

  it("Mark as posted marks a carousel's slides too", async () => {
    const x = await seedApproved(db, shop, ["instagram"], { carousel: 2 });
    await press(await ready(shop, x.posts[0].id), { op: "posted" }, NOW);
    expect((await rows<{ s: string }>(db, "select distinct status::text as s from public.posts where brief_id = $1", [x.briefId])).map((r) => r.s)).toEqual(["posted"]);
  });

  it("the script's share and download logs are recorded for approved posts only", async () => {
    const x = await seedApproved(db, shop, ["instagram"]);
    const token = await ready(shop, x.posts[0].id);
    expect((await press(token, { op: "log", kind: "share", format: "portrait", post: x.posts[0].id }, NOW)).status).toBe(200);
    expect((await press(token, { op: "log", kind: "download", format: "square", post: x.posts[0].id }, NOW)).status).toBe(200);
    expect((await press(token, { op: "log", kind: "nonsense", post: x.posts[0].id }, NOW)).status).toBe(400);
    const logs = await rows<{ action: string; detail: { format?: string } }>(db, "select action::text as action, detail from public.post_actions where post_id = $1 order by created_at, id", [x.posts[0].id]);
    expect(logs.map((l) => [l.action, l.detail.format])).toEqual([
      ["share", "portrait"],
      ["download", "square"],
    ]);
    await rows(db, "update public.posts set status = 'draft' where id = $1", [x.posts[0].id]);
    expect((await press(token, { op: "log", kind: "share", post: x.posts[0].id }, NOW)).status).toBe(400);
  });

  it("a link never opens another business's post, and a GET changes nothing", async () => {
    const theirs = await seedApproved(db, other, ["whatsapp"]);
    const forged = await signLink({ brandId: shop.brandId, postId: theirs.posts[0].id, act: "ready", now: NOW });
    const page = await handleLinkGet(forged, undefined, NOW);
    expect(page.status).toBe(404);
    expect(page.html).not.toContain("Fresh bread");
    const mine = await seedApproved(db, shop, ["whatsapp"]);
    await handleLinkGet(await ready(shop, mine.posts[0].id), undefined, NOW);
    expect(await postStatus(db, mine.posts[0].id)).toBe("approved");
  });

  it("a ready link without a post is still the v2 week page", async () => {
    const token = await signLink({ brandId: shop.brandId, act: "ready", weekStart: "2026-10-12", now: NOW });
    const page = await handleLinkGet(token, undefined, NOW);
    // No such weekly batch: the dispatcher says the link is unavailable, as it did before.
    expect([200, 404]).toContain(page.status);
    expect(page.html).not.toContain("For Instagram");
  });
});
