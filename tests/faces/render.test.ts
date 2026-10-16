import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Brief } from "@/lib/briefs/types";
import { contentFromBrief, loadCreateBrand } from "@/lib/create";
import { loadDesignAssets, optionsFor, renderOne, buildInput, type DesignAssets } from "@/lib/create/render";
import type { CreateBrand } from "@/lib/create/types";
import type { MockDb } from "@/lib/db/mock";
import { MASCOT_PX } from "@/lib/design/core";
import { AI_TAG, faceGroup, layoutFace, SIZE_FACTOR } from "@/lib/design/face-layer";
import { renderDesignDetailed } from "@/lib/design";
import { DESIGN_FORMATS, type DesignFormat, type DesignOption } from "@/lib/design/types";
import { setActiveFace, updateFaceSettings } from "@/lib/faces/service";
import { mascotForRender } from "@/lib/mascot/posts";
import { initShaping } from "@/lib/render/shape";
import { closeDb, openDb } from "../helpers/details";
import { cleanup, makeBakery, readyBrief, type Bakery } from "../create/pipeline/helpers";
import { figurePixels, makeApprovedFace } from "./helpers";

/** An option without a role: the face is the small sticker in the header (the layout before layout roles, CH-2). */
const legacy = (o: DesignOption): DesignOption => ({ themeId: o.themeId, layoutId: o.layoutId, scheme: o.scheme });

let db: MockDb;
let b: Bakery;
let brief: Brief;

const words = { headline: "Cake week is here", subline: "", ctaText: "Visit us today", bubble: "Come say hi!" };

async function setup(brief_: Brief = brief): Promise<{ brand: CreateBrand; assets: DesignAssets }> {
  const brand = await loadCreateBrand(b.userId, b.brandId);
  const assets = await loadDesignAssets({ userId: b.userId, brandId: b.brandId, brief: brief_, brand, storage: b.storage });
  return { brand, assets };
}

async function draw(assets: DesignAssets, brand: CreateBrand, format: DesignFormat, pose = "point", brief_: Brief = brief) {
  const content = await contentFromBrief(brief_, brand, words, { mascot: assets.faceOn });
  const option = legacy(optionsFor(assets, content, format)[0]);
  return renderOne(assets, { format, option, content, pose });
}

/** The pixels that differ between two pictures of the same size, as a box (null when none). */
async function diffBox(x: Buffer, y: Buffer): Promise<{ x0: number; y0: number; x1: number; y1: number } | null> {
  const [p, q] = await Promise.all([sharp(x).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), sharp(y).ensureAlpha().raw().toBuffer({ resolveWithObject: true })]);
  expect(p.info.width).toBe(q.info.width);
  expect(p.info.height).toBe(q.info.height);
  let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  for (let i = 0; i < p.data.length; i += 4) {
    if (p.data[i] === q.data[i] && p.data[i + 1] === q.data[i + 1] && p.data[i + 2] === q.data[i + 2]) continue;
    const px = (i / 4) % p.info.width;
    const py = Math.floor(i / 4 / p.info.width);
    box = box ? { x0: Math.min(box.x0, px), y0: Math.min(box.y0, py), x1: Math.max(box.x1, px), y1: Math.max(box.y1, py) } : { x0: px, y0: py, x1: px, y1: py };
  }
  return box;
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

describe("the face layer: Tween is drawn exactly as before", () => {
  it("a mascot face gives the same picture as the Tween rig put in directly", async () => {
    await db.withAdmin((tx) => tx.query("insert into public.mascots (brand_id, status, name, concept, spec) values ($1, 'active', 'Tween', '{}'::jsonb, '{}'::jsonb)", [b.brandId]));
    await db.withAdmin((tx) => tx.query("update public.brand_memory set mascot_in_posts = true where brand_id = $1", [b.brandId]));
    const { brand, assets } = await setup();
    expect(brand.face?.kind).toBe("mascot");
    expect(assets).toMatchObject({ faceOn: true });
    expect(assets.mascotId).not.toBeNull();

    for (const format of ["square", "portrait", "vertical"] as const) {
      const content = await contentFromBrief(brief, brand, words, { mascot: true });
      const option = legacy(optionsFor(assets, content, format)[0]);
      const viaFace = await renderOne(assets, { format, option, content, pose: "point" });
      const input = await buildInput(assets, { format, option, content, pose: "point" });
      const direct = await renderDesignDetailed({ ...input, mascot: mascotForRender(assets.mascotColors!, "point") });
      expect(Buffer.compare(viaFace.png, direct.png), format).toBe(0);
      expect(viaFace.placements.some((p) => p.kind === "mascot")).toBe(true);
      expect(viaFace.placements.some((p) => p.kind === "bubble")).toBe(true);
    }
  });
});

describe("the face layer: a pose image for any other face", () => {
  let figureBox = { x: 0, y: 0, w: 0, h: 0 };

  it("places the approved pose in the mascot slot with the bubble beside it, in every format that has a slot", async () => {
    await db.withAdmin((tx) => tx.query("update public.brand_memory set mascot_in_posts = false where brand_id = $1", [b.brandId]));
    const mia = await makeApprovedFace(db, b, "illustrated", b.storage, "Mia");
    await setActiveFace({ userId: b.userId, brandId: b.brandId, faceId: mia.id });
    const { brand, assets } = await setup();
    expect(brand).toMatchObject({ mascotOn: false, face: { kind: "illustrated", name: "Mia" } });
    expect(assets).toMatchObject({ faceOn: true, mascotId: null, mascotColors: null });

    for (const format of DESIGN_FORMATS) {
      const r = await draw(assets, brand, format);
      const slot = r.placements.find((p) => p.kind === "mascot");
      if (MASCOT_PX[format] === 0) {
        expect(slot, `${format} has no slot`).toBeUndefined();
        expect(await figurePixels(r.png, { x: 0, y: 0, w: r.width, h: r.height }), format).toBe(0);
        continue;
      }
      expect(slot, format).toBeDefined();
      expect(await figurePixels(r.png, slot!.box), `${format}: the pose is in the slot`).toBeGreaterThan(300);
      // Nowhere else on the picture.
      expect(await figurePixels(r.png, { x: 0, y: 0, w: r.width, h: Math.max(1, slot!.box.y - 2) }), `${format}: nothing above the slot`).toBe(0);
      expect(r.placements.some((p) => p.kind === "bubble" && p.text === words.bubble), `${format}: bubble`).toBe(true);
      expect(r.report.safeZone, format).toEqual([]);
      expect(r.report.overflow, format).toEqual([]);
      expect(r.mascotDropped).toBe(false);
      if (format === "square") figureBox = slot!.box;
    }
  });

  it("the text, QR and logo keep clear of the face", async () => {
    const { brand, assets } = await setup();
    const r = await draw(assets, brand, "square");
    const slot = r.placements.find((p) => p.kind === "mascot")!.box;
    const hit = (a: { x: number; y: number; w: number; h: number }) => a.x < slot.x + slot.w && a.x + a.w > slot.x && a.y < slot.y + slot.h && a.y + a.h > slot.y;
    for (const p of r.placements) {
      if (p.kind === "mascot") continue;
      for (const line of p.lines) expect(hit(line), `${p.name} overlaps the face`).toBe(false);
    }
  });

  it("uses the pose the copy chose, and wave when the pose is not one of the 7", async () => {
    const { brand, assets } = await setup();
    const content = await contentFromBrief(brief, brand, words, { mascot: true });
    const option = legacy(optionsFor(assets, content, "square")[0]);
    const a = (await renderOne(assets, { format: "square", option, content, pose: "wave" })).png;
    const same = (await renderOne(assets, { format: "square", option, content, pose: "breakdance" })).png;
    expect(Buffer.compare(a, same)).toBe(0);
    expect(assets.facePoseCache.has("wave")).toBe(true);
  });

  it("a small face is drawn smaller than a medium one, inside the same slot", async () => {
    const { brand, assets } = await setup();
    const medium = await draw(assets, brand, "square");
    await updateFaceSettings(b.userId, b.brandId, brand.face!.id!, { placement: { size: "small" } });
    const s = await setup();
    const small = await draw(s.assets, s.brand, "square");
    const m = await figurePixels(medium.png, figureBox);
    const sm = await figurePixels(small.png, figureBox);
    expect(sm).toBeGreaterThan(0);
    expect(sm).toBeLessThan(m * (SIZE_FACTOR.small ** 2 + 0.1));
    expect(SIZE_FACTOR.large).toBe(SIZE_FACTOR.medium);
  });

  it("draws no AI tag on a drawn character", async () => {
    const { assets, brand } = await setup();
    const content = await contentFromBrief(brief, brand, words, { mascot: true });
    const input = await buildInput(assets, { format: "square", option: legacy(optionsFor(assets, content, "square")[0]), content, pose: "wave" });
    const group = input.mascot!.build!({ side: "right", halo: false });
    expect(group).toContain("<image");
    expect(group).not.toContain("<rect");
    expect(group).not.toContain("<path");
  });
});

describe("a realistic AI person", () => {
  let asIllustrated: Buffer;
  let asPhotoreal: Buffer;
  let slotBox = { x: 0, y: 0, w: 0, h: 0 };

  it("always carries a small AI tag, drawn in the bottom corner of the face, legible in every format", async () => {
    // The same pose set drawn as a drawn character and as a realistic person: only the tag differs.
    const first = await setup();
    await updateFaceSettings(b.userId, b.brandId, first.brand.face!.id!, { placement: { size: "medium" } });
    const { brand, assets } = await setup();
    const r1 = await draw(assets, brand, "square");
    asIllustrated = r1.png;
    slotBox = r1.placements.find((p) => p.kind === "mascot")!.box;

    const real = await makeApprovedFace(db, b, "photoreal", b.storage, "Eva");
    await setActiveFace({ userId: b.userId, brandId: b.brandId, faceId: real.id });
    const s = await setup();
    expect(s.brand.face?.kind).toBe("photoreal");

    for (const format of DESIGN_FORMATS) {
      if (MASCOT_PX[format] === 0) continue;
      const ill = format === "square" ? asIllustrated : null;
      const r = await draw(s.assets, s.brand, format);
      const slot = r.placements.find((p) => p.kind === "mascot")!.box;
      // The tag in pixels: the pill is AI_TAG.h tall in 400-unit space, scaled with the slot.
      const k = Math.min(slot.w, slot.h) / 400;
      expect(AI_TAG.h * k, `${format}: pill height`).toBeGreaterThanOrEqual(28);
      expect(AI_TAG.font * k, `${format}: letter size`).toBeGreaterThanOrEqual(19);
      // A dark pill with white letters sits at the bottom of the slot.
      const { data, info } = await sharp(r.png).extract({ left: Math.round(slot.x), top: Math.round(slot.y + slot.h * 0.7), width: Math.round(slot.w), height: Math.round(slot.h * 0.3) }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let dark = 0;
      let white = 0;
      for (let i = 0; i < data.length; i += info.channels) {
        if (data[i] < 30 && data[i + 1] < 30 && data[i + 2] < 30) dark++;
        if (data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245) white++;
      }
      expect(dark, `${format}: pill`).toBeGreaterThan(AI_TAG.h * k * AI_TAG.h * k * 0.5);
      expect(white, `${format}: letters`).toBeGreaterThan(20);
      if (ill) {
        asPhotoreal = r.png;
        const diff = await diffBox(ill, r.png);
        expect(diff).not.toBeNull();
        // Only the bottom of the slot changed, and the change is as tall as the pill.
        expect(diff!.y0).toBeGreaterThan(slot.y + slot.h * 0.7);
        expect(diff!.y1).toBeLessThanOrEqual(slot.y + slot.h);
        expect(diff!.x0).toBeGreaterThanOrEqual(slot.x);
        expect(diff!.x1).toBeLessThanOrEqual(slot.x + slot.w);
        expect(diff!.y1 - diff!.y0).toBeGreaterThanOrEqual(Math.round(AI_TAG.h * k) - 2);
      }
    }
    expect(asPhotoreal).toBeDefined();
    expect(slotBox.w).toBeGreaterThan(0);
  });

  it("the tag is code-drawn text: glyph paths in the shipped font, not an image", () => {
    const tagged = faceGroup("data:image/png;base64,AAAA", 320, 480, { aiTag: true });
    expect(tagged).toContain("<image");
    expect(tagged).toContain(`fill="${AI_TAG.fill}"`);
    expect(tagged.match(/<path /g)?.length).toBeGreaterThanOrEqual(2); // "A" and "I"
    expect(tagged).not.toContain("<text");
    const l = layoutFace(320, 480, { aiTag: true });
    expect(l.tag).not.toBeNull();
    expect(l.tag!.x + l.tag!.w).toBeLessThanOrEqual(400);
    expect(l.tag!.y + l.tag!.h).toBeLessThanOrEqual(400);
  });

  it("is never on a testimonial, while a drawn character still is", async () => {
    const testimonial: Brief = { ...brief, postType: "testimonial" };
    const real = await setup(testimonial);
    expect(real.brand.face?.kind).toBe("photoreal"); // the brand's face is on...
    expect(real.assets).toMatchObject({ face: null, faceOn: false }); // ...but not for a testimonial
    const r = await draw(real.assets, real.brand, "square", "point", testimonial);
    expect(r.placements.some((p) => p.kind === "mascot" || p.kind === "bubble")).toBe(false);
    expect(await figurePixels(r.png, { x: 0, y: 0, w: r.width, h: r.height })).toBe(0);

    // An offer post still has it.
    const offer = await setup(brief);
    expect(offer.assets.faceOn).toBe(true);

    // A drawn character is not blocked from testimonials by this rule.
    const mia = (await db.withAdmin((tx) => tx.query<{ id: string }>("select id::text as id from public.brand_faces where brand_id = $1 and kind = 'illustrated' and status = 'approved'", [b.brandId])))[0].id;
    await setActiveFace({ userId: b.userId, brandId: b.brandId, faceId: mia });
    const drawn = await setup(testimonial);
    expect(drawn.assets.faceOn).toBe(true);
  });

  it("a face limited to some post types stays off the others", async () => {
    const { brand } = await setup();
    await updateFaceSettings(b.userId, b.brandId, brand.face!.id!, { postTypes: ["event"] });
    const off = await setup(brief); // an offer
    expect(off.assets).toMatchObject({ face: null, faceOn: false });
    const on = await setup({ ...brief, postType: "event" });
    expect(on.assets.faceOn).toBe(true);
    await updateFaceSettings(b.userId, b.brandId, brand.face!.id!, { postTypes: [] });
  });

  it("a missing pose file draws no face rather than failing the picture", async () => {
    const { brand, assets } = await setup();
    for (const rel of await b.storage.list("mascots", `${b.brandId}/faces/${brand.face!.id}`)) await b.storage.remove("mascots", rel);
    const r = await draw(assets, brand, "square");
    expect(r.placements.some((p) => p.kind === "mascot")).toBe(false);
    expect(r.png.length).toBeGreaterThan(1000);
  });
});
