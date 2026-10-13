import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { setStorageForTests } from "@/lib/storage";
import { signLink } from "@/lib/links/tokens";
import { s } from "@/lib/i18n/strings";
import { generateWeek } from "@/lib/weekly/generate";
import { freshWeek, postRow, type FreshWeek } from "../approvals/helpers";
import { tempStorage } from "../weekly/helpers";
import { GEN_NOW, WEEK, cookieOf, nonceOf, openLink, pressLink } from "./helpers";

// H-10: "Generate new posts" deletes the drafts, so the links in the email already sent point at
// posts that are gone. They show the week's current posts instead of "We could not find that".

let db: MockDb;
let store: Awaited<ReturnType<typeof tempStorage>>;

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
  store = await tempStorage();
  setStorageForTests(store.storage);
}, 120_000);
afterAll(async () => {
  setStorageForTests(null);
  setMockDbForTests(null);
  await db.close();
  await store.cleanup();
});

/** A week whose email links (approve, skip, edit and view_week) are signed, then regenerated with the button. */
async function weekThenRegenerate() {
  const old: FreshWeek = await freshWeek(db, store.storage);
  const sign = (act: "approve" | "skip" | "edit" | "view_week", i?: number, weekStart: string | null = WEEK) =>
    signLink({ brandId: old.brandId, postId: i === undefined ? undefined : old.postIds[i], act, weekStart: weekStart ?? undefined });
  const tokens = { approve: await sign("approve", 0), skip: await sign("skip", 1), edit: await sign("edit", 2), viewWeek: await sign("view_week") };
  // The owner opened the old pages before the drafts were replaced, so they hold a cookie and a nonce.
  const opened: Record<"approve" | "skip" | "edit", { cookie: string | undefined; nonce: string }> = {} as never;
  for (const k of ["approve", "skip", "edit"] as const) {
    const got = await openLink(tokens[k]);
    opened[k] = { cookie: cookieOf(got), nonce: nonceOf(await got.text()) };
  }
  const res = await generateWeek({ brandId: old.brandId, weekStart: WEEK, trigger: "button", userId: old.userId }, { now: GEN_NOW, storage: store.storage });
  if (res.status !== "ready") throw new Error(`regeneration failed: ${JSON.stringify(res)}`);
  const newIds = res.posts.map((p) => p.id);
  expect(newIds.some((id) => old.postIds.includes(id))).toBe(false);
  return { old, tokens, newIds, sign, opened };
}

const view = async (token: string) => {
  const res = await openLink(token);
  return { status: res.status, html: await res.text(), cookie: cookieOf(res) };
};
const tokensOnPage = (html: string) => [...html.matchAll(/href="\/e\/([^"]+)"/g)].map((m) => m[1]);

describe("old email links after Generate new posts (H-10)", () => {
  it("GET of an old approve, skip or edit link shows the current posts with the note, not a 404", async () => {
    const { tokens, newIds } = await weekThenRegenerate();
    for (const token of [tokens.approve, tokens.skip, tokens.edit]) {
      const r = await view(token);
      expect(r.status).toBe(200);
      expect(r.html).toContain(s.links.replacedNote.replace("'", "&#39;"));
      expect(r.html).not.toContain(s.links.unavailableTitle);
      expect(r.html).toContain(s.links.approve);
      // every post on the page is a current one
      expect((r.html.match(/<section /g) ?? []).length).toBe(newIds.length);
    }
  });

  it("the week page signs fresh links, and they point at the current posts", async () => {
    const { tokens, newIds, old } = await weekThenRegenerate();
    const r = await view(tokens.approve);
    const links = tokensOnPage(r.html);
    expect(links.length).toBe(newIds.length * 3); // approve, edit, skip per post
    const { verifyLink } = await import("@/lib/links/tokens");
    const seen = new Set<string>();
    for (const t of links) {
      const claims = await verifyLink(t);
      expect(claims).not.toBeNull();
      expect(claims!.brandId).toBe(old.brandId);
      expect(newIds).toContain(claims!.postId);
      seen.add(claims!.act);
    }
    expect([...seen].sort()).toEqual(["approve", "edit", "skip"]);
    // and a fresh link opens the post itself, without the note
    const approve = r.html.match(/href="\/e\/([^"]+)"/)![1];
    const page = await view(approve);
    expect(page.status).toBe(200);
    expect(page.html).not.toContain(s.links.replacedNote.replace("'", "&#39;"));
  });

  it("the view_week link of the old email still shows the week, without the note", async () => {
    const { tokens } = await weekThenRegenerate();
    const r = await view(tokens.viewWeek);
    expect(r.status).toBe(200);
    expect(r.html).not.toContain(s.links.replacedNote.replace("'", "&#39;"));
  });

  it("POST with an old token never acts: it shows the same week page and changes nothing", async () => {
    const { tokens, newIds, old, opened } = await weekThenRegenerate();
    const snapshot = async () =>
      JSON.stringify([
        await db.withAdmin((tx) => tx.query("select id::text, status::text, caption, approved_at, skipped_at, edited_at from public.posts where brand_id = $1 order by id", [old.brandId])),
        await db.withAdmin((tx) => tx.query("select count(*)::int as n from public.post_actions")),
      ]);
    const before = await snapshot();
    for (const [k, op] of [["approve", "approve"], ["skip", "skip"], ["edit", "save"]] as const) {
      const res = await pressLink(tokens[k], { nonce: opened[k].nonce, op, caption: "Hacked" }, opened[k].cookie);
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain(s.links.replacedNote.replace("'", "&#39;"));
      expect((html.match(/<section /g) ?? []).length).toBe(newIds.length);
    }
    expect(await snapshot()).toBe(before);
    for (const id of newIds) expect((await postRow(db, id)).status).toBe("draft");
  });

  it("still 404s when the week no longer exists, or the brand is gone", async () => {
    const { old, sign } = await weekThenRegenerate();
    const noWeek = await view(await sign("approve", 0, "2027-01-04"));
    expect(noWeek.status).toBe(404);
    expect(noWeek.html).toContain(s.links.unavailableTitle);
    const noWeekClaim = await view(await sign("approve", 0, null));
    expect(noWeekClaim.status).toBe(404);

    const lone = await freshWeek(db, store.storage);
    const token = await signLink({ brandId: lone.brandId, postId: lone.postIds[0], act: "approve", weekStart: WEEK });
    await db.withAdmin(async (tx) => {
      await tx.query("delete from public.brands where id = $1", [lone.brandId]);
    });
    const gone = await view(token);
    expect(gone.status).toBe(404);
    expect(old.brandId).not.toBe(lone.brandId);
  });
});
