import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvePost, confirmFlag, editPost, removeFlag, skipPost, swapPhoto, undoPost } from "@/lib/approvals/ops";
import { parseHashtags } from "@/lib/approvals/parse";
import type { Actor } from "@/lib/approvals/types";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { FORMAT_SIZE } from "@/lib/render";
import { jtiHash } from "@/lib/links/tokens";
import { PLANTED_PRICE } from "@/lib/weekly/fixtures";
import { createBrandFor, createUser } from "../brand/helpers";
import { tempStorage } from "../weekly/helpers";
import {
  actionsOf,
  dashActor,
  emailActor,
  flagsOf,
  freshWeek,
  hasEmailImage,
  imageBytes,
  imageRows,
  makeFlag,
  postRow,
  putEmailImage,
  refOf,
  setFlags,
  setPost,
  type FreshWeek,
  type Row,
} from "./helpers";

let db: MockDb;
let store: Awaited<ReturnType<typeof tempStorage>>;
let basic: FreshWeek; // approve, skip, undo
let flagged: FreshWeek; // flags
let editing: FreshWeek; // edit, photo
let other: FreshWeek;

const NOW = new Date("2026-12-22T10:00:00Z");
const deps = () => ({ storage: store.storage, now: NOW });

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
  store = await tempStorage();
  basic = await freshWeek(db, store.storage);
  flagged = await freshWeek(db, store.storage);
  editing = await freshWeek(db, store.storage, { wordsToAvoid: ["cheap"] });
  other = await freshWeek(db, store.storage);
}, 240_000);
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
  await store.cleanup();
});

const actors: Array<[string, (w: FreshWeek) => Actor]> = [
  ["an email link", () => emailActor("jti-ops-1")],
  ["the dashboard", (w) => dashActor(w.userId)],
];

describe.each(actors)("approve, skip and undo through %s", (name, actorFor) => {
  const via = name === "the dashboard" ? "dashboard" : "email_link";
  const idx = name === "the dashboard" ? 2 : 0; // post 0 and 2 have no open flags
  const actor = () => actorFor(basic);
  const logged = async (postId: string) => (await actionsOf(db, postId)).filter((a) => a.via === via);

  it("approves a post with no open flags, sets approved_at and logs who did it", async () => {
    const r = await approvePost(refOf(basic, idx, actor()), deps());
    expect(r).toMatchObject({ ok: true, changed: true });
    const row = await postRow(db, basic.postIds[idx]);
    expect(row.status).toBe("approved");
    expect(new Date(row.approved_at as string).toISOString()).toBe(NOW.toISOString());
    const [log] = await logged(basic.postIds[idx]);
    expect(log).toMatchObject({ action: "approve", via, brand_id: basic.brandId });
    if (via === "dashboard") {
      expect(log.user_id).toBe(basic.userId);
      expect(log.detail).toEqual({});
    } else {
      expect(log.user_id).toBeNull();
      expect(log.detail).toEqual({ jti_hash: jtiHash("jti-ops-1") });
    }
  });

  it("approving again changes nothing and logs nothing more", async () => {
    const before = (await actionsOf(db, basic.postIds[idx])).length;
    const r = await approvePost(refOf(basic, idx, actor()), deps());
    expect(r).toMatchObject({ ok: true, changed: false });
    expect((await actionsOf(db, basic.postIds[idx])).length).toBe(before);
  });

  it("undo sends an approved post back to draft and clears the time", async () => {
    const r = await undoPost(refOf(basic, idx, actor()));
    expect(r).toMatchObject({ ok: true, changed: true, from: "approved" });
    const row = await postRow(db, basic.postIds[idx]);
    expect(row).toMatchObject({ status: "draft", approved_at: null, skipped_at: null });
    expect((await logged(basic.postIds[idx])).map((a) => a.action)).toEqual(["approve", "undo"]);
  });

  it("skips a post, and undo (or approving) brings it back", async () => {
    const skip = await skipPost(refOf(basic, idx, actor()), deps());
    expect(skip).toMatchObject({ ok: true, changed: true });
    expect(await postRow(db, basic.postIds[idx])).toMatchObject({ status: "skipped", approved_at: null });
    expect((await postRow(db, basic.postIds[idx])).skipped_at).not.toBeNull();
    expect(await skipPost(refOf(basic, idx, actor()), deps())).toMatchObject({ ok: true, changed: false });

    expect(await undoPost(refOf(basic, idx, actor()))).toMatchObject({ ok: true, changed: true, from: "skipped" });
    expect(await postRow(db, basic.postIds[idx])).toMatchObject({ status: "draft", skipped_at: null });

    await skipPost(refOf(basic, idx, actor()), deps());
    expect(await approvePost(refOf(basic, idx, actor()), deps())).toMatchObject({ ok: true, changed: true });
    expect(await postRow(db, basic.postIds[idx])).toMatchObject({ status: "approved", skipped_at: null });
    await undoPost(refOf(basic, idx, actor()));
  });

  it("undo on a draft is a quiet no-op", async () => {
    const before = (await actionsOf(db, basic.postIds[idx])).length;
    expect(await undoPost(refOf(basic, idx, actor()))).toMatchObject({ ok: true, changed: false });
    expect((await actionsOf(db, basic.postIds[idx])).length).toBe(before);
  });
});

describe("a posted post is final", () => {
  it("cannot be approved, skipped, undone, edited, photo-swapped or have flags answered", async () => {
    const w = basic;
    await setPost(db, w.postIds[1], "status = 'posted', posted_at = now()");
    const ref = refOf(w, 1, emailActor());
    const flag = (await flagsOf(db, w.postIds[1]))[0];
    const results = [
      await approvePost(ref),
      await skipPost(ref),
      await undoPost(ref),
      await editPost({ ...ref, input: { caption: "New words" } }),
      await swapPhoto({ ...ref, photoId: null }),
      await confirmFlag({ ...ref, flagId: flag.id }),
      await removeFlag({ ...ref, flagId: flag.id }),
    ];
    for (const r of results) expect(r).toMatchObject({ ok: false, code: "posted" });
    expect((await postRow(db, w.postIds[1])).status).toBe("posted");
    expect(await actionsOf(db, w.postIds[1])).toHaveLength(0);
  });
});

describe("flags block approval (Req 11, 12)", () => {
  const ref = (i: number, actor: Actor = emailActor("jti-flags")) => refOf(flagged, i, actor);

  it("approve is refused while flags are open, and returns them", async () => {
    const r = await approvePost(ref(1), deps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("blocked");
    expect(r.flags?.map((f) => f.text)).toContain(PLANTED_PRICE);
    expect(r.flags?.every((f) => f.status === "open")).toBe(true);
    expect((await postRow(db, flagged.postIds[1])).status).toBe("draft");
    expect(await actionsOf(db, flagged.postIds[1])).toHaveLength(0);
  });

  it("confirming every flag lets the post be approved", async () => {
    const flags = await flagsOf(db, flagged.postIds[1]);
    const open = flags.filter((f) => f.status === "open");
    expect(open.length).toBeGreaterThanOrEqual(1);
    for (const f of open) {
      const r = await confirmFlag({ ...ref(1), flagId: f.id }, deps());
      expect(r.ok).toBe(true);
    }
    const after = await flagsOf(db, flagged.postIds[1]);
    expect(after.filter((f) => f.status === "confirmed").length).toBe(open.length);
    expect(after.find((f) => f.id === open[0].id)?.decided_at).toBe(NOW.toISOString());
    expect(await approvePost(ref(1), deps())).toMatchObject({ ok: true, changed: true });
    const log = (await actionsOf(db, flagged.postIds[1])).map((a) => `${a.action}:${(a.detail as Row).decision ?? ""}`);
    expect(log).toEqual([...open.map(() => "edit:confirm"), "approve:"]);
  });

  it("removing every flag also lets a post be approved, and cuts the text out", async () => {
    // Put the planted price back on another post and remove it instead of confirming.
    const caption = `Fresh bread today. Our loaf is ${PLANTED_PRICE} this week. Come in and see us.`;
    const flag = makeFlag({ text: PLANTED_PRICE, kind: "price", field: "caption" });
    await setPost(db, flagged.postIds[0], "caption = $2", [caption]);
    await setFlags(db, flagged.postIds[0], [flag]);
    expect(await approvePost(ref(0), deps())).toMatchObject({ ok: false, code: "blocked" });

    const r = await removeFlag({ ...ref(0), flagId: flag.id }, deps());
    expect(r.ok).toBe(true);
    const row = await postRow(db, flagged.postIds[0]);
    expect(row.caption).toBe("Fresh bread today. Our loaf is this week. Come in and see us.");
    expect((row.fact_flags as Array<{ status: string }>)[0].status).toBe("removed");
    expect(new Date(row.edited_at as string).toISOString()).toBe(NOW.toISOString());
    expect(await approvePost(ref(0), deps())).toMatchObject({ ok: true });
  });

  it("a regulated flag needs the extra acknowledgement", async () => {
    const flag = makeFlag({ text: "pain-free dentistry", kind: "claim", field: "caption", regulated: true });
    await setPost(db, flagged.postIds[2], "caption = 'We offer pain-free dentistry for all.'");
    await setFlags(db, flagged.postIds[2], [flag]);
    for (const regulatedAck of [undefined, false]) {
      const r = await confirmFlag({ ...ref(2), flagId: flag.id, regulatedAck }, deps());
      expect(r).toMatchObject({ ok: false, code: "ack_required" });
    }
    expect((await flagsOf(db, flagged.postIds[2]))[0].status).toBe("open");
    expect(await approvePost(ref(2), deps())).toMatchObject({ ok: false, code: "blocked" });

    const ok = await confirmFlag({ ...ref(2), flagId: flag.id, regulatedAck: true }, deps());
    expect(ok.ok).toBe(true);
    expect((await flagsOf(db, flagged.postIds[2]))[0].status).toBe("confirmed");
    expect(await approvePost(ref(2), deps())).toMatchObject({ ok: true });
  });

  it("the regulated reminder never blocks and cannot be confirmed", async () => {
    const reminder = makeFlag({ text: "Check your local advertising rules before posting.", kind: "regulated_reminder", regulated: true, highlight: false });
    await setFlags(db, flagged.postIds[3], [reminder]);
    expect(await confirmFlag({ ...ref(3), flagId: reminder.id, regulatedAck: true })).toMatchObject({ ok: false, code: "must_edit" });
    expect(await removeFlag({ ...ref(3), flagId: reminder.id })).toMatchObject({ ok: false, code: "cannot_remove" });
    expect(await approvePost(ref(3), deps())).toMatchObject({ ok: true });
  });

  it("a word to avoid cannot be confirmed but can be removed", async () => {
    const w = editing;
    const flag = makeFlag({ text: "cheap", kind: "avoid", field: "caption" });
    await setPost(db, w.postIds[0], "caption = 'A cheap and cheerful loaf.'");
    await setFlags(db, w.postIds[0], [flag]);
    expect(await confirmFlag({ ...refOf(w, 0, emailActor()), flagId: flag.id })).toMatchObject({ ok: false, code: "must_edit" });
    const r = await removeFlag({ ...refOf(w, 0, emailActor()), flagId: flag.id }, deps());
    expect(r.ok).toBe(true);
    expect((await postRow(db, w.postIds[0])).caption).toBe("A and cheerful loaf.");
  });

  it("unknown, already decided and unlocatable flags are refused", async () => {
    const r = ref(1);
    expect(await confirmFlag({ ...r, flagId: "f_nope" })).toMatchObject({ ok: false, code: "not_found" });
    expect(await removeFlag({ ...r, flagId: "f_nope" })).toMatchObject({ ok: false, code: "not_found" });
    const decided = (await flagsOf(db, flagged.postIds[1])).find((f) => f.status === "confirmed")!;
    expect(await confirmFlag({ ...r, flagId: decided.id })).toMatchObject({ ok: false, code: "not_open" });
    expect(await removeFlag({ ...r, flagId: decided.id })).toMatchObject({ ok: false, code: "not_open" });
    const loose = makeFlag({ text: "Facts not checked; please review before sharing", kind: "claim", highlight: false });
    await setFlags(db, flagged.postIds[1], [loose]);
    expect(await removeFlag({ ...r, flagId: loose.id })).toMatchObject({ ok: false, code: "cannot_remove" });
  });

  it("removing the only text of the caption is refused", async () => {
    const flag = makeFlag({ text: "Everything", kind: "claim" });
    await setPost(db, flagged.postIds[3], "caption = 'Everything'");
    await setFlags(db, flagged.postIds[3], [flag]);
    expect(await removeFlag({ ...ref(3), flagId: flag.id })).toMatchObject({ ok: false, code: "cannot_remove" });
  });

  it("removing a flag on the image redraws the images and drops the cached email picture; a caption flag does not", async () => {
    const w = editing;
    const subline = makeFlag({ text: PLANTED_PRICE, kind: "price", field: "image_text.subline" });
    await setPost(db, w.postIds[1], "image_text = $2::jsonb", [JSON.stringify({ headline: "Weekend box", subline: `Only ${PLANTED_PRICE} this week` })]);
    await setFlags(db, w.postIds[1], [subline]);
    const before = await imageBytes(store.storage, w.brandId, w.postIds[1], "square");
    await putEmailImage(store.storage, w.brandId, w.postIds[1]);

    const r = await removeFlag({ ...refOf(w, 1, emailActor()), flagId: subline.id }, deps());
    expect(r.ok).toBe(true);
    expect((await postRow(db, w.postIds[1])).image_text).toEqual({ headline: "Weekend box", subline: "Only this week" });
    const after = await imageBytes(store.storage, w.brandId, w.postIds[1], "square");
    expect(after.equals(before)).toBe(false);
    expect(await hasEmailImage(store.storage, w.brandId, w.postIds[1])).toBe(false);

    // A caption flag changes no picture.
    const cap = makeFlag({ text: "$9.99", kind: "price", field: "caption" });
    await setPost(db, w.postIds[1], "caption = 'Now $9.99 only.'");
    await setFlags(db, w.postIds[1], [cap]);
    const square = await imageBytes(store.storage, w.brandId, w.postIds[1], "square");
    await removeFlag({ ...refOf(w, 1, emailActor()), flagId: cap.id }, deps());
    expect((await imageBytes(store.storage, w.brandId, w.postIds[1], "square")).equals(square)).toBe(true);
  });
});

describe("edit (Req 15)", () => {
  const usageCount = async () => (await db.withAdmin((tx) => tx.query<{ n: number }>("select count(*)::int as n from public.usage_events where brand_id = $1", [editing.brandId])))[0].n;
  const ref = (i: number, actor: Actor = emailActor("jti-edit")) => refOf(editing, i, actor);

  it("parses hashtags separated by commas or spaces", () => {
    expect(parseHashtags("bread, #fresh  local;#bread\n#x")).toEqual(["#bread", "#fresh", "#local", "#x"]);
    expect(parseHashtags("   ")).toEqual([]);
  });

  it("saves the owner's words, sets edited_at, leaves `original` alone, and does not call the AI check", async () => {
    const before = await postRow(db, editing.postIds[2]);
    expect(before.edited_at).toBeNull();
    const usageBefore = await usageCount();
    const r = await editPost({ ...ref(2), input: { caption: "Our own words.\r\nSecond line.", hashtags: ["#bread", "#local", "#fresh"] } }, deps());
    expect(r).toMatchObject({ ok: true, changed: true, reapprove: false });
    const row = await postRow(db, editing.postIds[2]);
    expect(row.caption).toBe("Our own words.\nSecond line.");
    expect(row.hashtags).toEqual(["#bread", "#local", "#fresh"]);
    expect(new Date(row.edited_at as string).toISOString()).toBe(NOW.toISOString());
    expect(row.original).toEqual(before.original);
    expect(await usageCount()).toBe(usageBefore);
    expect((await actionsOf(db, editing.postIds[2])).at(-1)).toMatchObject({ action: "edit", via: "email_link" });
  });

  it("an owner's price is a source: it is not flagged", async () => {
    const r = await editPost({ ...ref(2), input: { caption: "Loaves are now £7.25 each." } }, deps());
    expect(r.ok).toBe(true);
    expect((await flagsOf(db, editing.postIds[2])).filter((f) => f.status === "open")).toHaveLength(0);
  });

  it("an unchanged edit saves nothing and logs nothing", async () => {
    const before = (await actionsOf(db, editing.postIds[2])).length;
    const row = await postRow(db, editing.postIds[2]);
    const r = await editPost({ ...ref(2), input: { caption: row.caption as string, cta: row.cta as string } }, deps());
    expect(r).toMatchObject({ ok: true, changed: false });
    expect((await actionsOf(db, editing.postIds[2])).length).toBe(before);
  });

  it("refuses a word to avoid, case-insensitively, in any field the owner changed, and saves nothing", async () => {
    const before = await postRow(db, editing.postIds[3]);
    for (const input of [
      { caption: "A Cheap deal for you." },
      { cta: "Cheap today" },
      { image_text: { headline: "Cheap!" } },
      { image_text: { subline: "so cheap" } },
    ]) {
      const r = await editPost({ ...ref(3), input }, deps());
      expect(r).toMatchObject({ ok: false, code: "invalid" });
      if (!r.ok) expect(r.errors?.[0].toLowerCase()).toContain("cheap");
    }
    const after = await postRow(db, editing.postIds[3]);
    expect(after).toEqual(before);
    // Whole words only.
    expect((await editPost({ ...ref(3), input: { caption: "Cheaper by the dozen? No, just fair." } }, deps())).ok).toBe(true);
  });

  it("enforces the channel limits as validation errors", async () => {
    const ig = 0; // instagram: 1200 characters, at most 8 hashtags
    const cases: Array<[Parameters<typeof editPost>[0]["input"], string]> = [
      [{ caption: "x".repeat(1201) }, "1200"],
      [{ caption: "   " }, "empty"],
      [{ hashtags: Array.from({ length: 9 }, (_, i) => `#t${i}`) }, "8"],
      [{ cta: "y".repeat(46) }, "45"],
      [{ image_text: { headline: "h".repeat(41) } }, "40"],
      [{ image_text: { subline: "s".repeat(71) } }, "70"],
    ];
    for (const [input, hint] of cases) {
      const r = await editPost({ ...ref(ig), input }, deps());
      expect(r, JSON.stringify(input).slice(0, 40)).toMatchObject({ ok: false, code: "invalid" });
      if (!r.ok) expect(r.errors?.join(" ")).toContain(hint);
    }
    // Exactly at the limits is fine.
    const ok = await editPost({ ...ref(ig), input: { caption: "x".repeat(1200), cta: "y".repeat(45), image_text: { headline: "h".repeat(40), subline: "s".repeat(70) } } }, deps());
    expect(ok.ok).toBe(true);
    // GBP allows at most 3 hashtags.
    const gbp = await editPost({ ...ref(3), input: { hashtags: ["#a", "#b", "#c", "#d"] } }, deps());
    expect(gbp).toMatchObject({ ok: false, code: "invalid" });
  });

  it("resolveRemovedSpans runs: an open flag whose text is gone becomes removed, the others stay open", async () => {
    const w = editing;
    const priceCap = makeFlag({ text: PLANTED_PRICE, kind: "price", field: "caption" });
    const priceSub = makeFlag({ id: "f_test_subline", text: PLANTED_PRICE, kind: "price", field: "image_text.subline" });
    await setPost(db, w.postIds[1], "caption = $2, image_text = $3::jsonb", [`Box for ${PLANTED_PRICE} today.`, JSON.stringify({ headline: "Box", subline: `Only ${PLANTED_PRICE}` })]);
    await setFlags(db, w.postIds[1], [priceCap, priceSub]);
    const r = await editPost({ ...ref(1), input: { caption: "Box for a fair price today." } }, deps());
    expect(r.ok).toBe(true);
    const flags = await flagsOf(db, w.postIds[1]);
    expect(flags.find((f) => f.id === priceCap.id)).toMatchObject({ status: "removed", decided_at: NOW.toISOString() });
    expect(flags.find((f) => f.id === priceSub.id)?.status).toBe("open");
  });

  it("redraws the images and drops the cached email picture only when the image text or call to action changed", async () => {
    const w = editing;
    const i = 2;
    await putEmailImage(store.storage, w.brandId, w.postIds[i]);
    const sq = await imageBytes(store.storage, w.brandId, w.postIds[i], "square");
    await editPost({ ...refOf(w, i, emailActor()), input: { caption: "Different words only." } }, deps());
    // email.jpg is dropped on every change (the copy changed), but the picture itself is unchanged.
    expect((await imageBytes(store.storage, w.brandId, w.postIds[i], "square")).equals(sq)).toBe(true);

    await putEmailImage(store.storage, w.brandId, w.postIds[i]);
    const r = await editPost({ ...refOf(w, i, emailActor()), input: { image_text: { headline: "A brand new headline" } } }, deps());
    expect(r.ok).toBe(true);
    expect((await imageBytes(store.storage, w.brandId, w.postIds[i], "square")).equals(sq)).toBe(false);
    expect(await hasEmailImage(store.storage, w.brandId, w.postIds[i])).toBe(false);

    const cta = await imageBytes(store.storage, w.brandId, w.postIds[i], "vertical");
    await editPost({ ...refOf(w, i, emailActor()), input: { cta: "Call us today" } }, deps());
    expect((await imageBytes(store.storage, w.brandId, w.postIds[i], "vertical")).equals(cta)).toBe(false);
  });

  it("editing an approved post sends it back to draft", async () => {
    await approvePost(ref(0), deps());
    expect((await postRow(db, editing.postIds[0])).status).toBe("approved");
    const r = await editPost({ ...ref(0, dashActor(editing.userId)), input: { caption: "Reworded after approval." } }, deps());
    expect(r).toMatchObject({ ok: true, reapprove: true });
    expect(await postRow(db, editing.postIds[0])).toMatchObject({ status: "draft", approved_at: null });
    const last = (await actionsOf(db, editing.postIds[0])).at(-1)!;
    expect(last).toMatchObject({ action: "edit", via: "dashboard", user_id: editing.userId });
  });
});

describe("swap photo (Req 15)", () => {
  const ref = (i: number, actor: Actor = emailActor("jti-photo")) => refOf(editing, i, actor);

  it("a photo of the brand redraws all three formats at their sizes and logs swap_photo", async () => {
    const i = 0;
    const [first, second] = editing.photoIds;
    const current = (await postRow(db, editing.postIds[i])).photo_id;
    const target = current === first ? second : first;
    // The fixture photos are the same picture; make the target look different.
    const red = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#cc0000" } }).jpeg().toBuffer();
    await store.storage.put("photos", `${editing.brandId}/${target}.jpg`, red, "image/jpeg");
    const before = {
      square: await imageBytes(store.storage, editing.brandId, editing.postIds[i], "square"),
      vertical: await imageBytes(store.storage, editing.brandId, editing.postIds[i], "vertical"),
      landscape: await imageBytes(store.storage, editing.brandId, editing.postIds[i], "landscape"),
    };
    await putEmailImage(store.storage, editing.brandId, editing.postIds[i]);

    const r = await swapPhoto({ ...ref(i), photoId: target }, deps());
    expect(r).toMatchObject({ ok: true, warning: false });
    expect((await postRow(db, editing.postIds[i])).photo_id).toBe(target);
    for (const f of ["square", "vertical", "landscape"] as const) {
      const bytes = await imageBytes(store.storage, editing.brandId, editing.postIds[i], f);
      const meta = await sharp(bytes).metadata();
      expect([meta.width, meta.height], f).toEqual([FORMAT_SIZE[f].w, FORMAT_SIZE[f].h]);
      expect(bytes.equals(before[f]), f).toBe(false);
    }
    expect(await imageRows(db, editing.postIds[i])).toHaveLength(3);
    expect(await hasEmailImage(store.storage, editing.brandId, editing.postIds[i])).toBe(false);
    expect((await actionsOf(db, editing.postIds[i])).at(-1)).toMatchObject({ action: "swap_photo", via: "email_link", detail: { photo_id: target, jti_hash: jtiHash("jti-photo") } });
    expect((await postRow(db, editing.postIds[i])).edited_at).not.toBeNull();
  });

  it("refuses another brand's photo and a made-up id, and changes nothing", async () => {
    const before = await postRow(db, editing.postIds[0]);
    const foreign = await swapPhoto({ ...ref(0), photoId: other.photoIds[0] }, deps());
    expect(foreign).toMatchObject({ ok: false, code: "photo_not_found" });
    expect(await swapPhoto({ ...ref(0), photoId: "not-a-uuid" }, deps())).toMatchObject({ ok: false, code: "photo_not_found" });
    expect(await swapPhoto({ ...ref(0), photoId: "99999999-9999-4999-8999-999999999999" }, deps())).toMatchObject({ ok: false, code: "photo_not_found" });
    expect(await postRow(db, editing.postIds[0])).toEqual(before);
  });

  it("an unusable photo needs the owner to insist, then it is used with a warning", async () => {
    const bad = editing.photoIds[1];
    await db.withAdmin((tx) => tx.query("update public.photos set usable = false where id = $1", [bad]));
    await swapPhoto({ ...ref(2), photoId: editing.photoIds[0] }, deps());
    const refused = await swapPhoto({ ...ref(2), photoId: bad }, deps());
    expect(refused).toMatchObject({ ok: false, code: "photo_unusable" });
    expect((await postRow(db, editing.postIds[2])).photo_id).toBe(editing.photoIds[0]);
    const insisted = await swapPhoto({ ...ref(2), photoId: bad, insist: true }, deps());
    expect(insisted).toMatchObject({ ok: true, warning: true });
    expect((await postRow(db, editing.postIds[2])).photo_id).toBe(bad);
    expect((await actionsOf(db, editing.postIds[2])).at(-1)?.detail).toMatchObject({ insisted: true });
    await db.withAdmin((tx) => tx.query("update public.photos set usable = true where id = $1", [bad]));
  });

  it("no photo gives a text-only design and a missing file is refused", async () => {
    const r = await swapPhoto({ ...ref(2), photoId: null }, deps());
    expect(r.ok).toBe(true);
    expect((await postRow(db, editing.postIds[2])).photo_id).toBeNull();
    expect(await imageRows(db, editing.postIds[2])).toHaveLength(3);

    await store.storage.remove("photos", `${editing.brandId}/${editing.photoIds[0]}.jpg`);
    expect(await swapPhoto({ ...ref(2), photoId: editing.photoIds[0] }, deps())).toMatchObject({ ok: false, code: "photo_missing" });
  });
});

describe("the dashboard actor must belong to the brand", () => {
  it("a signed-in user of another brand is refused by every operation", async () => {
    const stranger = (await createUser(db)).id;
    await createBrandFor(db, stranger, "Elsewhere");
    const ref = refOf(basic, 3, dashActor(stranger));
    const flag = (await flagsOf(db, basic.postIds[3]))[0]?.id ?? "f_x";
    const results = [
      await approvePost(ref),
      await skipPost(ref),
      await undoPost(ref),
      await confirmFlag({ ...ref, flagId: flag }),
      await removeFlag({ ...ref, flagId: flag }),
      await editPost({ ...ref, input: { caption: "hijack" } }),
      await swapPhoto({ ...ref, photoId: null }),
    ];
    for (const r of results) expect(r).toMatchObject({ ok: false, code: "forbidden" });
    expect((await postRow(db, basic.postIds[3])).status).toBe("draft");
    expect(await actionsOf(db, basic.postIds[3])).toHaveLength(0);
  });

  it("a post id from another brand is not found, even for that brand's own member", async () => {
    const r = await approvePost({ brandId: basic.brandId, postId: other.postIds[0], actor: dashActor(basic.userId) });
    expect(r).toMatchObject({ ok: false, code: "not_found" });
    expect((await postRow(db, other.postIds[0])).status).toBe("draft");
  });
});
