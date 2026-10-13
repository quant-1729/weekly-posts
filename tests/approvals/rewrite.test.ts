import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Records every model call, then calls the real function (fixture mode).
// `factCheckStalls`: the fact-check call never answers; like the real client it gives up when its own
// time limit (timeoutMs) runs out and fails with a call_failed error.
const calls = vi.hoisted(() => ({ generate: [] as Array<Record<string, unknown>>, factCheckStalls: false }));
vi.mock("@/lib/ai/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/client")>();
  return {
    ...actual,
    generateJson: async (args: Record<string, unknown>) => {
      calls.generate.push(args);
      if (calls.factCheckStalls && args.zodSchema === v2FactCheckSchema) {
        await new Promise((r) => setTimeout(r, Math.max(1000, Number(args.timeoutMs))));
        throw new actual.AiError("call_failed", "The operation timed out");
      }
      return (actual.generateJson as (a: unknown) => unknown)(args);
    },
  };
});

import { rewriteSchema, v2FactCheckSchema } from "@/lib/ai/schemas-v2";
import { approvePost, rewritePost } from "@/lib/approvals/ops";
import type { Actor } from "@/lib/approvals/types";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { AI_UNCHECKED_TEXT, loadGuardrailContext, runGuardrail } from "@/lib/guardrail";
import { PLANTED_PRICE } from "@/lib/weekly/fixtures";
import { loadWeekInputs } from "@/lib/weekly/inputs";
import { tempStorage } from "../weekly/helpers";
import { actionsOf, dashActor, emailActor, flagsOf, freshWeek, hasEmailImage, imageRows, postRow, putEmailImage, refOf, setFlags, makeFlag, type FreshWeek } from "./helpers";
import { jtiHash } from "@/lib/links/tokens";

let db: MockDb;
let store: Awaited<ReturnType<typeof tempStorage>>;
let w: FreshWeek;

const NOW = new Date("2026-12-22T10:00:00Z");
const deps = (extra: Parameters<typeof rewritePost>[1] = {}) => ({ storage: store.storage, now: NOW, ...extra });
const rewriteCalls = () => calls.generate.filter((c) => c.zodSchema === rewriteSchema);

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
  store = await tempStorage();
  w = await freshWeek(db, store.storage);
}, 120_000);
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
  await store.cleanup();
});

const feedback = () => db.withAdmin((tx) => tx.query<{ brand_id: string; post_id: string; instruction: string }>("select brand_id::text, post_id::text, instruction from public.voice_feedback where brand_id = $1 order by created_at, id", [w.brandId]));
const count = async (sql: string, params: unknown[]) => (await db.withAdmin((tx) => tx.query<{ n: number }>(`select count(*)::int as n from (${sql}) t`, params)))[0].n;

describe("rewrite with an instruction (Req 15, AC 15)", () => {
  it("rewrites, saves the instruction as voice feedback, keeps `original`, redraws, and answers well inside 15 seconds", async () => {
    const before = await postRow(db, w.postIds[0]);
    await putEmailImage(store.storage, w.brandId, w.postIds[0]);
    const t0 = Date.now();
    const r = await rewritePost({ ...refOf(w, 0, dashActor(w.userId)), instruction: "  Shorter " }, deps());
    const wall = Date.now() - t0;
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // AC 15: under 15 seconds (fixture mode is far faster; the budgets are asserted below).
    expect(wall).toBeLessThan(15_000);
    expect(r.timings.totalMs).toBeLessThan(15_000);
    expect(Object.keys(r.timings).sort()).toEqual(["aiMs", "guardrailMs", "renderMs", "totalMs"]);

    const row = await postRow(db, w.postIds[0]);
    expect((row.caption as string).length).toBeLessThan((before.caption as string).length);
    expect(row.caption).toBe(r.post.caption);
    expect(row.original).toEqual(before.original);
    expect(row.edited_at).not.toBeNull();
    expect(await imageRows(db, w.postIds[0])).toHaveLength(3);
    expect(await hasEmailImage(store.storage, w.brandId, w.postIds[0])).toBe(false);

    // The instruction is in brand memory: a saved row, and what the next week's generation reads.
    expect(await feedback()).toEqual([{ brand_id: w.brandId, post_id: w.postIds[0], instruction: "Shorter" }]);
    const inputs = await loadWeekInputs(w.brandId, "2026-12-28", NOW);
    expect(inputs.voice.feedback).toContain("Shorter");

    expect((await actionsOf(db, w.postIds[0])).at(-1)).toMatchObject({ action: "rewrite", via: "dashboard", user_id: w.userId, detail: { instruction: "Shorter" } });
    const [usage] = await db.withAdmin((tx) => tx.query("select kind::text, user_id::text from public.usage_events where brand_id = $1 and kind = 'rewrite'", [w.brandId]));
    expect(usage).toMatchObject({ kind: "rewrite", user_id: w.userId });
  });

  it("passes the right budgets and facts to the model and to the guardrail", async () => {
    calls.generate.length = 0;
    const guardrail = vi.fn(runGuardrail);
    const confirmedText = "£4.50";
    await setFlags(db, w.postIds[2], [makeFlag({ text: confirmedText, status: "confirmed", decided_at: NOW.toISOString() })]);
    const r = await rewritePost({ ...refOf(w, 2, emailActor("jti-rw")), instruction: "Less salesy" }, deps({ guardrail }));
    expect(r.ok).toBe(true);

    const [rw] = rewriteCalls();
    expect(rewriteCalls()).toHaveLength(1);
    expect(rw.timeoutMs).toBe(10_000);
    expect(rw.budgetMs).toBe(14_000);
    expect(String(rw.user)).toContain('OWNER INSTRUCTION: "Less salesy"');

    expect(guardrail).toHaveBeenCalledTimes(1);
    const args = guardrail.mock.calls[0][0];
    const ctx = await loadGuardrailContext(w.brandId);
    expect(args.facts).toEqual(ctx.facts);
    expect(args.brandId).toBe(w.brandId);
    expect(args.flagRepeats).toBe(true);
    expect(args.posts).toHaveLength(1);
    expect(args.posts[0].id).toBe(w.postIds[2]);
    expect(args.confirmedByPost).toEqual([[confirmedText]]);
    expect(args.weekStart).toBe("2026-12-21");
    // The guardrail's AI check gets what is left of the 15 s, less a 0.5 s margin (V-21).
    expect(args.aiTimeoutMs).toBeGreaterThan(13_000);
    expect(args.aiTimeoutMs).toBeLessThanOrEqual(14_500);
    expect(args.aiBudgetMs).toBe(args.aiTimeoutMs);
    // An email link has no user: the guardrail runs as a member of the brand.
    expect(args.userId).toBe(w.userId);
  });

  it("logs the email-link actor with the jti hash and no user", async () => {
    const log = (await actionsOf(db, w.postIds[2])).at(-1)!;
    expect(log).toMatchObject({ action: "rewrite", via: "email_link", user_id: null });
    expect(log.detail).toMatchObject({ jti_hash: jtiHash("jti-rw") });
    const [usage] = await db.withAdmin((tx) => tx.query("select user_id::text from public.usage_events where brand_id = $1 and kind = 'rewrite' order by id desc limit 1", [w.brandId]));
    expect(usage.user_id).toBeNull();
  });

  it("the guardrail flags a price the rewrite planted (code and AI layers)", async () => {
    const withPrice = (caption: string) => () => ({ caption, hashtags: ["#a", "#b", "#c"], cta: "Message us", image_text: { headline: "Box", subline: "" }, note: "" });
    const r = await rewritePost({ ...refOf(w, 0, emailActor()), instruction: "Mention the price" }, deps({ fixtures: { rewrite: withPrice(`Our box is ${PLANTED_PRICE} this week.`) } }));
    expect(r).toMatchObject({ ok: true, blocking: true });
    let flags = await flagsOf(db, w.postIds[0]);
    expect(flags.filter((f) => f.status === "open" && f.text === PLANTED_PRICE)).toHaveLength(1);
    expect(flags.find((f) => f.text === PLANTED_PRICE)?.layer).toBe("both");
    expect(await approvePost({ ...refOf(w, 0, emailActor()) }, deps())).toMatchObject({ ok: false, code: "blocked" });

    // A price the AI fixture does not know about is still caught by the code layer.
    const r2 = await rewritePost({ ...refOf(w, 0, emailActor()), instruction: "Mention the price" }, deps({ fixtures: { rewrite: withPrice("Our box is £9.99 this week.") } }));
    expect(r2).toMatchObject({ ok: true, blocking: true });
    flags = await flagsOf(db, w.postIds[0]);
    expect(flags.some((f) => f.status === "open" && f.text.includes("9.99") && f.layer === "code")).toBe(true);
  });

  it("a price the owner already confirmed on the post is not flagged again", async () => {
    const i = 1; // the fixture post with the planted price
    const flags = await flagsOf(db, w.postIds[i]);
    expect(flags.some((f) => f.status === "open")).toBe(true);
    await setFlags(db, w.postIds[i], flags.map((f) => ({ ...f, status: "confirmed" as const, decided_at: NOW.toISOString() })));
    const r = await rewritePost({ ...refOf(w, i, emailActor()), instruction: "Shorter" }, deps());
    expect(r).toMatchObject({ ok: true, blocking: false });
    expect((await flagsOf(db, w.postIds[i])).filter((f) => f.status === "open")).toHaveLength(0);
  });

  it("an AI check that does not answer in time gives the 'facts not checked' flag through the guardrail's own fallback", async () => {
    const guardrail = vi.fn(runGuardrail);
    const withPrice = () => ({ caption: "Today only £9.99 for a box.", hashtags: ["#a", "#b", "#c"], cta: "Message us", image_text: { headline: "Box", subline: "" }, note: "" });
    calls.generate.length = 0;
    calls.factCheckStalls = true;
    const t0 = Date.now();
    let r;
    try {
      r = await rewritePost({ ...refOf(w, 3, dashActor(w.userId)), instruction: "Add the price" }, deps({ guardrail, totalMs: 2000, fixtures: { rewrite: withPrice } }));
    } finally {
      calls.factCheckStalls = false;
    }
    const wall = Date.now() - t0;
    expect(r).toMatchObject({ ok: true, guardrailTimedOut: true, blocking: true });
    expect(wall).toBeLessThan(4000);
    // The remaining time (2000 - elapsed - 500, at least 1000) was passed down to the model call itself.
    const [fc] = calls.generate.filter((c) => c.zodSchema === v2FactCheckSchema);
    expect(fc.timeoutMs).toBeGreaterThanOrEqual(1000);
    expect(fc.timeoutMs).toBeLessThanOrEqual(1500);
    expect(fc.budgetMs).toBe(fc.timeoutMs);
    expect(guardrail.mock.calls[0][0]).toMatchObject({ aiTimeoutMs: fc.timeoutMs, aiBudgetMs: fc.budgetMs });
    const flags = await flagsOf(db, w.postIds[3]);
    expect(flags.find((f) => f.text === AI_UNCHECKED_TEXT)).toMatchObject({ status: "open", kind: "claim" });
    // The code-only flags are there too.
    expect(flags.some((f) => f.status === "open" && f.text.includes("9.99"))).toBe(true);
    expect(await approvePost(refOf(w, 3, dashActor(w.userId)), deps())).toMatchObject({ ok: false, code: "blocked" });
  });

  it("returns the model's note when it could not add a fact", async () => {
    const note = "Opening hours are not in your brand details yet. Add them first.";
    const r = await rewritePost(
      { ...refOf(w, 2, emailActor()), instruction: "Add our opening hours" },
      deps({ fixtures: { rewrite: (p) => ({ ...p, note }) } }),
    );
    expect(r).toMatchObject({ ok: true, note });
  });

  it("a caption copied from another post of the week is flagged as a repeat", async () => {
    const sibling = (await postRow(db, w.postIds[1])).caption as string;
    expect(sibling.split(/\s+/).length).toBeGreaterThan(8);
    const r = await rewritePost({ ...refOf(w, 0, emailActor()), instruction: "Make it like the other one" }, deps({ fixtures: { rewrite: (p) => ({ ...p, note: "", caption: sibling }) } }));
    expect(r.ok).toBe(true);
    expect((await flagsOf(db, w.postIds[0])).some((f) => f.kind === "repeat" && f.status === "open")).toBe(true);
  });

  it("an approved post goes back to draft after a rewrite", async () => {
    const i = 2;
    await rewritePost({ ...refOf(w, i, emailActor()), instruction: "Clean version" }, deps({ fixtures: { rewrite: (p) => ({ ...p, note: "", caption: "A plain note for everyone to read today." }) } }));
    expect(await approvePost(refOf(w, i, emailActor()), deps())).toMatchObject({ ok: true });
    const r = await rewritePost({ ...refOf(w, i, emailActor()), instruction: "Warmer" }, deps({ fixtures: { rewrite: (p) => ({ ...p, note: "", caption: "A warm plain note for everyone to read today." }) } }));
    expect(r).toMatchObject({ ok: true, reapprove: true });
    expect(await postRow(db, w.postIds[i])).toMatchObject({ status: "draft", approved_at: null });
  });

  it("checks the instruction length (3 to 200 characters)", async () => {
    const before = (await feedback()).length;
    for (const instruction of ["", "ab", "  a  ", "x".repeat(201)]) {
      expect(await rewritePost({ ...refOf(w, 0, emailActor()), instruction }, deps()), JSON.stringify(instruction).slice(0, 20)).toMatchObject({ ok: false, code: "invalid" });
    }
    expect((await feedback()).length).toBe(before);
    for (const instruction of ["abc", "y".repeat(200)]) {
      expect((await rewritePost({ ...refOf(w, 0, emailActor()), instruction }, deps())).ok).toBe(true);
    }
  });

  it("fails cleanly on the daily cap: nothing changes and nothing is saved", async () => {
    const before = await postRow(db, w.postIds[0]);
    const feedbackBefore = (await feedback()).length;
    calls.generate.length = 0;
    await db.withAdmin((tx) => tx.query("update public.brands set daily_generation_cap = 1 where id = $1", [w.brandId]));
    try {
      const r = await rewritePost({ ...refOf(w, 0, emailActor()), instruction: "Shorter please" }, { storage: store.storage });
      expect(r).toMatchObject({ ok: false, code: "cap" });
      expect(rewriteCalls()).toHaveLength(0);
    } finally {
      await db.withAdmin((tx) => tx.query("update public.brands set daily_generation_cap = 100 where id = $1", [w.brandId]));
    }
    expect(await postRow(db, w.postIds[0])).toEqual(before);
    expect((await feedback()).length).toBe(feedbackBefore);
  });

  it("fails cleanly when the model call fails: the post is unchanged, no feedback, no usage", async () => {
    const before = await postRow(db, w.postIds[0]);
    const feedbackBefore = (await feedback()).length;
    const usageBefore = await count("select 1 from public.usage_events where brand_id = $1 and kind = 'rewrite'", [w.brandId]);
    const r = await rewritePost(
      { ...refOf(w, 0, emailActor()), instruction: "Shorter please" },
      deps({
        fixtures: {
          rewrite: () => {
            throw new Error("model down");
          },
        },
      }),
    );
    expect(r).toMatchObject({ ok: false, code: "ai_failed" });
    expect(await postRow(db, w.postIds[0])).toEqual(before);
    expect((await feedback()).length).toBe(feedbackBefore);
    expect(await count("select 1 from public.usage_events where brand_id = $1 and kind = 'rewrite'", [w.brandId])).toBe(usageBefore);
  });

  it("refuses a user who is not a member (dashboard) and does not call the model", async () => {
    calls.generate.length = 0;
    const stranger: Actor = { via: "dashboard", userId: "99999999-9999-4999-8999-999999999999" };
    const r = await rewritePost({ ...refOf(w, 0, stranger), instruction: "Shorter please" }, deps());
    expect(r).toMatchObject({ ok: false, code: "forbidden" });
    expect(rewriteCalls()).toHaveLength(0);
  });
});
