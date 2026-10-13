import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import sharp from "sharp";

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

import { PhotoLibrary } from "@/components/uploads/photo-library";
import { VoiceCard } from "@/components/uploads/voice-card";
import { BrandAccessError } from "@/lib/brand/current";
import type { MockDb } from "@/lib/db/mock";
import { s } from "@/lib/i18n/strings";
import { createMockStorage } from "@/lib/storage/mock";
import type { Storage } from "@/lib/storage/types";
import { describeUploadError } from "@/lib/uploads/errors";
import { addPastPostScreenshot, addPastPostText, listPastPosts } from "@/lib/uploads/past-posts";
import { addPhoto, listPhotos } from "@/lib/uploads/photos";
import { addWordToAvoid, dismissAvoidSuggestion, getVoice, mergePhrases, refreshVoice, updateVoice } from "@/lib/uploads/voice";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";

let db: MockDb;
let root: string;
let storage: Storage;
let owner: string;
let outsider: string;
let brand: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "pm-memory-"));
  storage = createMockStorage(root);
  db = await openTestDb();
  owner = (await createUser(db)).id;
  outsider = (await createUser(db)).id;
  brand = await createBrandFor(db, owner, "Corner Bakery");
});
afterAll(async () => {
  await closeTestDb(db);
  await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
  await db.withAdmin(async (tx) => {
    await tx.query("delete from public.photos where brand_id = $1", [brand]);
    await tx.query(
      `update public.brand_memory set voice_description = null, example_phrases = '{}', words_to_avoid = '{}',
              avoid_suggestions = '{}', voice_edited_at = null where brand_id = $1`,
      [brand],
    );
  });
});

const jpeg = (w = 200, h = 100) => sharp({ create: { width: w, height: h, channels: 3, background: "#cc3333" } }).jpeg().toBuffer();

const voiceOf = (o: Partial<{ voice_description: string; example_phrases: string[]; avoid_suggestions: string[] }>) => () => ({
  voice_description: "Warm and chatty.",
  example_phrases: [] as string[],
  avoid_suggestions: [] as string[],
  emoji_use: "light" as const,
  typical_length: "short" as const,
  ...o,
});

const POSTS = [
  "Fresh out of the oven! Come in and say hello, the kettle is always on.",
  "Thank you for a lovely week. See you Saturday for cardamom buns!",
];
async function seedPosts(posts = POSTS) {
  for (const text of posts) await addPastPostText({ userId: owner, brandId: brand, text });
}
const refresh = (fixture: ReturnType<typeof voiceOf>) => refreshVoice({ userId: owner, brandId: brand, debounceMs: 0, fixture });
const stored = async () =>
  (
    await db.withAdmin((tx) =>
      tx.query<{ voice_description: string | null; example_phrases: string[]; words_to_avoid: string[]; avoid_suggestions: string[]; edited: boolean }>(
        "select voice_description, example_phrases, words_to_avoid, avoid_suggestions, (voice_edited_at is not null) as edited from public.brand_memory where brand_id = $1",
        [brand],
      ),
    )
  )[0];

describe("voice: the owner's edits stick", () => {
  it("a refresh sets the description and phrases while the owner has not edited", async () => {
    await seedPosts();
    await refresh(voiceOf({ voice_description: "First read.", example_phrases: ["say hello"] }));
    expect(await stored()).toMatchObject({ voice_description: "First read.", example_phrases: ["say hello"], edited: false });
    await refresh(voiceOf({ voice_description: "Second read.", example_phrases: ["the kettle is always on"] }));
    // not edited by the owner: replaced
    expect(await stored()).toMatchObject({ voice_description: "Second read.", example_phrases: ["the kettle is always on"] });
  });

  it("editing the description sets voice_edited_at, and a refresh does not overwrite it", async () => {
    await seedPosts();
    await refresh(voiceOf({ voice_description: "Model's words." }));
    await updateVoice({ userId: owner, brandId: brand, edit: { voiceDescription: "Dry and to the point." } });
    expect((await stored()).edited).toBe(true);

    const r = await refresh(voiceOf({ voice_description: "A brand new model description." }));
    expect(r.status === "updated" && r.voiceDescription).toBe("Dry and to the point.");
    expect((await stored()).voice_description).toBe("Dry and to the point.");
    expect((await getVoice(owner, brand)).voiceDescription).toBe("Dry and to the point.");
  });

  it("merges phrases after an owner edit: the owner's stay, new verified ones are added, up to 10", async () => {
    await seedPosts();
    await updateVoice({ userId: owner, brandId: brand, edit: { examplePhrases: ["my own phrase", "another of mine"] } });
    expect((await stored()).edited).toBe(true);

    await refresh(
      voiceOf({
        example_phrases: [
          "say hello", // verbatim in a past post: added
          "my own phrase", // already there: not doubled
          "SEE YOU SATURDAY", // verbatim, different case: added
          "invented by the model", // not in any post: dropped
        ],
      }),
    );
    expect((await stored()).example_phrases).toEqual(["my own phrase", "another of mine", "say hello", "SEE YOU SATURDAY"]);

    // never removes the owner's, and never goes past 10
    expect(mergePhrases(["a", "b"], ["c", "d"])).toEqual(["a", "b", "c", "d"]);
    const ten = Array.from({ length: 10 }, (_, i) => `owner phrase ${i}`);
    expect(mergePhrases(ten, ["new one"])).toEqual(ten);
    expect(mergePhrases(["owner"], Array.from({ length: 20 }, (_, i) => `new ${i}`))).toHaveLength(10);
  });

  it("editing only words to avoid does not count as editing the voice", async () => {
    await seedPosts();
    await updateVoice({ userId: owner, brandId: brand, edit: { wordsToAvoid: ["cheap"] } });
    expect((await stored()).edited).toBe(false);
    await refresh(voiceOf({ voice_description: "Replaced." }));
    expect((await stored()).voice_description).toBe("Replaced.");
  });

  it("an edit made while the model was thinking is not lost", async () => {
    await seedPosts();
    let saving: Promise<void> = Promise.resolve();
    const r = await refreshVoice({
      userId: owner,
      brandId: brand,
      debounceMs: 0,
      fixture: () => {
        // The owner saves their wording at the very moment the model answers.
        saving = updateVoice({ userId: owner, brandId: brand, edit: { voiceDescription: "Written during the read." } });
        return voiceOf({ voice_description: "Model words." })();
      },
    });
    expect(r.status).toBe("updated");
    await saving;
    // whichever write came first, the owner's words are what is saved
    expect(await stored()).toMatchObject({ voice_description: "Written during the read.", edited: true });
  });
});

describe("voice: avoid suggestions are stored, then accepted or dismissed", () => {
  it("stores the model's suggestions (minus listed words) in brand_memory.avoid_suggestions", async () => {
    await seedPosts();
    await updateVoice({ userId: owner, brandId: brand, edit: { wordsToAvoid: ["cheap"] } });
    await refresh(voiceOf({ avoid_suggestions: ["corporate jargon", "!!!", "Cheap"] }));
    expect((await stored()).avoid_suggestions).toEqual(["corporate jargon", "!!!"]);
    // they come back from the database, not from this process's memory
    expect((await getVoice(owner, brand)).avoidSuggestions).toEqual(["corporate jargon", "!!!"]);
    expect((await stored()).words_to_avoid).toEqual(["cheap"]);
  });

  it("suggestions always update, even after the owner edited the voice", async () => {
    await seedPosts();
    await updateVoice({ userId: owner, brandId: brand, edit: { voiceDescription: "Mine." } });
    await refresh(voiceOf({ avoid_suggestions: ["old idea"] }));
    await refresh(voiceOf({ avoid_suggestions: ["new idea"] }));
    expect((await stored()).avoid_suggestions).toEqual(["new idea"]);
  });

  it("Add moves a suggestion into words_to_avoid; Dismiss only removes it", async () => {
    await seedPosts();
    await refresh(voiceOf({ avoid_suggestions: ["corporate jargon", "!!!", "synergy"] }));

    expect(await addWordToAvoid({ userId: owner, brandId: brand, word: "corporate jargon" })).toEqual(["corporate jargon"]);
    expect(await stored()).toMatchObject({ words_to_avoid: ["corporate jargon"], avoid_suggestions: ["!!!", "synergy"] });

    expect(await dismissAvoidSuggestion({ userId: owner, brandId: brand, word: "!!!" })).toEqual(["synergy"]);
    expect(await stored()).toMatchObject({ words_to_avoid: ["corporate jargon"], avoid_suggestions: ["synergy"] });
    expect((await getVoice(owner, brand)).wordsToAvoid).toEqual(["corporate jargon"]);
  });

  it("the card shows Add and Dismiss for each suggestion, and an input for new words and phrases", () => {
    const html = renderToString(
      createElement(VoiceCard, {
        brandId: brand,
        hasPastPosts: true,
        voice: { voiceDescription: "Warm.", examplePhrases: ["say hello"], wordsToAvoid: ["cheap"], avoidSuggestions: ["corporate jargon", "!!!"], refreshing: false },
      }),
    );
    expect(html.split(s.uploads.voice.addToAvoid).length - 1).toBe(2);
    expect(html.split(s.brandV2.voice.dismiss).length - 1).toBe(2);
    expect(html).toContain(s.brandV2.voice.addWordLabel);
    expect(html).toContain(s.brandV2.voice.addPhraseLabel);
    expect(html).toContain(s.uploads.voice.refresh); // "Update from my posts" stays
  });

  it("is members only", async () => {
    await expect(dismissAvoidSuggestion({ userId: outsider, brandId: brand, word: "x" })).rejects.toBeInstanceOf(BrandAccessError);
    await expect(addWordToAvoid({ userId: outsider, brandId: brand, word: "x" })).rejects.toBeInstanceOf(BrandAccessError);
    await expect(updateVoice({ userId: outsider, brandId: brand, edit: { voiceDescription: "x" } })).rejects.toBeInstanceOf(BrandAccessError);
  });
});

describe("photos.usable is stored", () => {
  it("persists usable = false and shows the warning on the tile later, not only after upload", async () => {
    const bad = await addPhoto({
      userId: owner,
      brandId: brand,
      bytes: await jpeg(),
      mimeType: "image/jpeg",
      storage,
      fixture: { description: "A dark blur.", has_people: false, usable: false },
    });
    const good = await addPhoto({
      userId: owner,
      brandId: brand,
      bytes: await jpeg(),
      mimeType: "image/jpeg",
      storage,
      fixture: { description: "Loaves on a board.", has_people: false, usable: true },
    });
    expect(bad.warning).toBe(s.uploads.photos.lowQuality);

    const [row] = await db.withAdmin((tx) => tx.query<{ id: string; usable: boolean | null }>("select id, usable from public.photos where id = $1", [bad.photo.id]));
    expect(row.usable).toBe(false);

    // a fresh read of the library (a later visit) still knows
    const listed = await listPhotos(owner, brand);
    expect(listed.find((p) => p.id === bad.photo.id)!.usable).toBe(false);
    expect(listed.find((p) => p.id === good.photo.id)!.usable).toBe(true);

    const html = renderToString(createElement(PhotoLibrary, { brandId: brand, initialPhotos: listed }));
    expect(html.split(s.uploads.photos.lowQuality).length - 1).toBe(1);
  });

  it("leaves usable empty when the description step failed, and shows no warning", async () => {
    const r = await addPhoto({
      userId: owner,
      brandId: brand,
      bytes: await jpeg(),
      mimeType: "image/jpeg",
      storage,
      fixture: () => {
        throw new Error("model is down");
      },
    });
    expect(r.photo.usable).toBeNull();
    const html = renderToString(createElement(PhotoLibrary, { brandId: brand, initialPhotos: [r.photo] }));
    expect(html).not.toContain(s.uploads.photos.lowQuality);
  });
});

describe("screenshot text minimum is 10 characters, like pasted text", () => {
  const shot = (text: string, is_post = true) =>
    jpeg(300, 300).then((bytes) =>
      addPastPostScreenshot({ userId: owner, brandId: brand, bytes, mimeType: "image/jpeg", storage, fixture: { is_post, text } }).catch((e) => e),
    );

  it("rejects 9 characters with the same message as a pasted post, and keeps nothing", async () => {
    const pasted = await addPastPostText({ userId: owner, brandId: brand, text: "123456789" }).catch((e) => e);
    const screenshot = await shot("123456789");
    expect(screenshot.code).toBe("text_too_short");
    expect(describeUploadError(screenshot).message).toBe(describeUploadError(pasted).message);
    expect(describeUploadError(screenshot).message).toBe("That is too short. Paste at least 10 characters.");
    expect(await listPastPosts(owner, brand)).toHaveLength(0);
  });

  it("counts the trimmed text: spaces do not help", async () => {
    expect((await shot("   short   ")).code).toBe("text_too_short");
  });

  it("accepts exactly 10 characters", async () => {
    const post = await shot("1234567890");
    expect(post.text).toBe("1234567890");
    expect(await listPastPosts(owner, brand)).toHaveLength(1);
  });

  it("still says 'not a post' for an empty reading or a non-post", async () => {
    expect((await shot("   ")).code).toBe("not_a_post");
    expect((await shot("Invoice 4411 total", false)).code).toBe("not_a_post");
  });
});
