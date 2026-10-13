import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newCsrfSecret } from "@/lib/auth/continue";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { setStorageForTests } from "@/lib/storage";
import { linkNonce } from "@/lib/links/csrf";
import { handleLinkGet, handleLinkPost } from "@/lib/links/dispatch";
import { serveEmailImage } from "@/lib/links/image";
import { jtiHash, signLink, verifyLink } from "@/lib/links/tokens";
import { PLANTED_PRICE } from "@/lib/weekly/fixtures";
import { cookieOf, nonceOf, openLink, pressLink } from "../links/helpers";
import { tempStorage } from "../weekly/helpers";
import { actionsOf, flagsOf, freshWeek, imageRows, makeFlag, postRow, setFlags, setPost, type FreshWeek, type Row } from "./helpers";

let db: MockDb;
let store: Awaited<ReturnType<typeof tempStorage>>;
let a: FreshWeek; // main
let avoid: FreshWeek; // words to avoid: cheap
let other: FreshWeek;
let off: FreshWeek; // unsubscribes

const WEEK = "2026-12-21";
const rows = (sql: string, params: unknown[] = []) => db.withAdmin((tx) => tx.query<Row>(sql, params));

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
  store = await tempStorage();
  setStorageForTests(store.storage);
  a = await freshWeek(db, store.storage);
  avoid = await freshWeek(db, store.storage, { wordsToAvoid: ["cheap"] });
  other = await freshWeek(db, store.storage);
  off = await freshWeek(db, store.storage);
}, 240_000);
afterAll(async () => {
  setStorageForTests(null);
  setMockDbForTests(null);
  await db.close();
  await store.cleanup();
});

const sign = (w: FreshWeek, act: "approve" | "skip" | "edit" | "ready" | "view_week", i?: number, now?: Date) =>
  signLink({ brandId: w.brandId, postId: i === undefined ? undefined : w.postIds[i], act, weekStart: WEEK, now });

/** What a person does: open the link, then press a button with these fields. */
async function press(token: string, fields: Record<string, string>) {
  const got = await openLink(token);
  const cookie = cookieOf(got);
  const html = await got.text();
  const res = await pressLink(token, { nonce: nonceOf(html), ...fields }, cookie);
  return { status: res.status, html: await res.text() };
}
const view = async (token: string) => {
  const res = await openLink(token);
  return { status: res.status, html: await res.text() };
};
const flagIds = (html: string) => [...new Set([...html.matchAll(/name="flag" value="(f_[\w-]+)"/g)].map((m) => m[1]))];
const status = async (id: string) => (await postRow(db, id)).status as string;
const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("a link never acts on GET (AC 14)", () => {
  it("opening approve, skip, edit and ready, twice, changes nothing and writes nothing", async () => {
    const snapshot = async () =>
      JSON.stringify([
        await rows("select id::text, status::text, caption, cta, photo_id::text, fact_flags, approved_at, skipped_at, edited_at from public.posts where brand_id = $1 order by id", [a.brandId]),
        await rows("select count(*)::int as n from public.post_actions"),
        await rows("select count(*)::int as n from public.voice_feedback"),
      ]);
    const before = await snapshot();
    const tokens = [await sign(a, "approve", 0), await sign(a, "skip", 0), await sign(a, "edit", 0), await sign(a, "approve", 1), await sign(a, "ready")];
    for (const t of tokens) {
      for (let i = 0; i < 2; i++) {
        const r = await view(t);
        expect(r.status).toBe(200);
        expect(r.html).not.toContain("<script");
      }
    }
    expect(await snapshot()).toBe(before);
  });

  it("a POST without the nonce, or with a wrong one, is refused and changes nothing", async () => {
    const token = await sign(a, "approve", 0);
    const cookie = cookieOf(await openLink(token))!;
    expect((await pressLink(token, { op: "approve" }, cookie)).status).toBe(403);
    expect((await pressLink(token, { op: "approve", nonce: "x".repeat(43) }, cookie)).status).toBe(403);
    expect((await pressLink(token, { op: "approve", nonce: "x".repeat(43) })).status).toBe(403);
    expect(await status(a.postIds[0])).toBe("draft");
    expect(await actionsOf(db, a.postIds[0])).toHaveLength(0);
  });
});

describe("approve (Req 11, 14)", () => {
  it("shows the post and, for a flagged post, a Please check list with an Approve button that is disabled", async () => {
    const r = await view(await sign(a, "approve", 1));
    expect(r.status).toBe(200);
    expect(r.html).toContain("Approve this post?");
    expect(r.html).toContain("Please check");
    expect(r.html).toContain(PLANTED_PRICE);
    expect(r.html).toContain("This is true");
    expect(r.html).toContain("Remove");
    expect(r.html).toMatch(/<button type="submit" disabled aria-disabled="true"[^>]*>Approve this post<\/button>/);
    expect(r.html).not.toContain('name="op" value="approve"');
    expect(r.html).toContain("Facebook");
    expect(r.html).toMatch(/src="\/i\/[\w.-]+"/);
    expect(r.html).toContain("Pick a few favourites");
    expect(r.html).toContain("#tastingbox");
    expect(r.html).toContain("Reply to this post to reserve yours.");
  });

  it("pressing approve with open flags is refused, and the flags are confirmed or removed one by one", async () => {
    const token = await sign(a, "approve", 1);
    const refused = await press(token, { op: "approve" });
    expect(decode(refused.html)).toContain("Please check the items marked above");
    expect(await status(a.postIds[1])).toBe("draft");

    const ids = flagIds((await view(token)).html);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const flags = await flagsOf(db, a.postIds[1]);
    const caption = flags.find((f) => f.field === "caption" && f.status === "open")!;
    const subline = flags.find((f) => f.field === "image_text.subline" && f.status === "open")!;

    const sqBefore = (await store.storage.get("renders", `${a.brandId}/${a.postIds[1]}/square.png`))!.bytes;
    const confirmed = await press(token, { op: "confirm_flag", flag: caption.id });
    expect(confirmed.html).toContain("Marked as true.");
    expect((await flagsOf(db, a.postIds[1])).find((f) => f.id === caption.id)?.status).toBe("confirmed");
    // Still blocked by the other flag.
    expect(confirmed.html).toMatch(/disabled aria-disabled="true"/);

    const removed = await press(token, { op: "remove_flag", flag: subline.id });
    expect(removed.html).toContain("Removed from the post.");
    const after = await postRow(db, a.postIds[1]);
    expect((after.image_text as { subline: string }).subline).not.toContain(PLANTED_PRICE);
    expect(Buffer.from((await store.storage.get("renders", `${a.brandId}/${a.postIds[1]}/square.png`))!.bytes).equals(Buffer.from(sqBefore))).toBe(false);

    // Nothing left to check: the Please check list is gone and Approve is a real button.
    expect(removed.html).not.toContain("Please check");
    expect(removed.html).toContain('name="op" value="approve"');
    expect(removed.html).not.toMatch(/disabled aria-disabled/);
  });

  it("approves, says Approved, offers Undo and a link to the ready page, and logs the action with the jti hash only", async () => {
    const token = await sign(a, "approve", 1);
    const done = await press(token, { op: "approve" });
    expect(done.status).toBe(200);
    expect(done.html).toContain("<h1");
    expect(done.html).toContain("Approved");
    expect(done.html).toContain("Your post is approved and ready to share.");
    expect(done.html).toContain('name="op" value="undo"');
    expect(done.html).toContain("See posts ready to share");
    expect(await status(a.postIds[1])).toBe("approved");
    expect((await postRow(db, a.postIds[1])).approved_at).not.toBeNull();

    const ready = /href="\/e\/([\w.-]+)"[^>]*>See posts ready to share/.exec(done.html)![1];
    const claims = await verifyLink(ready);
    expect(claims).toMatchObject({ act: "ready", brandId: a.brandId, weekStart: WEEK });

    const approveLog = (await actionsOf(db, a.postIds[1])).filter((l) => l.action === "approve");
    expect(approveLog).toHaveLength(1);
    const tokenClaims = await verifyLink(token);
    expect(approveLog[0]).toMatchObject({ via: "email_link", user_id: null, brand_id: a.brandId });
    expect((approveLog[0].detail as Row).jti_hash).toBe(jtiHash(tokenClaims!.jti));
    expect(JSON.stringify(approveLog[0].detail)).not.toContain("eyJ");

    // Pressing again is quiet: it says it is already approved.
    const again = await press(token, { op: "approve" });
    expect(again.html).toContain("This post is already approved.");
    expect((await actionsOf(db, a.postIds[1])).filter((l) => l.action === "approve")).toHaveLength(1);
  });

  it("Undo puts the post back to waiting", async () => {
    const token = await sign(a, "approve", 1);
    const r = await press(token, { op: "undo" });
    expect(r.html).toContain("This post is waiting for your decision again.");
    expect(await status(a.postIds[1])).toBe("draft");
    expect(await postRow(db, a.postIds[1])).toMatchObject({ approved_at: null, skipped_at: null });
  });

  it("a regulated flag shows the warning and a required tick, and confirming needs the tick", async () => {
    const flag = makeFlag({ text: "pain-free dentistry", kind: "claim", regulated: true });
    await setPost(db, a.postIds[3], "caption = 'We offer pain-free dentistry for all of you.'");
    await setFlags(db, a.postIds[3], [flag, makeFlag({ text: "Check your local advertising rules before posting.", kind: "regulated_reminder", regulated: true, highlight: false, id: "f_rem" })]);
    const token = await sign(a, "approve", 3);
    const page = (await view(token)).html;
    expect(page).toContain("Health, money and education claims can break advertising rules.");
    expect(page).toMatch(/<input type="checkbox" name="ack" value="1" required/);
    expect(page).toContain("I confirm this is true and I can prove it");
    // The fixed reminder is shown but is not an item to answer.
    expect(page).toContain("Check your local advertising rules before posting.");
    expect(flagIds(page)).toEqual([flag.id]);

    const noTick = await press(token, { op: "confirm_flag", flag: flag.id });
    expect(decode(noTick.html)).toContain("Please tick the box");
    expect((await flagsOf(db, a.postIds[3])).find((f) => f.id === flag.id)?.status).toBe("open");
    const ticked = await press(token, { op: "confirm_flag", flag: flag.id, ack: "1" });
    expect(ticked.html).toContain("Marked as true.");
    // Only the reminder is left; it does not block approving, and it still shows.
    expect(ticked.html).toContain('name="op" value="approve"');
    expect(ticked.html).toContain("Check your local advertising rules before posting.");
    expect((await press(token, { op: "approve" })).html).toContain("Your post is approved");
  });

  it("a word to avoid can be removed from the page but not confirmed", async () => {
    const flag = makeFlag({ text: "cheap", kind: "avoid" });
    await setPost(db, avoid.postIds[0], "caption = 'A cheap and cheerful loaf for you.'");
    await setFlags(db, avoid.postIds[0], [flag]);
    const token = await sign(avoid, "approve", 0);
    const page = (await view(token)).html;
    expect(page).toContain("Remove it");
    expect(page).not.toContain("This is true");
    const done = await press(token, { op: "remove_flag", flag: flag.id });
    expect(done.html).toContain("Removed from the post.");
    expect((await postRow(db, avoid.postIds[0])).caption).toBe("A and cheerful loaf for you.");
  });

  it("an unknown op does nothing", async () => {
    const r = await press(await sign(a, "approve", 0), { op: "delete_everything" });
    expect(decode(r.html)).toContain("That did not work. Nothing was changed.");
    expect(await status(a.postIds[0])).toBe("draft");
  });
});

describe("a link is for one post of one brand", () => {
  it("a token for post A cannot act on post B, whatever the form says", async () => {
    const tokenA = await sign(a, "approve", 0);
    const res = await press(tokenA, { op: "approve", post: a.postIds[2], postId: a.postIds[2], post_id: a.postIds[2] });
    expect(res.html).toContain("Approved");
    expect(await status(a.postIds[0])).toBe("approved");
    expect(await status(a.postIds[2])).toBe("draft");

    // A flag id that belongs to B is not found on A's page.
    await setFlags(db, a.postIds[3], [makeFlag({ id: "f_only_on_b", text: "9 stars", kind: "claim" })]);
    const r = await press(tokenA, { op: "confirm_flag", flag: "f_only_on_b" });
    expect(decode(r.html)).toContain("could not find that item");
    expect((await flagsOf(db, a.postIds[3]))[0].status).toBe("open");
    await setFlags(db, a.postIds[3], []);
    await press(tokenA, { op: "undo" });
  });

  it("a token that names a post of another brand is not found, on GET and on POST", async () => {
    const forged = await signLink({ brandId: a.brandId, postId: other.postIds[0], act: "approve" });
    expect((await openLink(forged)).status).toBe(404);
    const claims = (await verifyLink(forged))!;
    const secret = newCsrfSecret();
    const form = new FormData();
    form.set("nonce", linkNonce(claims.jti, secret));
    form.set("op", "approve");
    const res = await handleLinkPost(forged, form, secret);
    expect(res.status).toBe(404);
    expect(await status(other.postIds[0])).toBe("draft");
  });

  it("an expired token (14 days) is refused on GET and POST, and nothing changes", async () => {
    const t0 = new Date("2026-11-09T08:00:00Z");
    const token = await sign(a, "approve", 2, t0);
    const inside = new Date(t0.getTime() + 13 * 24 * 3600_000 + 23 * 3600_000);
    const outside = new Date(t0.getTime() + 14 * 24 * 3600_000 + 60_000);
    const got = await handleLinkGet(token, undefined, inside);
    expect(got.status).toBe(200);
    expect((await handleLinkGet(token, undefined, outside)).status).toBe(410);
    const form = new FormData();
    form.set("nonce", nonceOf(got.html));
    form.set("op", "approve");
    const late = await handleLinkPost(token, form, got.cookie!.value, outside);
    expect(late.status).toBe(410);
    expect(late.html).toContain("14 days");
    expect(await status(a.postIds[2])).toBe("draft");
    // Just inside the 14 days it works.
    expect((await handleLinkPost(token, form, got.cookie!.value, inside)).status).toBe(200);
    expect(await status(a.postIds[2])).toBe("approved");
    await press(await sign(a, "approve", 2), { op: "undo" });
  });
});

describe("skip", () => {
  it("asks first, skips on POST, and Undo brings it back", async () => {
    const token = await sign(a, "skip", 2);
    const ask = await view(token);
    expect(ask.html).toContain("Skip this post?");
    expect(await status(a.postIds[2])).toBe("draft");
    const done = await press(token, { op: "skip" });
    expect(done.html).toContain("Skipped");
    expect(done.html).toContain('name="op" value="undo"');
    expect(await status(a.postIds[2])).toBe("skipped");
    expect((await postRow(db, a.postIds[2])).skipped_at).not.toBeNull();
    const undone = await press(token, { op: "undo" });
    expect(undone.html).toContain("Skip this post?");
    expect(await status(a.postIds[2])).toBe("draft");
    const log = (await actionsOf(db, a.postIds[2])).map((l) => l.action);
    expect(log.slice(-2)).toEqual(["skip", "undo"]);
  });
});

describe("edit page (Req 15)", () => {
  it("has the fields, a photo picker with thumbnails and no photo, a rewrite box with chips, and previews of the other sizes", async () => {
    const page = (await view(await sign(a, "edit", 0))).html;
    expect(page).toContain("Edit this post");
    for (const name of ["caption", "cta", "hashtags", "headline", "subline"]) expect(page).toContain(`name="${name}"`);
    expect(page.match(/type="radio" name="photo"/g)).toHaveLength(3); // 2 photos + none
    expect(page).toContain("No photo (text only)");
    for (const chip of ["Shorter", "Less salesy", "More friendly", "Add an emoji"]) expect(page).toContain(`name="chip" value="${chip}"`);
    expect(page).toContain("Rewrite with an instruction");
    expect(page).toContain('name="instruction"');
    expect(page).toContain("Review and approve");
    expect(page).not.toContain("<script");

    // Every picture on the page is a signed /i/ URL that serves a JPEG: square, the two other sizes, and photo thumbnails.
    const urls = [...page.matchAll(/src="\/i\/([\w.-]+)"/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThanOrEqual(5);
    const sizes: string[] = [];
    for (const u of urls) {
      const res = await serveEmailImage({ token: u, storage: store.storage });
      expect(res.status).toBe(200);
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
      expect(meta.format).toBe("jpeg");
      sizes.push(`${meta.width}x${meta.height}`);
    }
    expect(sizes).toContain("600x600");
    expect(sizes).toContain("600x1067");
    expect(sizes).toContain("600x315");
    expect(sizes.filter((s) => s === "240x240")).toHaveLength(2);
  });

  it("a photo thumbnail token cannot show another brand's photo", async () => {
    const forged = await signLink({ brandId: a.brandId, postId: a.postIds[0], act: "img", extra: { photo: other.photoIds[0] } });
    expect((await serveEmailImage({ token: forged, storage: store.storage })).status).toBe(404);
  });

  it("saves the owner's words, with hashtags separated by commas or spaces, and says Saved", async () => {
    const token = await sign(a, "edit", 0);
    const r = await press(token, { op: "save", caption: "A line of my own.\nAnd another.", cta: "Ring us now", hashtags: "bread, #fresh  local", headline: "My headline", subline: "My subline" });
    expect(r.html).toContain("Saved.");
    const row = await postRow(db, a.postIds[0]);
    expect(row).toMatchObject({ caption: "A line of my own.\nAnd another.", cta: "Ring us now", hashtags: ["#bread", "#fresh", "#local"], image_text: { headline: "My headline", subline: "My subline" } });
    expect(r.html).toContain("A line of my own.");
    expect(r.html).toContain("#bread #fresh #local");
    expect((await actionsOf(db, a.postIds[0])).at(-1)).toMatchObject({ action: "edit", via: "email_link" });
  });

  it("shows validation errors, keeps what was typed, and saves nothing", async () => {
    const token = await sign(avoid, "edit", 0);
    const before = await postRow(db, avoid.postIds[0]);
    const bad = "A Cheap loaf <b>today</b>";
    const r = await press(token, { op: "save", caption: bad, cta: before.cta as string, hashtags: (before.hashtags as string[]).join(" "), headline: "", subline: "" });
    expect(r.html).toContain("Please fix this first");
    expect(decode(r.html)).toContain('"Cheap" is on your list of words to avoid');
    expect(r.html).toContain("A Cheap loaf &lt;b&gt;today&lt;/b&gt;"); // typed text kept, escaped
    expect(r.html).not.toContain("<b>today</b>");
    expect(await postRow(db, avoid.postIds[0])).toEqual(before);

    const long = await press(token, { op: "save", caption: "x".repeat(1300), cta: "", hashtags: "", headline: "", subline: "" });
    expect(decode(long.html)).toContain("The caption is too long for Instagram");
  });

  it("swaps the photo, redraws the images, and offers 'use it anyway' for a low quality one", async () => {
    const token = await sign(a, "edit", 3);
    const [p1, p2] = a.photoIds;
    const done = await press(token, { op: "photo", photo: p2 });
    expect(done.html).toContain("Photo changed.");
    expect((await postRow(db, a.postIds[3])).photo_id).toBe(p2);
    expect(await imageRows(db, a.postIds[3])).toHaveLength(3);

    await rows("update public.photos set usable = false where id = $1", [p1]);
    const refused = await press(token, { op: "photo", photo: p1 });
    expect(refused.html).toContain("looks dark or blurry");
    expect(refused.html).toContain("Use it anyway");
    expect(refused.html).toContain("Looks dark or blurry");
    expect((await postRow(db, a.postIds[3])).photo_id).toBe(p2);
    const insisted = await press(token, { op: "photo", photo: p1, insist: "1" });
    expect(insisted.html).toContain("It may look dark or blurry");
    expect((await postRow(db, a.postIds[3])).photo_id).toBe(p1);
    await rows("update public.photos set usable = true where id = $1", [p1]);

    const none = await press(token, { op: "photo", photo: "none" });
    expect(none.html).toContain("Photo changed.");
    expect((await postRow(db, a.postIds[3])).photo_id).toBeNull();
    // A photo of another brand, or nothing chosen, changes nothing.
    const foreign = await press(token, { op: "photo", photo: other.photoIds[0] });
    expect(decode(foreign.html)).toContain("could not find that photo");
    expect((await postRow(db, a.postIds[3])).photo_id).toBeNull();
    expect(decode((await press(token, { op: "photo" })).html)).toContain("Choose a photo first.");
  });

  it("rewrites with a chip or a typed instruction, shows the new version and how long it took, and saves the instruction", async () => {
    const token = await sign(a, "edit", 0);
    const before = (await postRow(db, a.postIds[0])).caption as string;
    const t0 = Date.now();
    const r = await press(token, { op: "rewrite", chip: "Shorter", instruction: "" });
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(r.html).toContain("Here is the new version.");
    expect(r.html).toMatch(/Done in \d+\.\d seconds\./);
    expect(r.html).toContain("We saved your instruction");
    const after = (await postRow(db, a.postIds[0])).caption as string;
    expect(after.length).toBeLessThan(before.length);
    expect(r.html).toContain(after.split("\n")[0]);
    const fb = await rows("select instruction, post_id::text as post_id from public.voice_feedback where brand_id = $1", [a.brandId]);
    expect(fb).toEqual([{ instruction: "Shorter", post_id: a.postIds[0] }]);

    const typed = await press(token, { op: "rewrite", instruction: "Mention the weekend" });
    expect(typed.html).toContain("Here is the new version.");
    expect((await rows("select instruction from public.voice_feedback where brand_id = $1 order by created_at", [a.brandId])).map((x) => x.instruction)).toEqual(["Shorter", "Mention the weekend"]);

    const tooShort = await press(token, { op: "rewrite", instruction: "ab" });
    expect(decode(tooShort.html)).toContain("between 3 and 200 characters");
  });

  it("editing an approved post tells the owner to approve it again", async () => {
    await press(await sign(a, "approve", 0), { op: "approve" });
    expect(await status(a.postIds[0])).toBe("approved");
    const r = await press(await sign(a, "edit", 0), { op: "save", caption: "Words changed after approval.", cta: "Ring us now", hashtags: "#a #b #c", headline: "H", subline: "" });
    expect(r.html).toContain("please approve it again");
    expect(await status(a.postIds[0])).toBe("draft");
  });
});

describe("ready to share (Req 16)", () => {
  it("lists the week's approved posts with picture, caption and channel, and nothing else", async () => {
    await rows("update public.posts set status = 'draft', approved_at = null where brand_id = $1", [a.brandId]);
    const empty = await view(await sign(a, "ready"));
    expect(empty.status).toBe(200);
    expect(empty.html).toContain("Ready to share");
    expect(empty.html).toContain("Nothing is approved yet.");
    expect(empty.html).not.toMatch(/<img /);

    await setFlags(db, a.postIds[1], []);
    await press(await sign(a, "approve", 0), { op: "approve" });
    await press(await sign(a, "approve", 1), { op: "approve" });
    const caps = [(await postRow(db, a.postIds[0])).caption, (await postRow(db, a.postIds[1])).caption, (await postRow(db, a.postIds[2])).caption] as string[];
    const page = (await view(await sign(a, "ready"))).html;
    expect(page.match(/<img /g)).toHaveLength(2);
    expect(page).toContain(caps[0].split("\n")[0]);
    expect(page).toContain(caps[1].split("\n")[0]);
    expect(page).not.toContain(caps[2].split("\n")[0]);
    expect(page).toContain("Instagram");
    expect(page).toContain("Facebook");
    expect(page).toContain("Approved posts for the week of 21 Dec");
    expect(page).toContain("See all posts for this week");
    // A POST just shows the list again.
    const readyToken = await sign(a, "ready");
    const claims = (await verifyLink(readyToken))!;
    const secret = newCsrfSecret();
    const form = new FormData();
    form.set("nonce", linkNonce(claims.jti, secret));
    const posted = await handleLinkPost(readyToken, form, secret);
    expect(posted.status).toBe(200);
    expect(posted.html).toContain("Ready to share");
  });

  it("does not show another brand's approved posts", async () => {
    await rows("update public.posts set status = 'approved', approved_at = now() where id = $1", [other.postIds[0]]);
    const page = (await view(await sign(a, "ready"))).html;
    const otherCaption = ((await postRow(db, other.postIds[0])).caption as string).split("\n")[0];
    // Same fixture captions: count pictures instead. a has two approved posts.
    expect(page.match(/<img /g)).toHaveLength(2);
    expect(otherCaption.length).toBeGreaterThan(0);
  });
});

describe("a brand that unsubscribed still reaches the weeks it was sent", () => {
  it("approve, skip, edit, ready and view_week keep working; only the check-in stays off", async () => {
    await rows("update public.brand_memory set email_unsubscribed_at = now() where brand_id = $1", [off.brandId]);
    for (const act of ["approve", "skip", "edit"] as const) {
      expect((await openLink(await sign(off, act, 0))).status, act).toBe(200);
    }
    expect((await openLink(await sign(off, "ready"))).status).toBe(200);
    expect((await openLink(await sign(off, "view_week"))).status).toBe(200);
    expect((await openLink(await signLink({ brandId: off.brandId, act: "checkin", weekStart: "2026-12-14", extra: { answer: "few" } }))).status).toBe(403);

    expect((await press(await sign(off, "approve", 0), { op: "approve" })).html).toContain("Your post is approved");
    expect(await status(off.postIds[0])).toBe("approved");
    expect((await press(await sign(off, "skip", 2), { op: "skip" })).html).toContain("Skipped");
    expect(await status(off.postIds[2])).toBe("skipped");
    expect((await press(await sign(off, "edit", 3), { op: "save", caption: "Still editable.", cta: "Hi", hashtags: "", headline: "H", subline: "" })).html).toContain("Saved.");
    expect((await postRow(db, off.postIds[3])).caption).toBe("Still editable.");
    // The email itself stays off.
    const [mem] = await rows("select email_unsubscribed_at from public.brand_memory where brand_id = $1", [off.brandId]);
    expect(mem.email_unsubscribed_at).not.toBeNull();
  });
});

describe("what gets logged", () => {
  it("every email-link action has via email_link, no user and only a jti hash", async () => {
    const all = await rows("select via, user_id, detail from public.post_actions where brand_id = any($1::uuid[])", [[a.brandId, avoid.brandId, off.brandId]]);
    expect(all.length).toBeGreaterThan(10);
    for (const l of all) {
      expect(l.via).toBe("email_link");
      expect(l.user_id).toBeNull();
      expect((l.detail as Row).jti_hash).toMatch(/^[0-9a-f]{12}$/);
      expect(JSON.stringify(l.detail)).not.toContain("eyJ");
    }
  });
});
