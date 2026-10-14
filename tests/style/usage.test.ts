import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AiError, type CallStats } from "@/lib/ai/client";
import type { MockDb } from "@/lib/db/mock";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";
import { clearBrand, jpeg, png } from "./helpers";
import { fixtureStyleRead } from "@/lib/style/read";

// The model call is replaced so that the cost bookkeeping can be checked with real numbers (no network).
const generateJson = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/client", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/client")>()), generateJson }));

import { readStyle } from "@/lib/style/read";
import { geminiTextCheck } from "@/lib/style/backgrounds";
import type { SampleDeps } from "@/lib/style/samples";

let db: MockDb;
let owner: string;
let brand: string;

beforeAll(async () => {
  db = await openTestDb();
  owner = (await createUser(db)).id;
  brand = await createBrandFor(db, owner, "Corner Bakery");
});
afterAll(async () => closeTestDb(db));
beforeEach(async () => {
  generateJson.mockReset();
  await clearBrand(db, brand);
});

const stats = (usd: number): CallStats => ({ model: "gemini-3.8-flash", ms: 10, inputTokens: 1000, outputTokens: 100, usd });
const deps: SampleDeps = {
  listInstagram: async () => Array.from({ length: 4 }, (_, i) => ({ mediaId: `m${i}`, previewUrl: `data:test/${i}`, added: false })),
  download: async () => ({ bytes: await jpeg("#c0392b"), mimeType: "image/jpeg" }),
  themeColor: async () => null,
};
const usage = () => db.withAdmin((tx) => tx.query<{ kind: string; usd: string }>("select kind::text as kind, usd from public.usage_events where brand_id = $1", [brand]));

describe("style read cost", () => {
  it("sends the images with the style prompt and records the call's cost as style_read", async () => {
    generateJson.mockResolvedValue({ data: fixtureStyleRead([]), stats: stats(0.0123) });
    const r = await readStyle({ userId: owner, brandId: brand }, { samples: deps });
    expect(r.usd).toBeCloseTo(0.0123, 6);
    const args = generateJson.mock.calls[0][0];
    expect(args.media).toHaveLength(4);
    expect(args.system).toContain("visual style");
    expect(args.user).toContain("4 of the business's own recent posts");
    const rows = await usage();
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("style_read");
    expect(Number(rows[0].usd)).toBeCloseTo(0.0123, 6);
  });

  it("still records what a failed read cost", async () => {
    generateJson.mockRejectedValue(new AiError("invalid_output", "bad", [stats(0.004), stats(0.004)]));
    await expect(readStyle({ userId: owner, brandId: brand }, { samples: deps })).rejects.toThrow("bad");
    const rows = await usage();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].usd)).toBeCloseTo(0.008, 6);
  });
});

describe("background text check", () => {
  it("asks the model about the image and returns its answer and cost", async () => {
    generateJson.mockResolvedValue({ data: { has_text: false, has_figurative: true }, stats: stats(0.0007) });
    const r = await geminiTextCheck(await png("#336699", 64));
    expect(r).toEqual({ hasText: true, usd: 0.0007 });
    const args = generateJson.mock.calls[0][0];
    expect(args.user).toContain("any letters, numbers or words");
    expect(args.media[0].mimeType).toBe("image/jpeg");
  });
});
