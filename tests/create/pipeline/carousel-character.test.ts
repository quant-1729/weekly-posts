// A carousel with the brand's character: the character takes part in the slides by kind of slide.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PostCopy } from "@/lib/ai/schemas-v3";
import { chooseDesign, loadDesignPage, type DesignPageData } from "@/lib/create";
import type { StoredDesign } from "@/lib/create/types";
import type { MockDb } from "@/lib/db/mock";
import type { SlideText } from "@/lib/design/types";
import { closeDb, openDb } from "../../helpers/details";
import { NOW, cleanup, makeBakery, readyBrief, type Bakery } from "./helpers";

let db: MockDb;
let b: Bakery;

const SLIDES: SlideText[] = [
  { kind: "cover", headline: "Cake week is here", body: "Fresh every morning" },
  { kind: "point", headline: "Free delivery in London", body: "" },
  { kind: "point", headline: "Baked every morning", body: "" },
  { kind: "proof", headline: "20% off cakes", body: "" },
  { kind: "cta", headline: "Visit us today", body: "" },
];
const copy = (): PostCopy => ({
  headline: "Cake week is here",
  subline: "Fresh every morning",
  cta_text: "Visit us today",
  captions: [{ channel: "instagram", text: "Cake week at Corner Bakery with 20% off cakes until 20 Oct." }],
  hashtags: [],
  bubble: "Come say hi!",
  pose: "wave",
  slides: SLIDES,
});
const deps = { copy: { fixture: copy() }, now: NOW };

beforeAll(async () => {
  db = await openDb();
  b = await makeBakery(db);
  await db.withAdmin((tx) => tx.query("update public.brand_memory set mascot_in_posts = true where brand_id = $1", [b.brandId]));
  await db.withAdmin((tx) => tx.query("insert into public.mascots (brand_id, status, name, concept, spec) values ($1, 'active', 'Tween', '{}'::jsonb, '{}'::jsonb)", [b.brandId]));
});
afterAll(async () => {
  cleanup(b);
  await closeDb(db);
});

describe("the character in a carousel", () => {
  it("draws every slide of an option with a role in the same design, and keeps the pictures clean", async () => {
    const brief = await readyBrief(b, { contentFormat: "carousel", slideCount: 5, secondaryUspIds: [b.usps.delivery.id], channels: ["instagram"], qr: { kind: "link", target: "website", url: "https://bakery.example.com" } });
    const args = { userId: b.userId, brandId: b.brandId, briefId: brief.id };
    const page = (await loadDesignPage(args, deps)) as DesignPageData;
    expect(page.hasMascot).toBe(true);
    const withRole = page.options.findIndex((o) => o.option.role);
    expect(withRole).toBeGreaterThanOrEqual(0);
    for (const o of page.options) expect(o.slides).toHaveLength(5);

    const out = await chooseDesign({ ...args, option: page.options[withRole].option }, deps);
    expect(out.blockers).toEqual([]);
    expect(out.slides).toHaveLength(5);
    const designs = out.slides.map((s) => s.design as StoredDesign);
    expect(new Set(designs.map((d) => d.scheme)).size).toBe(1);
    expect(new Set(out.slides.map((s) => s.themeId)).size).toBe(1);
    expect(designs.map((d) => d.slide?.kind)).toEqual(SLIDES.map((x) => x.kind));
    // The character is part of the post (a mascot is recorded on every slide row and on the post).
    expect(out.posts[0].mascotId).toBeTruthy();
    expect(out.slides.every((s) => s.mascotId === out.posts[0].mascotId)).toBe(true);
  }, 180_000);
});
