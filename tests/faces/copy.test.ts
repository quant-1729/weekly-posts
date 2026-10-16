import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PostCopy } from "@/lib/ai/schemas-v3";
import type { Brief } from "@/lib/briefs/types";
import { loadCreateBrand } from "@/lib/create";
import { validateCopy, writePostCopy } from "@/lib/create/copy";
import type { MockDb } from "@/lib/db/mock";
import { setActiveFace } from "@/lib/faces/service";
import { closeDb, openDb } from "../helpers/details";
import { NOW, cleanup, makeBakery, readyBrief, type Bakery } from "../create/pipeline/helpers";
import { makeApprovedFace } from "./helpers";

let db: MockDb;
let b: Bakery;
let brief: Brief;

const copy = (over: Partial<PostCopy> = {}): PostCopy => ({
  headline: "Cake week is here",
  subline: "",
  cta_text: "Visit us today",
  captions: [{ channel: "instagram", text: "Cake week! 20% off cakes until 20 Oct." }],
  hashtags: [],
  bubble: "Come say hi!",
  pose: "celebrate",
  ...over,
});

beforeAll(async () => {
  db = await openDb();
  b = await makeBakery(db);
  brief = await readyBrief(b, { channels: ["instagram"] });
});
afterAll(async () => {
  cleanup(b);
  await closeDb(db);
});

describe("the face's words", () => {
  const ctx = () => ({ brief, brandName: "Corner Bakery", language: "en", channels: ["instagram"], mascot: true, contactLines: [] as string[] });

  it("a bubble line holding a phrase the face never says is left empty", () => {
    const r = validateCopy(copy({ bubble: "Guaranteed to be the best!" }), { ...ctx(), neverSay: ["guaranteed"] });
    expect(r.bubble).toBe("");
    expect(r.pose).toBe("celebrate");
    expect(r.fixes).toContain("bubble_never_say");
    expect(validateCopy(copy({ bubble: "Come say hi!" }), { ...ctx(), neverSay: ["guaranteed"] }).bubble).toBe("Come say hi!");
  });

  it("the pose is one of the 7 whatever the face", () => {
    expect(validateCopy(copy({ pose: "breakdance" }), ctx()).pose).toBe("wave");
    for (const pose of ["wave", "talk", "point", "think", "celebrate", "present", "idle"]) expect(validateCopy(copy({ pose }), ctx()).pose).toBe(pose);
  });

  it("the copy call is told the face's name, and none at all when the post has no face", async () => {
    const mia = await makeApprovedFace(db, b, "illustrated", b.storage, "Mia");
    await setActiveFace({ userId: b.userId, brandId: b.brandId, faceId: mia.id });
    const brand = await loadCreateBrand(b.userId, b.brandId);
    const seen: string[] = [];
    const fixture = (p: { user: string }) => {
      seen.push(p.user);
      return copy();
    };
    await writePostCopy({ userId: b.userId, brandId: b.brandId, brief, brand, now: NOW }, { fixture });
    await writePostCopy({ userId: b.userId, brandId: b.brandId, brief, brand, mascot: false, face: null, now: NOW }, { fixture });
    expect(seen[0]).toContain("MASCOT: Mia");
    expect(seen[1]).toContain("MASCOT: none");
  });
});
