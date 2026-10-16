// CH-2 wiring: a brand's face becomes the character of the layout. A mascot face is drawn by the character rig in the brand's colours,
// any other face from the approved pose image the role needs; the options carry the roles; two brands get different option sets.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Brief } from "@/lib/briefs/types";
import { contentFromBrief, loadCreateBrand } from "@/lib/create";
import { buildInput, loadDesignAssets, optionsFor, renderOne, validOption, type DesignAssets } from "@/lib/create/render";
import type { MockDb } from "@/lib/db/mock";
import { setActiveFace } from "@/lib/faces/service";
import { initShaping } from "@/lib/render/shape";
import { closeDb, openDb } from "../helpers/details";
import { cleanup, makeBakery, readyBrief, type Bakery } from "../create/pipeline/helpers";
import { makeApprovedFace } from "./helpers";

let db: MockDb;
let b: Bakery;
let brief: Brief;

const words = { headline: "Cake week is here", subline: "", ctaText: "Visit us today", bubble: "Come say hi!" };

async function setup(owner: Bakery, br: Brief): Promise<{ assets: DesignAssets; content: Awaited<ReturnType<typeof contentFromBrief>> }> {
  const brand = await loadCreateBrand(owner.userId, owner.brandId);
  const assets = await loadDesignAssets({ userId: owner.userId, brandId: owner.brandId, brief: br, brand, storage: owner.storage });
  return { assets, content: await contentFromBrief(br, brand, words, { mascot: assets.faceOn }) };
}

beforeAll(async () => {
  db = await openDb();
  b = await makeBakery(db);
  brief = await readyBrief(b, { channels: ["instagram"] });
  await initShaping();
});
afterAll(async () => {
  cleanup(b);
  await closeDb(db);
});

describe("a mascot face", () => {
  it("is drawn by the character rig as the role of each option, never as the header sticker", async () => {
    await db.withAdmin((tx) => tx.query("insert into public.mascots (brand_id, status, name, concept, spec) values ($1, 'active', 'Tween', '{}'::jsonb, '{}'::jsonb)", [b.brandId]));
    await db.withAdmin((tx) => tx.query("update public.brand_memory set mascot_in_posts = true where brand_id = $1", [b.brandId]));
    const { assets, content } = await setup(b, brief);
    expect(assets.characterId).toBe("tween");
    for (const format of ["square", "portrait", "vertical"] as const) {
      const options = optionsFor(assets, content, format, 3, { postType: brief.postType, extras: brief.extraPostTypes });
      expect(options).toHaveLength(3);
      expect(options.every((o) => o.role !== undefined)).toBe(true);
      expect(new Set(options.map((o) => o.role)).size).toBe(3);
      expect(options.every((o) => validOption(o, [format], false))).toBe(true);
      for (const option of options) {
        const input = await buildInput(assets, { format, option, content, pose: "wave" });
        expect(input.mascot, "no header sticker next to a role").toBeNull();
        if (option.role) {
          expect(input.character).toEqual({ kind: "rig", id: "tween" });
          expect(input.role).toBe(option.role);
        }
        const r = await renderOne(assets, { format, option, content, pose: "wave" });
        if (option.role) expect(r.placements.some((p) => p.name === "character"), `${format} ${option.role}`).toBe(true);
        expect(r.placements.some((p) => p.kind === "bubble")).toBe(false);
        expect(r.report.overflow).toEqual([]);
        expect(r.report.safeZone).toEqual([]);
      }
    }
  }, 120_000);

  it("a stored option from before layout roles still draws the header sticker", async () => {
    const { assets, content } = await setup(b, brief);
    const [o] = optionsFor(assets, content, "square");
    const old = { themeId: o.themeId, layoutId: o.layoutId, scheme: o.scheme };
    const r = await renderOne(assets, { format: "square", option: old, content, pose: "wave" });
    expect(r.character).toBeNull();
    expect(r.placements.some((p) => p.kind === "mascot")).toBe(true);
    expect(r.placements.some((p) => p.kind === "bubble")).toBe(true);
  });

  it("two brands with identical briefs and the same face get different option sets, each the same every time", async () => {
    const one = await setup(b, brief);
    // The same brand data under another brand id: only the seed differs.
    const sets = new Set<string>();
    for (const id of ["brand-a", "brand-b", "brand-c", "brand-d", "brand-e", "brand-f"]) sets.add(JSON.stringify(optionsFor({ ...one.assets, brandId: id }, one.content, "portrait", 3, { postType: brief.postType })));
    expect(sets.size).toBeGreaterThanOrEqual(3);
    const a = optionsFor(one.assets, one.content, "portrait", 3, { postType: brief.postType });
    expect(optionsFor(one.assets, one.content, "portrait", 3, { postType: brief.postType })).toEqual(a);
  });
});

describe("a face drawn from pose images", () => {
  it("gets roles where its poses allow (present, point, talk, celebrate), drawn from the approved pose image", async () => {
    await db.withAdmin((tx) => tx.query("update public.brand_memory set mascot_in_posts = false where brand_id = $1", [b.brandId]));
    const mia = await makeApprovedFace(db, b, "photoreal", b.storage, "Eva");
    await setActiveFace({ userId: b.userId, brandId: b.brandId, faceId: mia.id });
    const { assets, content } = await setup(b, brief);
    expect(assets.characterId).toBeNull();
    const options = optionsFor(assets, content, "square", 3, { postType: brief.postType });
    for (const o of options) if (o.role) expect(["presenter", "pointer", "narrator", "celebrator"]).toContain(o.role);
    const withRole = options.find((o) => o.role);
    expect(withRole).toBeDefined();
    const input = await buildInput(assets, { format: "square", option: withRole!, content, pose: "wave" });
    expect(input.character?.kind).toBe("image");
    expect(input.character && input.character.kind === "image" && input.character.aiTag).toBe(true);
    const r = await renderOne(assets, { format: "square", option: withRole!, content, pose: "wave" });
    expect(r.character?.role).toBe(withRole!.role);
    expect(r.svg).toContain("<image");
    expect(r.report.overflow).toEqual([]);
  }, 60_000);
});
