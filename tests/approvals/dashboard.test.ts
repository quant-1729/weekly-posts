import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    api: {
      get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
      set: (name: string, value: string) => void store.set(name, value),
      delete: (name: string) => void store.delete(name),
    },
  };
});
vi.mock("next/headers", () => ({ cookies: async () => jar.api, headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import {
  approvePostAction,
  confirmFlagAction,
  removeFlagAction,
  rewritePostAction,
  savePostAction,
  skipPostAction,
  swapPhotoAction,
  undoPostAction,
} from "@/components/week/actions";
import { WeekView } from "@/components/week/week-view";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { s } from "@/lib/i18n/strings";
import { setStorageForTests } from "@/lib/storage";
import { PLANTED_PRICE } from "@/lib/weekly/fixtures";
import { loadWeekView } from "@/lib/weekly/view";
import { createBrandFor, createUser } from "../brand/helpers";
import { tempStorage } from "../weekly/helpers";
import { actionsOf, flagsOf, freshWeek, makeFlag, postRow, setFlags, setPost, type FreshWeek } from "./helpers";

const WEEK = "2026-12-21";
let db: MockDb;
let store: Awaited<ReturnType<typeof tempStorage>>;
let w: FreshWeek;
let other: FreshWeek;
let outsider: string; // a user of a different brand
let nobody: string; // a user with no brand

async function signIn(userId: string | null) {
  if (userId === null) jar.store.delete(SESSION_COOKIE);
  else jar.store.set(SESSION_COOKIE, await signSession({ id: userId, email: `${userId.slice(0, 6)}@example.com` }));
}

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
  store = await tempStorage();
  setStorageForTests(store.storage);
  w = await freshWeek(db, store.storage);
  other = await freshWeek(db, store.storage);
  outsider = (await createUser(db)).id;
  await createBrandFor(db, outsider, "Elsewhere");
  nobody = (await createUser(db)).id;
}, 120_000);
afterAll(async () => {
  setStorageForTests(null);
  setMockDbForTests(null);
  await db.close();
  await store.cleanup();
});
beforeEach(async () => {
  await signIn(w.userId);
});

const post = (view: { posts: Array<{ id: string; status: string }> } | undefined, id: string) => view?.posts.find((p) => p.id === id) as { id: string; status: string };

describe("the week view carries what the dashboard needs", () => {
  it("has the whole copy, flags, photo and the brand's photos", async () => {
    const v = await loadWeekView(w.userId, w.brandId, WEEK);
    expect(v.photos.map((p) => p.id).sort()).toEqual([...w.photoIds].sort());
    expect(v.photos.every((p) => p.usable && p.url.startsWith("/api/files/photos/"))).toBe(true);
    const flagged = v.posts[1];
    expect(flagged.flagCount).toBeGreaterThanOrEqual(1);
    expect(flagged.flags.some((f) => f.text === PLANTED_PRICE && f.status === "open")).toBe(true);
    expect(flagged.fullCaption).toContain(PLANTED_PRICE);
    expect(flagged.imageText.headline).not.toBe("");
    expect(flagged.hashtags.length).toBeGreaterThan(0);
  });
});

describe("approve, skip, undo from the dashboard", () => {
  it("approves a clean post, logs the signed-in user, and returns the refreshed week", async () => {
    const r = await approvePostAction(WEEK, w.postIds[0]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.message).toBe(s.approvals.dash.approved);
    expect(post(r.view, w.postIds[0]).status).toBe("approved");
    expect(r.view.hasApproved).toBe(true);
    const [log] = await actionsOf(db, w.postIds[0]);
    expect(log).toMatchObject({ action: "approve", via: "dashboard", user_id: w.userId });
  });

  it("skips, and Undo brings either back to draft", async () => {
    const skipped = await skipPostAction(WEEK, w.postIds[2]);
    expect(skipped.ok && post(skipped.view, w.postIds[2]).status).toBe("skipped");
    const undone = await undoPostAction(WEEK, w.postIds[2]);
    expect(undone.ok && post(undone.view, w.postIds[2]).status).toBe("draft");
    const approvedUndone = await undoPostAction(WEEK, w.postIds[0]);
    expect(approvedUndone.ok && post(approvedUndone.view, w.postIds[0]).status).toBe("draft");
  });

  it("refuses to approve a flagged post, and says why; confirming and removing then unlock it", async () => {
    const blocked = await approvePostAction(WEEK, w.postIds[1]);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.message).toBe(s.approvals.errors.blocked);
    expect(post(blocked.view, w.postIds[1]).status).toBe("draft");

    const flags = (await flagsOf(db, w.postIds[1])).filter((f) => f.status === "open");
    const [first, ...rest] = flags;
    const confirmed = await confirmFlagAction(WEEK, w.postIds[1], first.id, false);
    expect(confirmed.ok).toBe(true);
    for (const f of rest) {
      const r = f.highlight ? await removeFlagAction(WEEK, w.postIds[1], f.id) : await confirmFlagAction(WEEK, w.postIds[1], f.id, false);
      expect(r.ok).toBe(true);
    }
    const ok = await approvePostAction(WEEK, w.postIds[1]);
    expect(ok.ok && post(ok.view, w.postIds[1]).status).toBe("approved");
  });

  it("a regulated flag needs the tick from the dashboard too", async () => {
    const flag = makeFlag({ text: "pain-free dentistry", kind: "claim", regulated: true });
    await setPost(db, w.postIds[3], "caption = 'We offer pain-free dentistry for all.'");
    await setFlags(db, w.postIds[3], [flag]);
    const noTick = await confirmFlagAction(WEEK, w.postIds[3], flag.id, false);
    expect(noTick).toMatchObject({ ok: false, message: s.approvals.errors.ackRequired });
    const tick = await confirmFlagAction(WEEK, w.postIds[3], flag.id, true);
    expect(tick.ok).toBe(true);
    expect((await flagsOf(db, w.postIds[3]))[0].status).toBe("confirmed");
  });
});

describe("edit from the dashboard", () => {
  it("saves the words, swaps the photo, and rewrites with an instruction", async () => {
    const saved = await savePostAction(WEEK, w.postIds[2], { caption: "My own words here.", cta: "Ring us", hashtags: "bread, local fresh", headline: "Hello", subline: "" });
    expect(saved).toMatchObject({ ok: true, message: s.approvals.edit.saved });
    expect(await postRow(db, w.postIds[2])).toMatchObject({ caption: "My own words here.", hashtags: ["#bread", "#local", "#fresh"] });

    const invalid = await savePostAction(WEEK, w.postIds[2], { caption: "", cta: "", hashtags: "", headline: "", subline: "" });
    expect(invalid).toMatchObject({ ok: false, errors: [s.approvals.errors.captionEmpty] });

    const swapped = await swapPhotoAction(WEEK, w.postIds[2], w.photoIds[0]);
    expect(swapped).toMatchObject({ ok: true });
    expect((await postRow(db, w.postIds[2])).photo_id).toBe(w.photoIds[0]);
    expect(await swapPhotoAction(WEEK, w.postIds[2], other.photoIds[0])).toMatchObject({ ok: false, message: s.approvals.errors.photoNotFound });

    const t0 = Date.now();
    const rewritten = await rewritePostAction(WEEK, w.postIds[2], "Less salesy");
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(rewritten.ok).toBe(true);
    if (!rewritten.ok) return;
    expect(rewritten.lines.join(" ")).toMatch(/Done in \d+\.\d seconds\./);
    expect(rewritten.lines.join(" ")).toContain(s.approvals.edit.rewriteSaved);
    const fb = await db.withAdmin((tx) => tx.query("select instruction from public.voice_feedback where brand_id = $1", [w.brandId]));
    expect(fb).toEqual([{ instruction: "Less salesy" }]);
    const log = (await actionsOf(db, w.postIds[2])).map((l) => `${l.action}:${l.via}:${l.user_id === w.userId}`);
    expect(log).toEqual(expect.arrayContaining(["edit:dashboard:true", "swap_photo:dashboard:true", "rewrite:dashboard:true"]));
  });
});

describe("the actions enforce membership", () => {
  it("signed out: refused", async () => {
    await signIn(null);
    const r = await approvePostAction(WEEK, w.postIds[0]);
    expect(r).toMatchObject({ ok: false, message: s.approvals.errors.signedOut });
    expect(await rewritePostAction(WEEK, w.postIds[0], "Shorter")).toMatchObject({ ok: false });
  });

  it("a user of another brand cannot reach this brand's posts, whatever ids they send", async () => {
    await signIn(outsider);
    const before = await postRow(db, w.postIds[0]);
    const flag = (await flagsOf(db, w.postIds[1]))[0];
    const results = [
      await approvePostAction(WEEK, w.postIds[0]),
      await skipPostAction(WEEK, w.postIds[0]),
      await undoPostAction(WEEK, w.postIds[0]),
      await confirmFlagAction(WEEK, w.postIds[1], flag.id, true),
      await removeFlagAction(WEEK, w.postIds[1], flag.id),
      await savePostAction(WEEK, w.postIds[0], { caption: "hijack", cta: "", hashtags: "", headline: "", subline: "" }),
      await swapPhotoAction(WEEK, w.postIds[0], null),
      await rewritePostAction(WEEK, w.postIds[0], "Shorter please"),
    ];
    for (const r of results) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toBe(s.approvals.errors.notFound);
    }
    expect(await postRow(db, w.postIds[0])).toEqual(before);
    expect((await flagsOf(db, w.postIds[1])).find((f) => f.id === flag.id)?.status).toBe(flag.status);
  });

  it("a user with no business is refused, and bad ids are not found", async () => {
    await signIn(nobody);
    expect(await approvePostAction(WEEK, w.postIds[0])).toMatchObject({ ok: false, message: s.week.errors.noBrand });
    await signIn(w.userId);
    expect(await approvePostAction(WEEK, "not-a-uuid")).toMatchObject({ ok: false, message: s.approvals.errors.notFound });
    expect(await approvePostAction("2026-13-45", w.postIds[0])).toMatchObject({ ok: false, message: s.approvals.errors.notFound });
    expect(await approvePostAction(WEEK, other.postIds[0])).toMatchObject({ ok: false, message: s.approvals.errors.notFound });
  });
});

describe("the week screen", () => {
  const html = (v: Awaited<ReturnType<typeof loadWeekView>>) => renderToString(createElement(WeekView, { initial: v }));
  const esc = (t: string) => t.replace(/'/g, "&#x27;");

  it("shows Approve, Skip and Edit, a status chip, and the Please check list with Confirm and Remove", async () => {
    // a fresh flagged post and a regulated one
    await setFlags(db, w.postIds[0], [makeFlag({ text: "9 stars", kind: "claim", regulated: true }), makeFlag({ text: PLANTED_PRICE, kind: "price", id: "f_price" })]);
    await setPost(db, w.postIds[0], "status = 'draft', approved_at = null");
    const out = html(await loadWeekView(w.userId, w.brandId, WEEK));
    for (const label of [s.approvals.dash.approve, s.approvals.dash.skip, s.approvals.dash.edit]) expect(out).toContain(`>${label}</button>`);
    expect(out).toContain(s.approvals.status.draft);
    expect(out).toContain(s.approvals.flags.title);
    expect(out).toContain(s.approvals.flags.confirm);
    expect(out).toContain(`>${s.approvals.flags.remove}</button>`);
    expect(out).toContain(esc(s.approvals.flags.regulatedWarning));
    expect(out).toContain(esc(s.approvals.flags.regulatedTick));
    // Approve is disabled on a post with open flags, and the regulated Confirm waits for the tick.
    expect(out).toMatch(/<button type="button" class="[^"]*" disabled="" title="[^"]*">Approve<\/button>/);
    expect(out).toMatch(/<button type="button" class="[^"]*" disabled="">This is true<\/button>/);
  });

  it("shows Undo and the Approved chip for an approved post, and nothing to change for a posted one", async () => {
    await setFlags(db, w.postIds[0], []);
    await setPost(db, w.postIds[0], "status = 'approved', approved_at = now()");
    await setPost(db, w.postIds[3], "status = 'posted', posted_at = now()");
    const out = html(await loadWeekView(w.userId, w.brandId, WEEK));
    expect(out).toContain(s.approvals.status.approved);
    expect(out).toContain(`>${s.approvals.dash.undo}</button>`);
    expect(out).toContain(s.approvals.status.posted);
  });
});
