// The Brand face card (F-4, F-6, F-7), rendered to HTML with react-dom/server for each state (no DOM library here).
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock("@/app/(app)/brand/actions", () => ({ setMascotInPostsAction: vi.fn() }));
vi.mock("@/app/(app)/brand/face-actions", () => ({
  loadFaceCardAction: vi.fn(),
  createFaceAction: vi.fn(),
  retireFaceAction: vi.fn(),
  makeFaceOptionsAction: vi.fn(),
  pickFaceOptionAction: vi.fn(),
  makeFaceSheetAction: vi.fn(),
  approveFaceSheetAction: vi.fn(),
  makeFacePosesAction: vi.fn(),
  approvePoseAction: vi.fn(),
  adoptFaceAction: vi.fn(),
  requestFaceConsentAction: vi.fn(),
  setFaceInPostsAction: vi.fn(),
  updateFaceSettingsAction: vi.fn(),
}));

import { FaceCard, type MascotProps } from "@/components/brand/face-card";
import { posesPrice } from "@/components/brand/face-make";
import type { CardFace, CardPose, FaceCardData } from "@/lib/faces/card-types";
import { FACE_CAP_USD, stepEstimateUsd, wholeFaceEstimateUsd } from "@/lib/faces/generate/estimate";
import { FACE_OPTIONS, FACE_POSES, TRIES_PER_POSE, type FaceKind } from "@/lib/faces/types";
import { s } from "@/lib/i18n/strings";

const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const money = (n: number) => `$${n.toFixed(2)}`;

const mascot: MascotProps = { reason: "ok", active: null, inPosts: false };

const pose = (p: (typeof FACE_POSES)[number], o: Partial<CardPose> = {}): CardPose => ({ pose: p, url: `/api/files/mascots/b/faces/f/${p}.png`, approved: false, passed: true, notes: "", ...o });
const face = (o: Partial<CardFace> = {}): CardFace => ({
  id: "11111111-1111-4111-8111-111111111111",
  kind: "illustrated",
  name: "Mia",
  description: "A baker",
  style: "flat",
  character: null,
  status: "draft",
  neverSay: [],
  postTypes: null,
  placement: {},
  spentUsd: 0,
  consent: null,
  poses: [],
  optionUrls: [null, null, null, null],
  masterUrl: null,
  sheetDraftUrl: null,
  sheetUrl: null,
  ...o,
});
const data = (faces: CardFace[] = [], o: Partial<FaceCardData> = {}): FaceCardData => ({ regulated: "none", faces, activeFaceId: null, inPosts: false, cutoutConfigured: true, ...o });
const render = (d: FaceCardData, m: MascotProps = mascot) => renderToString(createElement(FaceCard, { brandId: "b", initial: d, mascot: m }));

const options = ["/o/0.png", "/o/1.png", "/o/2.png", "/o/3.png"];
const allPoses = (o: Partial<CardPose> = {}) => FACE_POSES.map((p) => pose(p, o));

describe("step 1: choose a kind", () => {
  it("shows the four kinds as radio cards, each enabled for an ordinary business", () => {
    const html = render(data());
    expect(html).toContain('data-face-view="choose"');
    for (const k of ["mascot", "illustrated", "owner_photo", "photoreal"] as FaceKind[]) {
      expect(html).toContain(`data-face-kind="${k}"`);
      expect(text(html)).toContain(s.faces.kinds[k].label);
    }
    expect(html).not.toContain('data-disabled="true"');
    expect(text(html)).toContain(s.faces.card.intro);
  });

  it("shows a realistic AI person disabled, with one line why, for a health, finance, legal or alcohol business", () => {
    for (const regulated of ["health", "finance", "legal", "alcohol"]) {
      const html = render(data([], { regulated }));
      const card = /<label[^>]*data-face-kind="photoreal"[\s\S]*?<\/label>/.exec(html)![0];
      expect(card).toContain('data-disabled="true"');
      expect(card).toMatch(/<input[^>]*disabled/);
      expect(text(card)).toContain("Not available for health, finance, legal or alcohol businesses.");
      // The other kinds stay available.
      expect(/<label[^>]*data-face-kind="illustrated"[\s\S]*?<\/label>/.exec(html)![0]).not.toContain("data-disabled");
    }
  });

  it("shows the mascot disabled for a regulated business that has none", () => {
    const html = render(data(), { reason: "regulated", active: null, inPosts: false });
    const card = /<label[^>]*data-face-kind="mascot"[\s\S]*?<\/label>/.exec(html)![0];
    expect(card).toContain('data-disabled="true"');
    expect(text(card)).toContain(s.faces.card.notAllowed.mascot);
  });

  it("keeps the Tween card (preview, switch for posts, link to the mascot page) when the mascot is the active face", () => {
    const mascotFace = face({ id: "22222222-2222-4222-8222-222222222222", kind: "mascot", name: "Tween", status: "approved" });
    const html = render(data([mascotFace], { activeFaceId: mascotFace.id, inPosts: true }), { reason: "ok", active: { id: "m", name: "Tween" }, inPosts: true });
    expect(html).toContain('data-face-view="summary"');
    expect(html).toContain('href="/mascot"');
    expect(text(html)).toContain(s.mascot.brandCard.useInPosts);
    expect(html).toContain("<svg"); // Tween's preview
    expect(text(html)).toContain(s.faces.card.active.change);
  });

  it("opens on the mascot card for a brand that switched Tween on before faces existed", () => {
    const html = render(data(), { reason: "ok", active: { id: "m", name: "Tween" }, inPosts: true });
    expect(html).toContain('data-face-view="choose"');
    expect(text(html)).toContain(s.mascot.brandCard.useInPosts);
  });
});

describe("step 3: the price comes first", () => {
  it("shows the whole-face estimate from estimate.ts and says nothing is charged until Make options is pressed", () => {
    const html = text(render(data([face()])));
    const images = FACE_OPTIONS + 1 + FACE_POSES.length * TRIES_PER_POSE;
    expect(html).toContain(`Making this face costs about ${money(wholeFaceEstimateUsd())} (${images} images). Nothing is charged until you press Make options.`);
    // The button carries the exact price of the step it starts.
    expect(html).toContain(`Make options (about ${money(stepEstimateUsd("options"))})`);
    // The price of each later step is on the page too.
    expect(html).toContain(money(stepEstimateUsd("sheet")));
    expect(html).toContain(money(posesPrice(FACE_POSES.length)));
    // Spend so far against the cap.
    expect(html).toContain(`Spent on this face so far: $0.00 of the ${money(FACE_CAP_USD)} limit.`);
    expect(FACE_CAP_USD).toBe(2);
  });

  it("the three step prices add up to the whole-face price", () => {
    const sum = stepEstimateUsd("options") + stepEstimateUsd("sheet") + posesPrice(FACE_POSES.length);
    expect(Math.abs(sum - wholeFaceEstimateUsd())).toBeLessThan(0.021);
  });

  it("disables the button when the face is at its limit and says why", () => {
    const html = render(data([face({ spentUsd: 1.9 })]));
    expect(text(html)).toContain("Spent on this face so far: $1.90");
    const button = /<button[^>]*>Make options/.exec(html)![0];
    expect(button).toContain("disabled");
    expect(text(html)).toContain(s.faces.generate.errors.over_cap);
  });
});

describe("steps 4: options, sheet, poses", () => {
  it("shows the four options with 'Use this one', and the price of asking again", () => {
    const html = text(render(data([face({ optionUrls: options, spentUsd: 0.27 })])));
    expect(html).toContain(s.faces.card.options.title);
    expect(html.match(/Use this one/g)).toHaveLength(4);
    expect(html).toContain(`Make new options (about ${money(stepEstimateUsd("options"))})`);
    expect(html).toContain("Spent on this face so far: $0.27");
  });

  it("after a look is picked, offers the character sheet with its price, then Approve once it is made", () => {
    const picked = face({ masterUrl: "/m.png", optionUrls: options, spentUsd: 0.27 });
    const before = text(render(data([picked])));
    expect(before).toContain(`Make the character sheet (about ${money(stepEstimateUsd("sheet"))})`);
    expect(before).not.toContain("This looks right");
    const after = text(render(data([{ ...picked, sheetDraftUrl: "/s.png" }])));
    expect(after).toContain("This looks right");
    expect(after).toContain(`Make it again (about ${money(stepEstimateUsd("sheet"))})`);
  });

  it("with the sheet approved, offers the seven poses with the exact price", () => {
    const html = text(render(data([face({ masterUrl: "/m.png", sheetUrl: "/s.png", spentUsd: 0.34 })])));
    expect(html).toContain(`Make the seven poses (about ${money(posesPrice(7))})`);
    expect(html).not.toContain("Use this face");
  });

  it("shows each made pose with Approve and a priced Make again, and no Use this face until all seven are approved", () => {
    const poses = FACE_POSES.map((p, i) => pose(p, i < 3 ? { approved: true } : i === 3 ? { passed: false, notes: "Two left hands" } : {}));
    const html = render(data([face({ masterUrl: "/m.png", sheetUrl: "/s.png", poses, spentUsd: 1.3 })]));
    const t = text(html);
    expect(t).toContain("3 of 7 approved");
    expect(t.match(/Approved/g)).toHaveLength(3);
    expect(html.match(/>Approve</g)).toHaveLength(4);
    expect(t).toContain("Check: Two left hands");
    expect(t.match(new RegExp(`Make again \\(about ${money(stepEstimateUsd("poses", 1)).replace("$", "\\$")}\\)`, "g"))).toHaveLength(7);
    expect(t).not.toContain("Use this face");
  });

  it("a pose that was not made yet is listed and can be made for its price", () => {
    const poses = allPoses({ approved: true }).slice(0, 5);
    const t = text(render(data([face({ masterUrl: "/m.png", sheetUrl: "/s.png", poses })])));
    expect(t).toContain(`Make the missing poses (about ${money(posesPrice(2))})`);
  });

  it("with all seven approved offers Use this face", () => {
    const t = text(render(data([face({ masterUrl: "/m.png", sheetUrl: "/s.png", poses: allPoses({ approved: true }) })])));
    expect(t).toContain("7 of 7 approved");
    expect(t).toContain("Use this face");
  });
});

describe("the active face", () => {
  const active = (o: Partial<CardFace> = {}) => face({ status: "approved", poses: allPoses({ approved: true }), ...o });
  it("shows its name, kind, the seven poses, the switch for posts, post types, size and Retire", () => {
    const f = active({ placement: { size: "large" }, postTypes: ["offer", "event"] });
    const html = render(data([f], { activeFaceId: f.id, inPosts: true }));
    const t = text(html);
    expect(html).toContain('data-face-view="summary"');
    expect(t).toContain("Mia");
    expect(t).toContain(s.faces.kinds.illustrated.label);
    expect(html.match(/<img /g)).toHaveLength(7);
    expect(t).toContain(s.faces.card.active.inPosts);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
    expect(t).toContain(s.create.type.options.offer.label);
    const chips = [...html.matchAll(/<label class="([^"]*)"><input type="checkbox" class="sr-only" ([^>]*)>([^<]*)<\/label>/g)];
    const on = chips.filter((c) => /checked/.test(c[2])).map((c) => c[3]);
    expect(on.sort()).toEqual([s.create.type.options.event.label, s.create.type.options.offer.label].sort());
    expect(html).toMatch(/<option value="large" selected/);
    expect(t).toContain(s.faces.card.active.retire);
    expect(html).not.toContain("data-ai-note");
  });

  it("with the switch off shows the box unticked", () => {
    const f = active();
    const html = render(data([f], { activeFaceId: f.id, inPosts: false }));
    expect(/<input[^>]*type="checkbox"[^>]*checked/.test(html.split("Show in my posts")[0].split("<label").at(-1)!)).toBe(false);
  });
});

describe("a realistic AI person (F-7)", () => {
  it("always shows the AI label note while it is made and once it is the active face", () => {
    const note = s.faces.card.aiNote;
    expect(note).toContain("Posts with this face show a small AI label");
    expect(note).toContain("AI info");
    const making = render(data([face({ kind: "photoreal", style: "photo" })]));
    expect(making).toContain("data-ai-note");
    expect(text(making)).toContain(note);
    const f = face({ kind: "photoreal", style: "photo", status: "approved", poses: allPoses({ approved: true }) });
    const done = render(data([f], { activeFaceId: f.id, inPosts: true }));
    expect(text(done)).toContain(note);
  });

  it("never offers review (testimonial) posts for it", () => {
    const f = face({ kind: "photoreal", style: "photo", status: "approved", poses: allPoses({ approved: true }) });
    const html = render(data([f], { activeFaceId: f.id, inPosts: true }));
    const chips = [...html.matchAll(/<label class="([^"]*)"><input type="checkbox" class="sr-only" ([^>]*)>([^<]*)<\/label>/g)];
    const review = chips.find((c) => c[3] === s.create.type.options.testimonial.label)!;
    expect(review[2]).toContain("disabled");
    expect(review[2]).not.toContain("checked");
  });
});

describe("the owner's own photos (F-6)", () => {
  const mine = (o: Partial<CardFace> = {}) => face({ kind: "owner_photo", name: "Asha", description: null, style: null, ...o });

  it("starts with the consent: the exact wording, a checkbox and the email button, and no photo picker yet", () => {
    const html = render(data([mine({ consent: null })]));
    const t = text(html);
    expect(t).toContain("These are photos of me and I agree to appear in my posts");
    expect(t).toContain("Send the confirmation email");
    expect(t).not.toContain(s.faces.card.owner.photosTitle);
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain("data-price-block"); // no AI price block for this kind
    expect(t).not.toContain("Nothing is charged until you press Make options");
    // The button waits for the box.
    expect(/<button[^>]*disabled=""[^>]*>Send the confirmation email/.test(html)).toBe(true);
  });

  it("after the email is sent says it is waiting, and offers to send it again", () => {
    const t = text(render(data([mine({ consent: { asked: true, confirmed: false, expired: false } })])));
    expect(t).toContain(s.faces.card.owner.waiting);
    expect(t).toContain(s.faces.card.owner.resend);
    expect(t).not.toContain(s.faces.card.owner.photosTitle);
  });

  it("once confirmed shows the photo pickers when background removal is set up", () => {
    const html = render(data([mine({ consent: { asked: true, confirmed: true, expired: false } })], { cutoutConfigured: true }));
    expect(text(html)).toContain(s.faces.card.owner.confirmed);
    expect(text(html)).toContain(s.faces.card.owner.photosTitle);
    expect(html.match(/type="file"/g)!.length).toBe(FACE_POSES.length + 1); // one per pose and one for every empty pose
    expect(html).not.toContain("data-cutout-missing");
    expect(html.match(/type="file"[^>]*disabled/g) ?? []).toHaveLength(0);
  });

  it("when the cut-out service is not set up says so, disables the pickers, and the card stays usable", () => {
    const html = render(data([mine({ consent: { asked: true, confirmed: true, expired: false } })], { cutoutConfigured: false }));
    expect(html).toContain("data-cutout-missing");
    expect(text(html)).toContain("Background removal isn't set up yet.");
    expect(html.match(/type="file"[^>]*disabled/g)!.length).toBe(FACE_POSES.length + 1);
    expect(text(html)).toContain(s.faces.card.startOver); // still can leave
  });

  it("with the photos cut out shows Approve per pose, and Use this face when all are approved", () => {
    const consent = { asked: true, confirmed: true, expired: false };
    const some = text(render(data([mine({ consent, poses: allPoses().slice(0, 3) })])));
    expect(some).toContain("0 of 7 approved");
    expect(some).toContain(s.faces.card.owner.replace);
    expect(some).toContain(s.faces.card.owner.chooseFor);
    const all = text(render(data([mine({ consent, poses: allPoses({ approved: true }) })])));
    expect(all).toContain("Use this face");
  });

  it("never shows a price or the AI note for the owner's own face", () => {
    const t = text(render(data([mine({ consent: { asked: true, confirmed: true, expired: false } })])));
    expect(t).not.toContain("AI label");
    expect(t).not.toMatch(/about \$\d/);
  });
});

describe("an unfinished face", () => {
  it("is kept: the card opens on it with Start over, and no kind chooser", () => {
    const html = render(data([face()]));
    expect(html).toContain('data-face-view="work"');
    expect(html).not.toContain('name="face-kind"');
    expect(text(html)).toContain(s.faces.card.startOver);
    expect(text(html)).toContain("Mia");
  });
});
