import { afterEach, describe, expect, it, vi } from "vitest";
import { AiError } from "@/lib/ai/client";
import {
  buildOptionPrompt,
  buildPosePrompt,
  buildSheetPrompt,
  FACE_FRAMING_RULES,
  FACE_PHOTOREAL_RULE,
  FACE_POSE_LINES,
  FACE_STYLE_BLOCKS,
} from "@/lib/ai/prompts/faces";
import { checkPasses, checkProblems, pickBestTry } from "@/lib/faces/generate/check";
import { assertStepAllowed, StepBudget } from "@/lib/faces/generate/estimate";
import { FaceGenError } from "@/lib/faces/generate/errors";
import { faceImageModel, generateFaceImage, MAX_FACE_REFERENCES, pngHasC2pa } from "@/lib/faces/generate/image-client";
import { FACE_IMAGE_MODEL, FACE_POSES, FACE_STYLES, type FaceCheck } from "@/lib/faces/types";
import { greenFigure } from "./fixtures";

const OK: FaceCheck = { sameCharacter: true, hasText: false, hasLogo: false, showsProductOrPremises: false, credentialCues: false, extraLimbs: false, notes: "ok" };

describe("vision-check selection", () => {
  it("passes only when every question is answered and no problem is present", () => {
    expect(checkPasses(OK)).toBe(true);
    for (const bad of [{ sameCharacter: false }, { hasText: true }, { hasLogo: true }, { showsProductOrPremises: true }, { credentialCues: true }, { extraLimbs: true }]) {
      expect(checkPasses({ ...OK, ...bad })).toBe(false);
    }
    expect(checkPasses({ notes: "could not run" })).toBe(false); // unanswered counts as failed
  });

  it("keeps the first passing try", () => {
    expect(pickBestTry([{ check: { ...OK, hasText: true } }, { check: OK }, { check: OK }])).toEqual({ index: 1, passed: true });
    expect(pickBestTry([{ check: OK }, { check: OK }])).toEqual({ index: 0, passed: true });
  });

  it("with no passing try keeps the one with the fewest problems, earlier on a tie", () => {
    const logo = { ...OK, hasLogo: true }; // 1 problem
    const coat = { ...OK, credentialCues: true, sameCharacter: false }; // 4 problems
    expect(pickBestTry([{ check: coat }, { check: logo }])).toEqual({ index: 1, passed: false });
    expect(pickBestTry([{ check: logo }, { check: { ...OK, hasText: true } }])).toEqual({ index: 0, passed: false });
    expect(checkProblems(coat)).toBeGreaterThan(checkProblems(logo));
    expect(pickBestTry([])).toBeNull();
  });
});

describe("the step budget", () => {
  it("stops at the approved amount and at the face cap", () => {
    const b = new StepBudget(0.21, 0);
    b.reserve(0.067);
    b.reserve(0.067);
    b.reserve(0.067);
    expect(() => b.reserve(0.067)).toThrow(FaceGenError);
    const nearCap = new StepBudget(5, 1.95);
    expect(() => nearCap.reserve(0.067)).toThrow(/over_budget/);
  });

  it("settles a reservation with the real cost", () => {
    const b = new StepBudget(1, 0);
    b.reserve(0.07);
    b.settle(0.07, 0.2);
    expect(b.totalUsd).toBeCloseTo(0.2, 9);
  });

  it("assertStepAllowed names the reason", () => {
    expect(() => assertStepAllowed({ estimateUsd: 0.27, approvedEstimateUsd: 0.27, spentUsd: 0 })).not.toThrow();
    expect(() => assertStepAllowed({ estimateUsd: 0.27, approvedEstimateUsd: 0.26, spentUsd: 0 })).toThrow(/not_approved/);
    expect(() => assertStepAllowed({ estimateUsd: 0.27, approvedEstimateUsd: 5, spentUsd: 1.74 })).toThrow(/over_cap/);
    expect(() => assertStepAllowed({ estimateUsd: 0.27, approvedEstimateUsd: 5, spentUsd: 1.73 })).not.toThrow();
  });
});

describe("prompts", () => {
  const base = { kind: "illustrated" as const, style: "flat" as const, description: "A friendly baker", colors: ["#E4572E", "#00FF00", "not-a-colour"] };

  it("carries the framing rules, the style block and one line per pose", () => {
    expect(FACE_FRAMING_RULES).toContain("Single character, full body, centred, plain flat pure green #00FF00 background, no text, no letters, no logos, no products, no buildings, no other people");
    expect(FACE_FRAMING_RULES).toMatch(/no white coat, stethoscope, scrubs, gavel, suit-and-briefcase banker look/);
    for (const style of FACE_STYLES) expect(FACE_STYLE_BLOCKS[style].length).toBeGreaterThan(20);
    for (const pose of FACE_POSES) {
      const p = buildPosePrompt(base, pose);
      expect(p).toContain(FACE_POSE_LINES[pose]);
      expect(p).toContain(FACE_FRAMING_RULES);
      expect(p).toContain(FACE_STYLE_BLOCKS.flat);
    }
    for (const prompt of [buildOptionPrompt(base, 0), buildSheetPrompt(base)]) {
      expect(prompt).toContain("A friendly baker");
      expect(prompt).toContain("#E4572E");
      expect(prompt).not.toContain("not-a-colour");
      expect(prompt).not.toMatch(/brand colours: .*#00FF00/); // the keying green is never a clothing colour
    }
  });

  it("adds the fictional-adult rule only for a realistic person", () => {
    expect(FACE_PHOTOREAL_RULE).toContain("does not resemble any real or famous person");
    expect(buildOptionPrompt({ ...base, kind: "photoreal", style: "photo" }, 1)).toContain(FACE_PHOTOREAL_RULE);
    expect(buildOptionPrompt(base, 1)).not.toContain("real or famous");
  });

  it("redacts payment IDs in the description", () => {
    const prompts = [buildOptionPrompt({ ...base, description: "baker, pay at jo.smith@okhdfcbank" }, 0), buildSheetPrompt({ ...base, description: "upi://pay?pa=jo@ybl" }), buildPosePrompt({ ...base, description: "x jo@paytm" }, "wave")];
    for (const p of prompts) expect(p).not.toMatch(/okhdfcbank|jo@ybl|jo@paytm|upi:\/\//);
  });
});

describe("image client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the configured model, overridable by FACE_IMAGE_MODEL", () => {
    vi.stubEnv("FACE_IMAGE_MODEL", "");
    expect(faceImageModel()).toBe(FACE_IMAGE_MODEL);
    vi.stubEnv("FACE_IMAGE_MODEL", "gemini-3-pro-image");
    expect(faceImageModel()).toBe("gemini-3-pro-image");
  });

  it("makes no network call in fixture mode (tests), and refuses more than 3 references", async () => {
    await expect(generateFaceImage({ prompt: "x" })).rejects.toBeInstanceOf(AiError);
    vi.stubEnv("AI_MODE", "live"); // still no call: references are checked before the client is built
    await expect(generateFaceImage({ prompt: "x", references: [Buffer.alloc(1), Buffer.alloc(1), Buffer.alloc(1), Buffer.alloc(1)] })).rejects.toThrow(`At most ${MAX_FACE_REFERENCES}`);
  });

  it("detects C2PA content credentials in a PNG", async () => {
    const png = await greenFigure({ w: 32, h: 32 });
    expect(pngHasC2pa(png)).toBe(false);
    // Insert an empty "caBX" chunk after IHDR (8 signature + 25 IHDR bytes).
    const chunk = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from("caBX", "latin1"), Buffer.from([0, 0, 0, 0])]);
    const withC2pa = Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
    expect(pngHasC2pa(withC2pa)).toBe(true);
    expect(pngHasC2pa(Buffer.from("nope"))).toBe(false);
  });
});
