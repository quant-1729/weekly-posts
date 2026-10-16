import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MockDb } from "@/lib/db/mock";
import { recordUsage } from "@/lib/usage";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";

let db: MockDb;
let userId: string;

beforeAll(async () => {
  db = await openTestDb();
  userId = (await createUser(db)).id;
});
afterAll(async () => {
  await closeTestDb(db);
});

describe("recordUsage model and ok", () => {
  it("stores the model, and ok=false for the partial cost of a failed call", async () => {
    const brand = await createBrandFor(db, userId);
    await recordUsage(brand, userId, "rewrite", 0.02, { ok: false, model: "gemini-3.8-flash" });
    await recordUsage(brand, userId, "rewrite", 0.05, { model: "gemini-3.8-flash" });
    await recordUsage(brand, userId, "rewrite", 0.07);

    const rows = await db.withAdmin((tx) =>
      tx.query<{ usd: number; model: string | null; ok: boolean }>(
        "select usd::float8 as usd, model, ok from public.usage_events where brand_id = $1 and kind = 'rewrite'::public.usage_kind order by usd",
        [brand],
      ),
    );
    expect(rows).toEqual([
      { usd: 0.02, model: "gemini-3.8-flash", ok: false },
      { usd: 0.05, model: "gemini-3.8-flash", ok: true },
      { usd: 0.07, model: null, ok: true },
    ]);
  });
});
