import { createHash } from "node:crypto";
import sharp from "sharp";
import { FACE_POSES, type FaceCheck, type FacePose } from "@/lib/faces/types";
import { FACE_POSE_LINES } from "@/lib/ai/prompts/faces";
import type { FaceCheckFn } from "@/lib/faces/generate/check";
import type { FaceImageFn, FaceImageRequest, FaceImageResult } from "@/lib/faces/generate/image-client";

export interface GreenOptions {
  w?: number;
  h?: number;
  /** The background (default pure #00FF00). */
  bg?: { r: number; g: number; b: number };
  /** The figure colour (magenta by default; nothing in a design is this colour). */
  fg?: { r: number; g: number; b: number };
  /** Figure size as a share of the canvas. */
  share?: number;
}

/** A figure (an antialiased ellipse) on a flat green background, like an AI image made for chroma keying. Small, generated, no AI. */
export async function greenFigure(o: GreenOptions = {}): Promise<Buffer> {
  const w = o.w ?? 640;
  const h = o.h ?? 960;
  const bg = o.bg ?? { r: 0, g: 255, b: 0 };
  const fg = o.fg ?? { r: 255, g: 0, b: 170 };
  const share = o.share ?? 0.5;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="rgb(${bg.r},${bg.g},${bg.b})"/><ellipse cx="${w / 2}" cy="${h / 2}" rx="${(w * share) / 2}" ry="${(h * share) / 2}" fill="rgb(${fg.r},${fg.g},${fg.b})"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function alphaAt(png: Buffer, x: number, y: number): Promise<number> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * 4 + 3];
}

export const sha = (b: Buffer) => createHash("sha1").update(b).digest("hex");

export interface FakeImage {
  fn: FaceImageFn;
  requests: FaceImageRequest[];
  /** Which pose / try each returned image was made for, by image hash. */
  made: Map<string, { pose: FacePose | null; tryNo: number }>;
}

/** An image function that returns a green-background figure (a slightly different one every call) and records every request. */
export function fakeImage(o: { usd?: number; failAt?: (n: number) => boolean } = {}): FakeImage {
  const requests: FaceImageRequest[] = [];
  const made = new Map<string, { pose: FacePose | null; tryNo: number }>();
  const tries = new Map<string, number>();
  let n = 0;
  const fn: FaceImageFn = async (req) => {
    const call = n++;
    requests.push(req);
    if (o.failAt?.(call)) throw new Error("model said no");
    const pose = FACE_POSES.find((p) => req.prompt.includes(FACE_POSE_LINES[p])) ?? null;
    const key = pose ?? "-";
    const tryNo = tries.get(key) ?? 0;
    tries.set(key, tryNo + 1);
    const bytes = await greenFigure({ fg: { r: 200 + (call % 50), g: 10, b: 120 } });
    made.set(sha(bytes), { pose, tryNo });
    const res: FaceImageResult = { bytes, mimeType: "image/png", model: "gemini-test-image", modelVersion: "test-001", usd: o.usd ?? 0.067, c2pa: false, synthid: true };
    return res;
  };
  return { fn, requests, made };
}

const PASS: FaceCheck = { sameCharacter: true, hasText: false, hasLogo: false, showsProductOrPremises: false, credentialCues: false, extraLimbs: false, notes: "ok" };

/** A check function that decides by the pose and try number the image was made for. */
export function fakeCheck(img: FakeImage, decide: (pose: FacePose | null, tryNo: number) => Partial<FaceCheck> = () => ({}), usd = 0.002): { fn: FaceCheckFn; calls: number[] } {
  const calls: number[] = [];
  const fn: FaceCheckFn = async ({ candidate }) => {
    const m = img.made.get(sha(candidate));
    calls.push(calls.length);
    return { check: { ...PASS, ...decide(m?.pose ?? null, m?.tryNo ?? 0) }, usd };
  };
  return { fn, calls };
}
