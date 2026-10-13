import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Wrap the AI client so tests can see whether it was called. Under vitest AI is
// always in fixture mode: nothing here reaches the network.
const spies = vi.hoisted(() => ({ generateJson: vi.fn(), generateText: vi.fn() }));
vi.mock("@/lib/ai/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ai/client")>();
  spies.generateJson.mockImplementation(real.generateJson);
  spies.generateText.mockImplementation(real.generateText);
  return { ...real, generateJson: spies.generateJson, generateText: spies.generateText };
});

import { aiMode } from "@/lib/ai/client";
import { SETUP_QUESTIONS } from "@/lib/ai/prompts/setup";
import { encodeWav } from "@/lib/audio/wav";
import { BrandAccessError } from "@/lib/brand/current";
import { describeError } from "@/lib/brand/errors";
import { answersToTranscript, draftFromExtract, hasAnyAnswer, matchUnclear } from "@/lib/brand/extract";
import { SETUP_EXTRACT_FIXTURE, SETUP_TRANSCRIPT_FIXTURE } from "@/lib/brand/fixtures";
import { getBrandProfile, saveBrandProfile } from "@/lib/brand/profile";
import { SetupError, extractSetupProfile, transcribeSetupAudio } from "@/lib/brand/setup";
import type { MockDb } from "@/lib/db/mock";
import { s } from "@/lib/i18n/strings";
import { createMockStorage } from "@/lib/storage/mock";
import type { Storage } from "@/lib/storage/types";
import { DailyCapError } from "@/lib/usage";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "./helpers";

let db: MockDb;
let root: string;
let storage: Storage;
let owner: string;
let outsider: string;
let brandId: string;

const usageCount = (id: string) =>
  db
    .withAdmin((tx) => tx.query<{ kind: string }>("select kind::text from public.usage_events where brand_id = $1 order by id", [id]))
    .then((r) => r.map((x) => x.kind));

const wav = (seconds = 2) => encodeWav(new Int16Array(16000 * seconds));

beforeAll(async () => {
  expect(aiMode()).toBe("fixture");
  db = await openTestDb();
  root = await mkdtemp(path.join(os.tmpdir(), "pm-setup-"));
  storage = createMockStorage(root);
  owner = (await createUser(db)).id;
  outsider = (await createUser(db)).id;
  brandId = await createBrandFor(db, owner);
});
afterAll(async () => {
  await closeTestDb(db);
  await rm(root, { recursive: true, force: true });
});
beforeEach(() => {
  spies.generateJson.mockClear();
  spies.generateText.mockClear();
});

describe("extraction maps to brand memory (R2: a Hindi voice note gives a profile to review)", () => {
  it("turns a Hindi transcript into the sweet shop profile, with unclear items kept for review", async () => {
    const { extract, setupTranscript } = await extractSetupProfile({
      userId: owner,
      brandId,
      transcript: SETUP_TRANSCRIPT_FIXTURE,
    });
    expect(spies.generateJson).toHaveBeenCalledTimes(1);
    // The prompt carries the transcript and the orchestrator's schema.
    const call = spies.generateJson.mock.calls[0][0];
    expect(call.user).toContain("श्री राम स्वीट्स");
    expect(call.system).toContain("business profile");
    expect(setupTranscript).toBe(SETUP_TRANSCRIPT_FIXTURE);

    expect(extract.business_name).toBe("श्री राम स्वीट्स");
    expect(extract.unclear).toEqual(["Price of बेसन लड्डू was not said"]);

    // Review draft: AI fields plus the owner's tap choices, saved through the profile path.
    const draft = {
      ...draftFromExtract(extract),
      tone: "Festive and lively",
      languages: ["hi", "hinglish"],
      default_language: "hi",
      colors: { primary: "#B5121B", secondary: "#FFF4E0", accent: "#F2A900" },
      whatsapp_number: "+919000000001",
    };
    await saveBrandProfile(owner, brandId, draft, { completeSetup: { transcript: setupTranscript } });

    const stored = await getBrandProfile(owner, brandId);
    expect(stored?.setupCompleted).toBe(true);
    expect(stored?.draft).toMatchObject({
      business_name: "श्री राम स्वीट्स",
      category: "sweet shop",
      city: "Indore, Sarafa Road",
      audience: "families and local office-goers in Indore, festival gift buyers",
      tone: "Festive and lively",
      languages: ["hi", "hinglish"],
      default_language: "hi",
      whatsapp_number: "+919000000001",
    });
    expect(stored?.draft.products).toHaveLength(5);
    expect(stored?.draft.products[0]).toEqual({ name: "काजू कतली", price: "600", unit: "per kg", note: "gift box packing available" });
    // A price that was not said stays blank; it is never guessed.
    expect(stored?.draft.products[4]).toMatchObject({ name: "बेसन लड्डू", price: "" });
    expect(stored?.draft.notes).toContain("14 Sarafa Road");
    const [row] = await db.withAdmin((tx) =>
      tx.query<{ setup_transcript: string }>("select setup_transcript from public.brand_memory where brand_id = $1", [brandId]),
    );
    expect(row.setup_transcript).toBe(SETUP_TRANSCRIPT_FIXTURE);
  });

  it("works from typed chat answers and keeps the questions with the answers as the transcript", async () => {
    const answers = { business: "Shri Ram Sweets, mithai", city: "Indore" };
    const res = await extractSetupProfile({ userId: owner, brandId, answers });
    const call = spies.generateJson.mock.calls[0][0];
    expect(call.user).toContain("A: Shri Ram Sweets, mithai");
    expect(call.user).toContain("A: (no answer)");
    expect(res.setupTranscript).toBe(answersToTranscript(answers));
    expect(res.setupTranscript).toContain(`Q: ${SETUP_QUESTIONS[0].en}`);
  });

  it("highlights the profile parts the unclear notes point at", () => {
    const draft = draftFromExtract(SETUP_EXTRACT_FIXTURE);
    const m = matchUnclear(["Price of बेसन लड्डू was not said", "Which city was unclear", "something else entirely"], draft);
    expect(m.productRows).toEqual([4]);
    expect(m.fields).toEqual(expect.arrayContaining(["products", "city"]));
    expect(m.fields).not.toContain("audience");
    expect(matchUnclear([], draft)).toEqual({ fields: [], productRows: [] });
  });

  it("counts one setup usage event per extraction", async () => {
    const u = (await createUser(db)).id;
    const id = await createBrandFor(db, u);
    await extractSetupProfile({ userId: u, brandId: id, transcript: SETUP_TRANSCRIPT_FIXTURE });
    expect(await usageCount(id)).toEqual(["setup"]);
  });
});

describe("an unusable transcript never reaches extraction", () => {
  it.each(["", "   ", "[no speech]", "[unclear] [unclear] [unclear] [unclear] ok"])("rejects %j before any AI call", async (t) => {
    const u = (await createUser(db)).id;
    const id = await createBrandFor(db, u);
    const err = await extractSetupProfile({ userId: u, brandId: id, transcript: t }).catch((e) => e);
    expect(err).toBeInstanceOf(SetupError);
    expect(err.code).toBe("unusable_transcript");
    expect(spies.generateJson).not.toHaveBeenCalled();
    expect(await usageCount(id)).toEqual([]);
    expect(describeError(err)).toMatchObject({ code: "unusable_transcript", message: s.setup.unusableBody });
  });

  it("rejects when no question was answered", async () => {
    const u = (await createUser(db)).id;
    const id = await createBrandFor(db, u);
    expect(hasAnyAnswer({ business: "  " })).toBe(false);
    const err = await extractSetupProfile({ userId: u, brandId: id, answers: { business: "  ", city: "" } }).catch((e) => e);
    expect(err.code).toBe("no_answers");
    expect(spies.generateJson).not.toHaveBeenCalled();
  });

  it("a clear transcript with a few [unclear] marks still passes", async () => {
    const t = "मेरी दुकान श्री राम स्वीट्स है इंदौर में काजू कतली छह सौ रुपये किलो [unclear] और जलेबी दो सौ चालीस रुपये किलो";
    await expect(extractSetupProfile({ userId: owner, brandId, transcript: t })).resolves.toBeTruthy();
  });
});

describe("voice upload and transcription", () => {
  it("saves the WAV under inputs/{brand_id}/setup/{uuid}.wav and returns a usable transcript", async () => {
    const u = (await createUser(db)).id;
    const id = await createBrandFor(db, u);
    const res = await transcribeSetupAudio({ userId: u, brandId: id, bytes: wav(), storage });
    expect(spies.generateText).toHaveBeenCalledTimes(1);
    const call = spies.generateText.mock.calls[0][0];
    expect(call.media).toHaveLength(1);
    expect(call.media[0].mimeType).toBe("audio/wav");
    expect(call.instruction).toContain("Transcribe");

    expect(res.transcript).toBe(SETUP_TRANSCRIPT_FIXTURE);
    expect(res.usable).toBe(true);
    expect(res.audioPath).toMatch(new RegExp(`^inputs/${id}/setup/[0-9a-f-]{36}\\.wav$`));
    const saved = await storage.get("inputs", res.audioPath.replace(/^inputs\//, ""));
    expect(saved?.contentType).toBe("audio/wav");
    expect(saved?.bytes.byteLength).toBe(wav().byteLength);
    expect(await usageCount(id)).toEqual(["transcribe"]);
  });

  it("flags an unusable transcript as not usable", async () => {
    spies.generateText.mockImplementationOnce(async () => ({ text: "[no speech]", stats: null }));
    const res = await transcribeSetupAudio({ userId: owner, brandId, bytes: wav(), storage });
    expect(res.usable).toBe(false);
  });

  it("rejects files that are not 16 kHz mono WAV, before storing or transcribing", async () => {
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Array(200).fill(1)]);
    await expect(transcribeSetupAudio({ userId: owner, brandId, bytes: webm, storage })).rejects.toMatchObject({ code: "invalid_audio" });
    await expect(transcribeSetupAudio({ userId: owner, brandId, bytes: encodeWav(new Int16Array(44100), 44100), storage })).rejects.toMatchObject({ code: "invalid_audio" });
    await expect(transcribeSetupAudio({ userId: owner, brandId, bytes: encodeWav(new Int16Array(100)), storage })).rejects.toMatchObject({ code: "invalid_audio" });
    await expect(transcribeSetupAudio({ userId: owner, brandId, bytes: new Uint8Array(7_000_000), storage })).rejects.toMatchObject({ code: "audio_too_large" });
    expect(spies.generateText).not.toHaveBeenCalled();
  });

  it("a non-member cannot upload or transcribe for the brand", async () => {
    await expect(transcribeSetupAudio({ userId: outsider, brandId, bytes: wav(), storage })).rejects.toBeInstanceOf(BrandAccessError);
    await expect(extractSetupProfile({ userId: outsider, brandId, transcript: SETUP_TRANSCRIPT_FIXTURE })).rejects.toBeInstanceOf(BrandAccessError);
    expect(spies.generateText).not.toHaveBeenCalled();
    expect(spies.generateJson).not.toHaveBeenCalled();
  });
});

describe("daily cap around AI calls", () => {
  it("blocks transcription and extraction at the cap, with a plain message, without calling the AI", async () => {
    const u = (await createUser(db)).id;
    const id = await createBrandFor(db, u);
    await db.withAdmin((tx) => tx.query("update public.brands set daily_generation_cap = 1 where id = $1", [id]));

    await transcribeSetupAudio({ userId: u, brandId: id, bytes: wav(), storage }); // uses the one allowed call
    spies.generateText.mockClear();

    const t = await transcribeSetupAudio({ userId: u, brandId: id, bytes: wav(), storage }).catch((e) => e);
    expect(t).toBeInstanceOf(DailyCapError);
    const e = await extractSetupProfile({ userId: u, brandId: id, transcript: SETUP_TRANSCRIPT_FIXTURE }).catch((x) => x);
    expect(e).toBeInstanceOf(DailyCapError);
    expect(spies.generateText).not.toHaveBeenCalled();
    expect(spies.generateJson).not.toHaveBeenCalled();
    expect(describeError(e).message).toBe(s.errors.dailyCap.replace("{cap}", "1"));
    expect(describeError(e).code).toBe("cap");
  });

  it("a failed AI call still counts against the cap", async () => {
    const u = (await createUser(db)).id;
    const id = await createBrandFor(db, u);
    spies.generateJson.mockImplementationOnce(async () => {
      throw new Error("model unavailable");
    });
    await expect(extractSetupProfile({ userId: u, brandId: id, transcript: SETUP_TRANSCRIPT_FIXTURE })).rejects.toThrow("model unavailable");
    expect(await usageCount(id)).toEqual(["setup"]);
  });
});
