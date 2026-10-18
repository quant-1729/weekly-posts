// CH-3: the character gallery on the Brand Face card, rendered to HTML (no DOM library here), and the previews that feed it.
// The rig is mocked: one test where it draws, one where it throws (the card must still render, with Tween standing in).
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rig = vi.hoisted(() => ({ fail: false, calls: 0 }));
vi.mock("@/lib/characters", async (orig) => ({
  ...(await orig<typeof import("@/lib/characters")>()),
  drawCharacter: (id: string, action: string) => {
    rig.calls++;
    if (rig.fail) throw new Error("not implemented");
    return { body: `<g data-drawn="${id}:${action}"/>`, anchors: {} };
  },
}));
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
  chooseMascotCharacterAction: vi.fn(),
  characterPosesAction: vi.fn(),
}));

import { FaceCard, type MascotProps } from "@/components/brand/face-card";
import { CHARACTER_IDS, CHARACTER_LABELS, type CharacterId } from "@/lib/characters/types";
import type { CardFace, FaceCardData } from "@/lib/faces/card-types";
import { characterGallery, characterPoses, clearCharacterPreviewCache, PREVIEW_POSES } from "@/lib/faces/character-preview";
import { DEFAULT_TWEEN_COLORS, tweenColorsFor } from "@/lib/mascot/colors";

const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
/** Working names must never be on screen. */
const WORKING = /\b(parchi|nudge|chitthi|dhaaga|nishaan|gaanth|dabba|disha|yaadu|mynu|tiko|laltain)\b/i;

const colors = tweenColorsFor({ primary: "#1f7a4d", accent: "#f2994a" });
const mascotFace = (o: Partial<CardFace> = {}): CardFace => ({
  id: "22222222-2222-4222-8222-222222222222",
  kind: "mascot",
  name: "Tween",
  description: null,
  style: null,
  character: "tween",
  status: "approved",
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
const data = (faces: CardFace[] = [], o: Partial<FaceCardData> = {}): FaceCardData => ({ regulated: "none", faces, activeFaceId: null, inPosts: false, cutoutConfigured: true, suggestions: { illustrated: [], photoreal: [] }, ...o });

function props(selected: CharacterId = "tween", name = "", o: Partial<MascotProps> = {}): MascotProps {
  return {
    reason: "ok",
    active: null,
    inPosts: true,
    colors,
    gallery: { items: characterGallery(colors), selected, name, poses: characterPoses(selected, colors) },
    ...o,
  };
}
const render = (d: FaceCardData, m: MascotProps) => renderToString(createElement(FaceCard, { brandId: "b", initial: d, mascot: m }));

beforeEach(() => {
  rig.fail = false;
  rig.calls = 0;
  clearCharacterPreviewCache();
});

describe("the character gallery on the Mascot kind", () => {
  it("shows a card for every offered character, Tween first, labelled by its object", () => {
    const html = render(data(), props());
    expect(html).toContain("data-character-picker");
    const ids = [...html.matchAll(/data-character="([a-z]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual([...CHARACTER_IDS]);
    expect(ids[0]).toBe("tween");
    expect(ids).not.toContain("laltain");
    const t = text(html);
    for (const id of CHARACTER_IDS) expect(t).toContain(CHARACTER_LABELS[id]);
  });

  it("never shows a working name, in the cards, the name field or the poses row", () => {
    for (const selected of CHARACTER_IDS) {
      const html = render(data([mascotFace({ character: selected, name: CHARACTER_LABELS[selected] })], { activeFaceId: "22222222-2222-4222-8222-222222222222", inPosts: true }), props(selected, ""));
      expect(text(html), selected).not.toMatch(WORKING);
      // The placeholder of the name field is the object name too.
      expect(html).toContain(`placeholder="${CHARACTER_LABELS[selected]}"`);
    }
  });

  it("marks the saved character as selected and shows the owner's own name", () => {
    const f = mascotFace({ character: "dabba", name: "Ruby" });
    const html = render(data([f], { activeFaceId: f.id, inPosts: true }), props("dabba", "Ruby", { active: { id: f.id, name: "Ruby" } }));
    expect(html).toMatch(/data-character="dabba" data-selected="true"/);
    expect((html.match(/data-selected="true"/g) ?? []).length).toBe(1);
    expect(html).toMatch(/<input[^>]*value="Ruby"/);
  });

  it("shows four poses of the selected character: wave, present, hold-sign and celebrate", () => {
    const html = render(data(), props("nudge"));
    for (const pose of ["wave", "present", "hold-sign", "celebrate"]) expect(html).toContain(`data-drawn="nudge:${pose}"`);
    const row = html.slice(html.indexOf("data-character-poses"));
    expect(text(row)).toMatch(/Waves.*Presents.*Holds a sign.*Celebrates/);
  });

  it("offers a save button that uses the character in posts", () => {
    expect(text(render(data(), props()))).toContain("Use this character in my posts");
  });

  it("is also shown on the summary of a brand whose active face is a mascot", () => {
    const f = mascotFace({ character: "yaadu", name: "Baby elephant" });
    const html = render(data([f], { activeFaceId: f.id, inPosts: true }), props("yaadu", "", { active: { id: f.id, name: f.name } }));
    expect(html).toContain('data-face-view="summary"');
    expect(html).toContain("data-character-picker");
    expect(html).toMatch(/data-character="yaadu" data-selected="true"/);
  });

  it("is not offered to a regulated business, which keeps the older notice", () => {
    const html = render(data(), props("tween", "", { reason: "regulated", inPosts: true }));
    expect(html).not.toContain("data-character-picker");
    expect(text(html)).toContain("A mascot is not offered for your kind of business.");
  });

  it("without a gallery the card is the older Tween card", () => {
    const html = render(data(), { reason: "ok", active: null, inPosts: true, colors });
    expect(html).not.toContain("data-character-picker");
  });
});

describe("previews when the rig cannot draw", () => {
  it("falls back to Tween's drawing in every card, and the card still renders", () => {
    rig.fail = true;
    const html = render(data(), props());
    expect(rig.calls).toBeGreaterThan(0);
    expect(html).toContain("data-character-picker");
    expect([...html.matchAll(/data-preview="fallback"/g)].length).toBe(CHARACTER_IDS.length);
    expect(html).not.toContain("data-drawn");
    expect(html).toContain("<svg");
    // The stand-in carries no "Tween: wave" title that would be read out under another character's name.
    expect(html).not.toMatch(/<title>Tween/);
  });

  it("every pose of a failing character still has a drawing", () => {
    rig.fail = true;
    const poses = characterPoses("baton", colors);
    expect(poses.map((p) => p.action)).toEqual([...PREVIEW_POSES]);
    for (const p of poses) expect(p.svg).toContain("<svg");
  });
});

describe("preview drawing", () => {
  it("draws in the brand colours and caches per colours", () => {
    const first = characterGallery(colors);
    const callsAfterFirst = rig.calls;
    expect(callsAfterFirst).toBe(CHARACTER_IDS.length);
    expect(first.every((c) => !c.fallback && c.svg.includes("<svg") && c.svg.includes("data-drawn"))).toBe(true);
    characterGallery(colors); // same colours: nothing is drawn again
    expect(rig.calls).toBe(callsAfterFirst);
    characterGallery(DEFAULT_TWEEN_COLORS); // other colours: drawn again
    expect(rig.calls).toBe(callsAfterFirst + CHARACTER_IDS.length);
  });

  it("does not cache a failure, so the real drawing shows once the rig works", () => {
    rig.fail = true;
    expect(characterGallery(colors).every((c) => c.fallback)).toBe(true);
    rig.fail = false;
    expect(characterGallery(colors).every((c) => !c.fallback)).toBe(true);
  });
});
