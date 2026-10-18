// The Brand Face in the Design Studio: a pose-image face (illustrated, realistic AI person, the owner's own photos) is on the
// studio's starting designs in every size where it fits, drawn the same in the browser and on the server, and a realistic AI
// person always carries its code-drawn "AI" tag (and makes the caption say "Image made with AI.").
// Fixtures only: small generated transparent poses, no AI, no network.
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PostCopy } from "@/lib/ai/schemas-v3";
import { ensureDraftPosts, listBriefPosts } from "@/lib/create";
import type { StoredDesign } from "@/lib/create/types";
import type { MockDb } from "@/lib/db/mock";
import { setActiveFace } from "@/lib/faces/service";
import { FACE_POSES } from "@/lib/faces/types";
import { enforceFace, finishStudio, loadStudioPage, restampStudio, studioWords } from "@/lib/studio/service";
import { adaptDoc } from "@/lib/studio/ops";
import { aiTagFor, aiTagOutside, layoutText } from "@/lib/studio/scene";
import { getServerShaper, renderStudioDoc } from "@/lib/studio/server";
import { buildOptions, fontsInDoc, TEMPLATE_IDS } from "@/lib/studio/templates";
import { STORY_SAFE, STUDIO_FORMATS, STUDIO_SIZE, type ImageLayer, type Layer, type StudioDoc, type StudioFace, type StudioFormat, type StudioInput, type StudioState } from "@/lib/studio/types";
import { closeDb, openDb } from "../helpers/details";
import { NOW, cleanup, makeBakery, readyBrief, type Bakery } from "../create/pipeline/helpers";
import { figurePixels, makeApprovedFace, poseFixture } from "../faces/helpers";

const DUMP = process.env.FACE_DUMP;

const poseSrc = (pose: string) => `/api/files/mascots/b1/faces/f1/${pose}.png`;
const face = (ai: boolean, w = 320, h = 480): StudioFace => ({
  name: "Mia",
  ai,
  pose: "wave",
  poses: Object.fromEntries(FACE_POSES.map((p) => [p, { src: poseSrc(p), w, h }])),
});

const base = (format: StudioFormat, withPhoto: boolean, f: StudioFace | null, mascot = false): StudioInput => ({
  format,
  content: {
    brandName: "Sweet Crumbs Bakery",
    headline: "Monday's special",
    subline: "",
    offer: "20% OFF",
    offerNote: "On all cakes · Monday only",
    cta: "Order on WhatsApp",
    contacts: [
      { kind: "phone", text: "+91 98200 12345" },
      { kind: "website", text: "sweetcrumbs.example.com" },
    ],
    qr: { data: "https://example.com/r/abc1234", label: "Scan to visit" },
    language: "en",
  },
  brand: {
    colors: { primary: "#1F4E9C", secondary: "#F5A623", accent: "#F5A623", background: "#FFFFFF" },
    fonts: { headline: "sans", body: "sans" },
    logo: null,
    character: mascot ? { svg: '<circle cx="130" cy="130" r="120" fill="#00aa55"/>', vw: 260, vh: 260 } : null,
    face: f,
  },
  photo: withPhoto ? { id: "p1", src: "/api/files/photos/b1/photo.jpg", w: 1200, h: 900 } : null,
});

/** The pose fixture for any face file; nothing else resolves. */
let photoJpeg: Buffer | null = null;
const fakeStorage = (png: Buffer) => ({ get: async (bucket: string) => (bucket === "mascots" ? { bytes: new Uint8Array(png), contentType: "image/png" } : bucket === "photos" && photoJpeg ? { bytes: new Uint8Array(photoJpeg), contentType: "image/jpeg" } : null) }) as never;

const faceLayerOf = (doc: StudioDoc): ImageLayer | undefined => doc.layers.find((l): l is ImageLayer => l.kind === "image" && l.asset === "face");

type Box = { x: number; y: number; w: number; h: number };
const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("the starting designs with a pose-image face", () => {
  let png: Buffer;
  beforeAll(async () => {
    png = await poseFixture();
    photoJpeg = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#c47a3c" } }).jpeg().toBuffer();
  });

  it("puts the face in all five designs, in every size, with and without a photo, clear of the words, QR and contacts", async () => {
    const shaper = await getServerShaper();
    const missing: string[] = [];
    for (const format of STUDIO_FORMATS) {
      for (const withPhoto of [false, true]) {
        const opts = buildOptions(base(format, withPhoto, face(false)), shaper);
        expect(opts.map((o) => o.doc.meta.template)).toEqual([...TEMPLATE_IDS]);
        for (const o of opts) {
          const tag = `${o.doc.meta.template} ${format} ${withPhoto ? "photo" : "no photo"}`;
          const f = faceLayerOf(o.doc);
          if (!f) {
            missing.push(tag);
            continue;
          }
          const { width: W, height: H } = STUDIO_SIZE[format];
          expect(f.role, tag).toBe("character");
          expect(f.src, tag).toBe(poseSrc("wave"));
          expect(f.x, tag).toBeGreaterThanOrEqual(0);
          expect(f.y, tag).toBeGreaterThanOrEqual(0);
          expect(f.x + f.w, tag).toBeLessThanOrEqual(W);
          expect(f.y + f.h, tag).toBeLessThanOrEqual(H);
          if (format === "vertical") {
            expect(f.y, tag).toBeGreaterThanOrEqual(STORY_SAFE.top);
            expect(f.y + f.h, tag).toBeLessThanOrEqual(STORY_SAFE.bottom);
          }
          // Not over anything that carries words or a code.
          for (const l of o.doc.layers) {
            if (l === f || l.hidden) continue;
            let box: Box | null = null;
            if (l.kind === "chip" || l.kind === "badge" || l.kind === "qr") box = { x: l.x, y: l.y, w: l.w, h: l.h };
            if (l.kind === "text" && l.text.trim()) {
              const lay = layoutText(l, shaper);
              const top = l.y + (l.valign === "middle" ? (l.h - lay.blockH) / 2 : l.valign === "bottom" ? l.h - lay.blockH : 0);
              const left = l.align === "center" ? l.x + (l.w - lay.width) / 2 : l.align === "right" ? l.x + l.w - lay.width : l.x;
              box = { x: left, y: top, w: lay.width, h: lay.blockH };
            }
            if (box) expect(hit(f, box), `${tag}: face over ${l.kind} "${"text" in l ? l.text : l.name}"`).toBe(false);
          }
          if (DUMP) {
            mkdirSync(DUMP, { recursive: true });
            const r = await renderStudioDoc(o.doc, { brandId: "b1", qrData: "https://example.com/r/abc1234", storage: fakeStorage(png), verifyQr: false });
            writeFileSync(`${DUMP}/${o.doc.meta.template}-${format}-${withPhoto ? "photo" : "nophoto"}.png`, r.png);
          }
        }
      }
    }
    // Every combination has room for the face in this test data.
    expect(missing).toEqual([]);
  }, 120_000);

  it("faces the content: turned the other way on the right half", async () => {
    const shaper = await getServerShaper();
    for (const o of buildOptions(base("square", false, face(false)), shaper)) {
      const f = faceLayerOf(o.doc)!;
      expect(!!f.flipX, o.doc.meta.template).toBe(f.x + f.w / 2 > 540);
    }
  });

  it("draws the pose pixels where the layer is (transparent, uncropped) in the server render", async () => {
    const shaper = await getServerShaper();
    for (const o of buildOptions(base("portrait", true, face(false)), shaper)) {
      const f = faceLayerOf(o.doc)!;
      const r = await renderStudioDoc({ ...o.doc, layers: o.doc.layers.map((l) => (l.kind === "image" && l.asset !== "face" ? { ...l, hidden: true } : l)) }, { brandId: "b1", qrData: "https://example.com/r/abc1234", storage: fakeStorage(png), verifyQr: false });
      const inside = await figurePixels(r.png, f);
      // The figure fills 60% x 75% of the pose image.
      expect(inside, o.doc.meta.template).toBeGreaterThan(f.w * f.h * 0.3);
      expect(inside, o.doc.meta.template).toBeLessThan(f.w * f.h * 0.5);
      expect(r.aiFace).toBe(false);
    }
  }, 60_000);

  it("a face that is off gives no face layer; a rig character gives the character layer as before", async () => {
    const shaper = await getServerShaper();
    for (const o of buildOptions(base("square", false, null), shaper)) expect(o.doc.layers.some((l) => l.role === "character"), o.doc.meta.template).toBe(false);
    const rig = buildOptions(base("square", false, null, true), shaper);
    for (const o of rig) {
      const c = o.doc.layers.filter((l) => l.role === "character");
      expect(c, o.doc.meta.template).toHaveLength(1);
      expect(c[0].kind).toBe("character");
    }
  });

  it("keeps the pose the owner picked when the design moves to another size", async () => {
    const shaper = await getServerShaper();
    const input = base("square", false, face(false));
    const doc = buildOptions(input, shaper)[0].doc;
    const f = faceLayerOf(doc)!;
    f.src = poseSrc("celebrate");
    const other = adaptDoc(doc, "vertical", { ...input, format: "vertical" }, shaper);
    expect(faceLayerOf(other)?.src).toBe(poseSrc("celebrate"));
    // Taken out by the owner: stays out.
    const gone = adaptDoc({ ...doc, layers: doc.layers.filter((l) => l !== f) }, "vertical", { ...input, format: "vertical" }, shaper);
    expect(faceLayerOf(gone)).toBeUndefined();
  });
});

describe("the AI tag of a realistic AI person", () => {
  let png: Buffer;
  beforeAll(async () => {
    png = await poseFixture();
  });

  const renderOf = async (doc: StudioDoc) => renderStudioDoc(doc, { brandId: "b1", qrData: "https://example.com/r/abc1234", storage: fakeStorage(png), verifyQr: false });

  /** The colour at the left part of the tag pill (the pill is #111111, the letters sit further in). */
  async function pillPixel(doc: StudioDoc, l: ImageLayer, pngOut: Buffer): Promise<[number, number, number]> {
    const shaper = await getServerShaper();
    const t = aiTagFor(l, shaper);
    const x = Math.round(l.x + t.x + t.padX * 0.45);
    const y = Math.round(l.y + t.y + t.h / 2);
    const { data } = await sharp(pngOut).extract({ left: x, top: y, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    void doc;
    return [data[0], data[1], data[2]];
  }

  it("is drawn by code in the render for a photoreal face, in every design and size, and is reported", async () => {
    const shaper = await getServerShaper();
    for (const format of STUDIO_FORMATS) {
      const plain = buildOptions(base(format, false, face(false)), shaper);
      const ai = buildOptions(base(format, false, face(true)), shaper);
      for (let i = 0; i < ai.length; i++) {
        const f = faceLayerOf(ai[i].doc)!;
        expect(f.ai, `${ai[i].doc.meta.template} ${format}`).toBe(true);
        expect(aiTagOutside(ai[i].doc, shaper)).toEqual([]);
        const r = await renderOf(ai[i].doc);
        expect(r.aiFace).toBe(true);
        expect(r.svg).not.toContain("<text");
        const [pr, pg, pb] = await pillPixel(ai[i].doc, f, r.png);
        expect(Math.max(pr, pg, pb), `${ai[i].doc.meta.template} ${format}: pill`).toBeLessThan(40);
        const p = await renderOf(plain[i].doc);
        expect(p.aiFace).toBe(false);
        // The tag is inside the face's box (it never hangs off the picture).
        const t = aiTagFor(f, shaper);
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.x + t.w).toBeLessThanOrEqual(f.w);
        expect(t.y + t.h).toBeLessThanOrEqual(f.h);
      }
    }
  }, 180_000);

  it("cannot be faded away or covered: the tag is drawn whole, last, above every layer", async () => {
    const shaper = await getServerShaper();
    const doc = buildOptions(base("square", false, face(true)), shaper)[0].doc;
    const f = faceLayerOf(doc)!;
    // Nearly see-through, with a big sticker on top of everything.
    const faded: StudioDoc = {
      ...doc,
      layers: [...doc.layers.map((l) => (l === f ? ({ ...l, opacity: 0.05 } as Layer) : l)), { id: "cover", kind: "shape", name: "Cover", shape: "rect", x: f.x - 20, y: f.y - 20, w: f.w + 40, h: f.h + 40, rot: 0, opacity: 1, fill: { kind: "solid", color: "#FFFFFF" } }],
    };
    const r = await renderOf(faded);
    const [pr, pg, pb] = await pillPixel(faded, f, r.png);
    expect(Math.max(pr, pg, pb)).toBeLessThan(40);
    // Hidden means no face on the picture, so no tag and no disclosure.
    const hidden = await renderOf({ ...doc, layers: doc.layers.map((l) => (l === f ? ({ ...l, hidden: true } as Layer) : l)) });
    expect(hidden.aiFace).toBe(false);
    // The tag's own font is listed for loading in the browser.
    expect(fontsInDoc(doc)).toContainEqual({ font: "poppins", weight: 800 });
  });

  it("a picture moved so its tag falls off the poster is reported", async () => {
    const shaper = await getServerShaper();
    const doc = buildOptions(base("square", false, face(true)), shaper)[0].doc;
    const f = faceLayerOf(doc)!;
    const moved: StudioDoc = { ...doc, layers: doc.layers.map((l) => (l === f ? ({ ...l, x: 1080 - f.w * 0.5 } as Layer) : l)) };
    expect(aiTagOutside(moved, shaper)).toHaveLength(1);
  });

  it("enforceFace puts the tag back, and takes out a face that is not allowed", async () => {
    const shaper = await getServerShaper();
    const doc = buildOptions(base("square", false, face(true)), shaper)[0].doc;
    const f = faceLayerOf(doc)!;
    const stripped: StudioDoc = { ...doc, layers: doc.layers.map((l) => (l === f ? ({ ...l, ai: false } as Layer) : l)) };
    const ok = { id: "f1", ai: true };
    expect(faceLayerOf(enforceFace(stripped, "b1", ok))?.ai).toBe(true);
    expect(faceLayerOf(enforceFace(doc, "b1", null))).toBeUndefined(); // face off or not allowed on this post
    expect(faceLayerOf(enforceFace(doc, "b1", { id: "other", ai: true }))).toBeUndefined(); // an old face
    expect(faceLayerOf(enforceFace(doc, "someone-else", ok))).toBeUndefined(); // another brand's file
  });
});

describe("the studio page and 'Use this design' with a stored face", () => {
  let db: MockDb;
  let b: Bakery;
  const copy: PostCopy = {
    headline: "Cake week is here",
    subline: "",
    cta_text: "Visit us today",
    captions: [{ channel: "instagram", text: "Cake week! 20% off cakes until 20 Oct." }],
    hashtags: [],
    bubble: "Come say hi!",
    pose: "point",
  };
  const deps = { copy: { fixture: copy }, now: NOW };
  const args = (briefId: string) => ({ userId: b.userId, brandId: b.brandId, briefId });

  beforeAll(async () => {
    db = await openDb();
    b = await makeBakery(db);
  });
  afterAll(async () => {
    cleanup(b);
    await closeDb(db);
  });

  async function useFace(kind: "illustrated" | "photoreal" | "owner_photo", name: string) {
    const f = await makeApprovedFace(db, b, kind, b.storage, name);
    await setActiveFace({ userId: b.userId, brandId: b.brandId, faceId: f.id });
    return f;
  }

  async function studioFor(briefPatch: Record<string, unknown> = {}, postType?: string) {
    const brief = await readyBrief(b, { channels: ["instagram"], ...briefPatch });
    if (postType) await db.withAdmin((tx) => tx.query("update public.post_briefs set post_type = $2 where id = $1", [brief.id, postType]));
    await ensureDraftPosts(args(brief.id), deps);
    const page = await loadStudioPage(args(brief.id));
    return { brief, page: page! };
  }

  async function finish(page: NonNullable<Awaited<ReturnType<typeof loadStudioPage>>>, briefId: string, docs?: Partial<Record<StudioFormat, StudioDoc>>) {
    const shaper = await getServerShaper();
    const options = buildOptions(page.input, shaper);
    const doc = options[0].doc;
    const state: StudioState = { v: 1, main: "square", docs: docs ?? { square: doc } };
    const res = await finishStudio({ ...args(briefId), state, input: page.input });
    return { res, doc };
  }

  for (const kind of ["illustrated", "photoreal", "owner_photo"] as const) {
    it(`${kind}: the studio page carries the face, every template places it, and the stored picture has its pixels`, async () => {
      const name = { illustrated: "Dot", photoreal: "Ivy", owner_photo: "Sam" }[kind];
      const f = await useFace(kind, name);
      const { brief, page } = await studioFor();
      const face_ = page.input.brand.face;
      expect(face_).not.toBeNull();
      expect(face_!.ai).toBe(kind === "photoreal");
      expect(face_!.name).toBe(name);
      expect(Object.keys(face_!.poses).sort()).toEqual([...FACE_POSES].sort());
      expect(face_!.pose).toBe("point"); // the copy's pose hint
      expect(face_!.poses.wave.src).toBe(`/api/files/mascots/${b.brandId}/faces/${f.id}/wave.png`);
      expect(page.input.brand.character).toBeNull();

      const shaper = await getServerShaper();
      for (const o of buildOptions(page.input, shaper)) {
        const layer = faceLayerOf(o.doc);
        expect(layer, o.doc.meta.template).toBeDefined();
        expect(layer!.ai === true).toBe(kind === "photoreal");
      }

      // Use the first design: the stored pictures hold the face.
      const { res, doc } = await finish(page, brief.id);
      expect(res).toEqual({ ok: true });
      const layer = faceLayerOf(doc)!;
      const posts = await listBriefPosts(b.userId, b.brandId, brief.id);
      expect(posts).toHaveLength(1);
      const stored = await b.storage.get("renders", `${b.brandId}/${posts[0].id}/square.png`);
      expect(stored).not.toBeNull();
      expect(await figurePixels(Buffer.from(stored!.bytes), layer)).toBeGreaterThan(layer.w * layer.h * 0.25);
      const design = posts[0].design as StoredDesign;
      expect(design.studio?.formats).toContain("square");
      expect(design.aiFace).toBe(kind === "photoreal" ? true : undefined);

      // The AI tag is on the stored picture of a realistic AI person.
      if (kind === "photoreal") {
        const sh = await getServerShaper();
        const t = aiTagFor(layer, sh);
        const { data } = await sharp(Buffer.from(stored!.bytes)).extract({ left: Math.round(layer.x + t.x + t.padX * 0.45), top: Math.round(layer.y + t.y + t.h / 2), width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        expect(Math.max(data[0], data[1], data[2])).toBeLessThan(40);
      }
    }, 120_000);
  }

  it("photoreal: a design where the owner deleted the face has no AI disclosure; restamp keeps the rules", async () => {
    await useFace("photoreal", "Eva");
    const { brief, page } = await studioFor();
    const shaper = await getServerShaper();
    const doc = buildOptions(page.input, shaper)[0].doc;
    const noFace: StudioDoc = { ...doc, layers: doc.layers.filter((l) => !(l.kind === "image" && l.asset === "face")) };
    const { res } = await finish(page, brief.id, { square: noFace });
    expect(res).toEqual({ ok: true });
    let posts = await listBriefPosts(b.userId, b.brandId, brief.id);
    expect((posts[0].design as StoredDesign).aiFace).toBeUndefined();

    // With the face in, restamp (the pipeline redrawing a brief) keeps the disclosure and the tag.
    const withFace = await finish(page, brief.id, { square: doc });
    expect(withFace.res).toEqual({ ok: true });
    await restampStudio(b.userId, b.brandId, brief.id);
    posts = await listBriefPosts(b.userId, b.brandId, brief.id);
    expect((posts[0].design as StoredDesign).aiFace).toBe(true);
  }, 120_000);

  it("a tag that would be off the poster stops 'Use this design'", async () => {
    await useFace("photoreal", "Eve");
    const { brief, page } = await studioFor();
    const shaper = await getServerShaper();
    const doc = buildOptions(page.input, shaper)[0].doc;
    const f = faceLayerOf(doc)!;
    const moved: StudioDoc = { ...doc, layers: doc.layers.map((l) => (l === f ? ({ ...l, x: 1080 - f.w * 0.4 } as Layer) : l)) };
    const { res } = await finish(page, brief.id, { square: moved });
    expect(res.ok).toBe(false);
  }, 60_000);

  it("photoreal is never on a testimonial: no face on the page, and a saved face layer is taken out when drawing", async () => {
    await useFace("photoreal", "Eda");
    const offer = await studioFor();
    const withFace = buildOptions(offer.page.input, await getServerShaper())[0].doc;
    expect(faceLayerOf(withFace)).toBeDefined();

    const t = await studioFor({}, "testimonial");
    expect(t.page.input.brand.face ?? null).toBeNull();
    for (const o of buildOptions(t.page.input, await getServerShaper())) expect(faceLayerOf(o.doc)).toBeUndefined();

    // A design saved with a face layer (from an offer post) used on a testimonial: the face is dropped, no disclosure.
    const { res } = await finish(t.page, t.brief.id, { square: withFace });
    expect(res).toEqual({ ok: true });
    const posts = await listBriefPosts(b.userId, b.brandId, t.brief.id);
    expect((posts[0].design as StoredDesign).aiFace).toBeUndefined();
    const stored = await b.storage.get("renders", `${b.brandId}/${posts[0].id}/square.png`);
    const layer = faceLayerOf(withFace)!;
    expect(await figurePixels(Buffer.from(stored!.bytes), { x: 0, y: 0, w: 1080, h: 1080 })).toBe(0);
    void layer;
  }, 120_000);

  it("face off: nothing; and the rig character path is unchanged", async () => {
    await db.withAdmin((tx) => tx.query("update public.brand_memory set face_in_posts = false where brand_id = $1", [b.brandId]));
    const off = await studioFor();
    expect(off.page.input.brand.face ?? null).toBeNull();
    expect(off.page.input.brand.character).toBeNull();

    await db.withAdmin((tx) => tx.query("insert into public.mascots (brand_id, status, name, concept, spec) values ($1, 'active', 'Tween', '{}'::jsonb, '{}'::jsonb)", [b.brandId]));
    await db.withAdmin((tx) => tx.query("update public.brand_memory set active_face_id = null, mascot_in_posts = true where brand_id = $1", [b.brandId]));
    const rig = await studioFor();
    expect(rig.page.input.brand.face ?? null).toBeNull();
    expect(rig.page.input.brand.character).not.toBeNull();
    const shaper = await getServerShaper();
    for (const o of buildOptions(rig.page.input, shaper)) {
      const c = o.doc.layers.filter((l) => l.role === "character");
      expect(c, o.doc.meta.template).toHaveLength(1);
      expect(c[0].kind).toBe("character");
    }
    // studioWords still ignores the face.
    expect(studioWords(buildOptions(rig.page.input, shaper)[0].doc).headline).toBeTruthy();
  }, 120_000);

  it("pose files that are missing are left out; with none the studio has no face", async () => {
    const f = await makeApprovedFace(db, b, "illustrated", b.storage, "Gap");
    await setActiveFace({ userId: b.userId, brandId: b.brandId, faceId: f.id });
    await b.storage.remove("mascots", `${b.brandId}/faces/${f.id}/point.png`);
    const { page } = await studioFor();
    expect(page.input.brand.face?.poses.point).toBeUndefined();
    expect(page.input.brand.face?.pose).toBe("wave");
  });
});
