// F-7: a realistic AI person is labelled when the post is published, never used for a regulated business, and never on a
// testimonial. The Graph API has no field for the "AI info" label of an organic post, so the caption ends with
// "Image made with AI." (see src/lib/publish/caption.ts). Publishing runs against a fake Graph API.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostCopy } from "@/lib/ai/schemas-v3";
import type { Brief } from "@/lib/briefs/types";
import { resetTokenKeyForTests } from "@/lib/connections/crypto";
import { saveConnection } from "@/lib/connections/service";
import { chooseDesign, loadCreateBrand, loadDesignPage, type DesignPageData } from "@/lib/create";
import { loadDesignAssets } from "@/lib/create/render";
import type { StoredDesign } from "@/lib/create/types";
import type { MockDb } from "@/lib/db/mock";
import { setActiveFace } from "@/lib/faces/service";
import { createPublisher } from "@/lib/publish";
import { AI_DISCLOSURE_LINE, IG_CAPTION_MAX, composeCaption } from "@/lib/publish/caption";
import { closeDb, fakeFetch, makeOwner, openDb, stubMetaEnv, when, type Handler, type Owner } from "../connections/helpers";
import { NOW, cleanup, makeBakery, readyBrief, type Bakery } from "../create/pipeline/helpers";
import { makeApprovedFace } from "./helpers";
import { publicStorage, seedPost } from "../publish/helpers";

let db: MockDb;
let b: Bakery;

const copy = (over: Partial<PostCopy> = {}): PostCopy => ({
  headline: "Cake week is here",
  subline: "",
  cta_text: "Visit us today",
  captions: [{ channel: "instagram", text: "Cake week! 20% off cakes until 20 Oct." }],
  hashtags: [],
  bubble: "Come say hi!",
  pose: "point",
  ...over,
});
const deps = (c: PostCopy = copy()) => ({ copy: { fixture: c }, now: NOW });
const args = (briefId: string) => ({ userId: b.userId, brandId: b.brandId, briefId });

beforeAll(async () => {
  db = await openDb();
  b = await makeBakery(db);
});
afterAll(async () => {
  cleanup(b);
  await closeDb(db);
});
beforeEach(() => {
  stubMetaEnv();
  resetTokenKeyForTests();
});
afterEach(() => vi.unstubAllEnvs());

describe("the AI disclosure line in a caption", () => {
  it("is the last line, after the hashtags, and only when asked for", () => {
    expect(composeCaption("Fresh sourdough today.", ["bakery"])).toBe("Fresh sourdough today.\n\n#bakery");
    expect(composeCaption("Fresh sourdough today.", ["bakery"], undefined, undefined, { aiDisclosure: true })).toBe("Fresh sourdough today.\n\n#bakery\n\nImage made with AI.");
    expect(composeCaption("Fresh sourdough today.", [], undefined, undefined, { aiDisclosure: true })).toBe("Fresh sourdough today.\n\nImage made with AI.");
    expect(composeCaption(null, null, undefined, undefined, { aiDisclosure: true })).toBe(AI_DISCLOSURE_LINE);
    expect(AI_DISCLOSURE_LINE).toBe("Image made with AI.");
  });

  it("is never added twice", () => {
    const once = composeCaption("Fresh sourdough today.\n\nImage made with AI.", ["bakery"], undefined, undefined, { aiDisclosure: true });
    expect(once.match(/Image made with AI\./g)).toHaveLength(1);
    expect(once.endsWith("Image made with AI.")).toBe(true);
  });

  it("always fits: a long caption is cut to leave room for it, within the limit", () => {
    const long = "word ".repeat(600);
    for (const max of [IG_CAPTION_MAX, 8000]) {
      const out = composeCaption(long, ["a", "b"], max, 30, { aiDisclosure: true });
      expect(out.length).toBeLessThanOrEqual(max);
      expect(out.endsWith("\n\nImage made with AI.")).toBe(true);
    }
  });
});

describe("publishing a post that shows a realistic AI person", () => {
  const IG = "17841400000000001";
  const PAGE = "1001";
  let owner: Owner;

  const igHandlers = (): Handler[] => [
    when("GET", /\/content_publishing_limit$/, { body: { data: [{ quota_usage: 1, config: { quota_total: 100, quota_duration: 86400 } }] } }),
    when("POST", /\/media$/, { body: { id: "C1" } }),
    when("GET", /\/C1$/, { body: { status_code: "FINISHED" } }),
    when("POST", /\/media_publish$/, { body: { id: "M1" } }),
    when("GET", /\/M1$/, { body: { permalink: "https://www.instagram.com/p/ABC123/" } }),
  ];

  async function publishWith(aiFace: boolean, channel: "instagram" | "facebook") {
    owner = await makeOwner(db);
    if (channel === "instagram") {
      await saveConnection({ brandId: owner.brandId, userId: owner.userId, provider: "instagram", accountId: IG, accountName: "@cornerbakery", scopes: [], platformUserId: null, expiresAt: new Date(Date.now() + 40 * 86400_000), token: "IGAAlong-lived-token-ZZZZ1234567890" });
    } else {
      await saveConnection({ brandId: owner.brandId, userId: owner.userId, provider: "facebook", accountId: PAGE, accountName: "Corner Bakery", scopes: [], platformUserId: null, expiresAt: null, token: "EAAPageAccessToken-QQQQ1234567890" });
    }
    const seeded = await seedPost(db, owner, { channel, images: { square: "square.png", portrait: "portrait.png" }, caption: "Fresh sourdough today.", hashtags: ["bakery"] });
    await db.withAdmin((tx) => tx.query("update public.posts set design = $2::jsonb where id = $1", [seeded.postId, JSON.stringify({ v: 1, ...(aiFace ? { aiFace: true } : {}) })]));
    const handlers: Handler[] =
      channel === "instagram"
        ? igHandlers()
        : [
            when("POST", /\/photos$/, { body: { id: "555", post_id: `${PAGE}_555` } }),
            when("POST", /\/feed$/, { body: { id: `${PAGE}_777` } }),
            when("GET", /\/1001_\d+$/, { body: { permalink_url: "https://www.facebook.com/Page/posts/555" } }),
          ];
    const f = fakeFetch(handlers);
    const publish = createPublisher({ fetch: f.fetch, sleep: async () => undefined, storage: publicStorage() });
    const result = await publish({ itemId: seeded.itemId, brandId: owner.brandId });
    return { result, calls: f.calls };
  }

  it("adds 'Image made with AI.' to the end of the Instagram caption", async () => {
    const { result, calls } = await publishWith(true, "instagram");
    expect(result).toMatchObject({ ok: true });
    expect(calls.find((c) => c.method === "POST" && c.path.endsWith("/media"))!.params.get("caption")).toBe("Fresh sourdough today.\n\n#bakery\n\nImage made with AI.");
  });

  it("adds it to the Facebook post too", async () => {
    const { result, calls } = await publishWith(true, "facebook");
    expect(result).toMatchObject({ ok: true });
    const sent = calls.filter((c) => c.method === "POST").map((c) => c.params.get("message") ?? c.params.get("caption") ?? "");
    expect(sent.some((m) => m.endsWith("\n\nImage made with AI."))).toBe(true);
  });

  it("adds nothing to a post without a realistic AI person", async () => {
    const ig = await publishWith(false, "instagram");
    expect(ig.calls.find((c) => c.method === "POST" && c.path.endsWith("/media"))!.params.get("caption")).toBe("Fresh sourdough today.\n\n#bakery");
    const fb = await publishWith(false, "facebook");
    const sent = fb.calls.filter((c) => c.method === "POST").map((c) => c.params.get("message") ?? "");
    expect(sent.join("|")).not.toContain("Image made with AI.");
  });
});

describe("the design remembers a realistic AI person", () => {
  it("a post drawn with one carries aiFace in its design; a drawn character or no face does not", async () => {
    const page = async (brief: Brief) => (await loadDesignPage(args(brief.id), deps())) as DesignPageData;

    const plain = await readyBrief(b, { channels: ["instagram"] });
    const outPlain = await chooseDesign({ ...args(plain.id), option: (await page(plain)).options[0].option }, deps());
    expect((outPlain.posts[0].design as StoredDesign).aiFace).toBeUndefined();

    const drawn = await makeApprovedFace(db, b, "illustrated", b.storage, "Dot");
    await setActiveFace({ userId: b.userId, brandId: b.brandId, faceId: drawn.id });
    const d = await readyBrief(b, { channels: ["instagram"] });
    const outDrawn = await chooseDesign({ ...args(d.id), option: (await page(d)).options[0].option }, deps());
    expect(outDrawn.blockers).toEqual([]);
    expect((outDrawn.posts[0].design as StoredDesign).aiFace).toBeUndefined();

    const real = await makeApprovedFace(db, b, "photoreal", b.storage, "Eva");
    await setActiveFace({ userId: b.userId, brandId: b.brandId, faceId: real.id });
    const r = await readyBrief(b, { channels: ["instagram", "youtube"] });
    const c = copy({ captions: [{ channel: "instagram", text: "20% off cakes" }, { channel: "youtube", text: "20% off cakes" }] });
    const outReal = await chooseDesign({ ...args(r.id), option: ((await loadDesignPage(args(r.id), deps(c))) as DesignPageData).options[0].option }, deps(c));
    expect(outReal.blockers).toEqual([]);
    for (const p of outReal.posts) expect((p.design as StoredDesign).aiFace).toBe(true);
  });

  it("is not set for a testimonial: a realistic AI person is never drawn on one", async () => {
    const brand = await loadCreateBrand(b.userId, b.brandId);
    expect(brand.face?.kind).toBe("photoreal");
    const brief: Brief = { ...(await readyBrief(b, { channels: ["instagram"] })), postType: "testimonial" };
    const assets = await loadDesignAssets({ userId: b.userId, brandId: b.brandId, brief, brand, storage: b.storage });
    expect(assets).toMatchObject({ face: null, faceOn: false });
  });
});

describe("a regulated business", () => {
  it("never gets a realistic AI person in its posts, whatever is saved", async () => {
    const clinic = await makeOwner(db, { name: "Green Clinic" });
    await db.withAdmin((tx) => tx.query("update public.brand_memory set regulated = 'health' where brand_id = $1", [clinic.brandId]));
    // A realistic AI person saved as the active face (before the business was marked regulated, say).
    const [face] = await db.withAdmin((tx) =>
      tx.query<{ id: string }>(
        "insert into public.brand_faces (brand_id, kind, name, description, style, status) values ($1, 'photoreal', 'Eva', 'A friendly person', 'photo', 'approved') returning id::text as id",
        [clinic.brandId],
      ),
    );
    await db.withAdmin((tx) => tx.query("update public.brand_memory set active_face_id = $2::uuid, face_in_posts = true where brand_id = $1", [clinic.brandId, face.id]));
    const brand = await loadCreateBrand(clinic.userId, clinic.brandId);
    expect(brand.face).toBeNull();
  });
});

describe("hand-shared text carries the AI line too (F-7)", () => {
  it("shareTextFor ends with the disclosure for a photoreal-face post, once, and not otherwise", async () => {
    const { shareTextFor } = await import("@/lib/create/view");
    const { AI_DISCLOSURE_LINE } = await import("@/lib/publish/caption");
    const base = { channel: "instagram", caption: "Fresh bread today.", cta: "Visit us", hashtags: ["#bread"], postCode: "abc1234" };
    const withAi = shareTextFor({ ...base, aiFace: true }, "https://example.com");
    expect(withAi.endsWith(AI_DISCLOSURE_LINE)).toBe(true);
    expect(withAi.split(AI_DISCLOSURE_LINE)).toHaveLength(2);
    expect(shareTextFor({ ...base, caption: `Fresh bread today.\n\n${AI_DISCLOSURE_LINE}`, aiFace: true }, "https://example.com").split(AI_DISCLOSURE_LINE)).toHaveLength(2);
    expect(shareTextFor(base, "https://example.com")).not.toContain(AI_DISCLOSURE_LINE);
  });
});
