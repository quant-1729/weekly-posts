import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock("@/components/uploads/actions", () => ({
  removePhotoAction: vi.fn(),
  setHasPeopleAction: vi.fn(),
  addPastPostTextAction: vi.fn(),
  updatePastPostTextAction: vi.fn(),
  removePastPostAction: vi.fn(),
  addWordToAvoidAction: vi.fn(),
  dismissAvoidSuggestionAction: vi.fn(),
  updateVoiceAction: vi.fn(),
  refreshVoiceNowAction: vi.fn(),
}));

import { PastPosts } from "@/components/uploads/past-posts";
import { PhotoLibrary } from "@/components/uploads/photo-library";
import { VoiceCard } from "@/components/uploads/voice-card";
import { s } from "@/lib/i18n/strings";

const BRAND = "11111111-1111-4111-8111-111111111111";
const photo = (id: string, hasPeople: boolean | null, usable: boolean | null = true) => ({
  id,
  storagePath: `photos/${BRAND}/${id}.jpg`,
  url: `/api/files/photos/${BRAND}/${id}.jpg`,
  description: id === "a" ? "Loaves on a wooden board." : null,
  hasPeople,
  usable,
  width: 100,
  height: 100,
  createdAt: "2026-10-13T00:00:00.000Z",
});

describe("upload components", () => {
  it("PhotoLibrary shows descriptions and the consent note only for photos with people", () => {
    const html = renderToString(
      createElement(PhotoLibrary, { brandId: BRAND, initialPhotos: [photo("a", false), photo("b", true)] }),
    );
    expect(html).toContain("Loaves on a wooden board.");
    expect(html).toContain(s.uploads.photos.noDescription);
    expect(html.split(s.uploads.photos.peopleNote).length - 1).toBe(1);
    expect(html).toContain(s.uploads.photos.add);
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
  });

  it("PastPosts offers paste and screenshot, and lists the posts", () => {
    const html = renderToString(
      createElement(PastPosts, {
        brandId: BRAND,
        initialPosts: [{ id: "p1", text: "Fresh bread today", storagePath: null, imageUrl: null, createdAt: "2026-10-13T00:00:00.000Z" }],
      }),
    );
    expect(html).toContain(s.uploads.pastPosts.pasteText);
    expect(html).toContain(s.uploads.pastPosts.uploadScreenshot);
    expect(html).toContain("Fresh bread today");
  });

  it("VoiceCard shows the description, phrase chips and one add button per suggestion", () => {
    const html = renderToString(
      createElement(VoiceCard, {
        brandId: BRAND,
        hasPastPosts: true,
        voice: {
          voiceDescription: "Warm and chatty.",
          examplePhrases: ["say hello", "kettle is on"],
          wordsToAvoid: ["cheap"],
          avoidSuggestions: ["corporate jargon", "!!!"],
          refreshing: false,
        },
      }),
    );
    expect(html).toContain("Warm and chatty.");
    expect(html).toContain("say hello");
    expect(html).toContain("kettle is on");
    expect(html).toContain("cheap");
    expect(html.split(s.uploads.voice.addToAvoid).length - 1).toBe(2);
  });
});
