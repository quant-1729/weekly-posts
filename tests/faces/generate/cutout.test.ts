import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chromaKey, CUTOUT_MIN_PX } from "@/lib/faces/generate/chroma";
import { cutout } from "@/lib/faces/generate/cutout";
import { FaceGenError } from "@/lib/faces/generate/errors";
import { MATTING_MAX_UPLOAD_BYTES, mattingCutout } from "@/lib/faces/generate/matting";
import { poseFixture } from "../helpers";
import { alphaAt, greenFigure } from "./fixtures";

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof FaceGenError ? `${e.code}|${e.message}` : `other:${String(e)}`;
  }
  return null;
};

describe("chroma key", () => {
  it("makes the green transparent, keeps the figure opaque and trims to it", async () => {
    const out = await chromaKey(await greenFigure({ w: 640, h: 960, share: 0.5 }));
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("png");
    expect(meta.hasAlpha).toBe(true);
    // The figure is 320 x 480 plus a small pad: far below the 640 x 960 canvas.
    expect(meta.width).toBeGreaterThan(300);
    expect(meta.width).toBeLessThan(360);
    expect(meta.height).toBeGreaterThan(460);
    expect(meta.height).toBeLessThan(520);
    expect(await alphaAt(out, 0, 0)).toBe(0);
    expect(await alphaAt(out, meta.width! - 1, 0)).toBe(0);
    expect(await alphaAt(out, 0, meta.height! - 1)).toBe(0);
    expect(await alphaAt(out, meta.width! - 1, meta.height! - 1)).toBe(0);
    expect(await alphaAt(out, Math.floor(meta.width! / 2), Math.floor(meta.height! / 2))).toBe(255);
  });

  it("leaves no green on the edge: soft alpha, despilled colours, the figure colour kept", async () => {
    const out = await chromaKey(await greenFigure());
    const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let soft = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a === 0) continue;
      if (a < 255) soft++;
      // No visible pixel is more green than its red or blue (the figure is magenta).
      expect(data[i + 1] - Math.max(data[i], data[i + 2])).toBeLessThan(15);
    }
    expect(soft).toBeGreaterThan(20); // an antialiased edge, not a hard cut
    const mid = ((info.height >> 1) * info.width + (info.width >> 1)) * 4;
    expect(data[mid]).toBeGreaterThan(240); // magenta kept
    expect(data[mid + 1]).toBeLessThan(15);
  });

  it("also keys a background that is not exactly #00FF00", async () => {
    const out = await chromaKey(await greenFigure({ bg: { r: 30, g: 225, b: 45 } }));
    expect(await alphaAt(out, 0, 0)).toBe(0);
    const m = await sharp(out).metadata();
    expect(await alphaAt(out, m.width! >> 1, m.height! >> 1)).toBe(255);
  });

  it("pads a small figure up to the minimum pose size", async () => {
    const out = await chromaKey(await greenFigure({ w: 300, h: 300, share: 0.3 }));
    const m = await sharp(out).metadata();
    expect(m.width).toBeGreaterThanOrEqual(CUTOUT_MIN_PX);
    expect(m.height).toBeGreaterThanOrEqual(CUTOUT_MIN_PX);
    expect(await alphaAt(out, m.width! >> 1, m.height! >> 1)).toBe(255);
  });

  it("refuses an image that is not on green, or has nothing left", async () => {
    const grey = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 120, g: 120, b: 120 } } }).png().toBuffer();
    expect(await code(chromaKey(grey))).toMatch(/^cutout_failed\|/);
    const plainGreen = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 0, g: 255, b: 0 } } }).png().toBuffer();
    expect(await code(chromaKey(plainGreen))).toMatch(/^cutout_failed\|.*nothing left/);
    expect(await code(chromaKey(Buffer.from("not an image")))).toMatch(/^cutout_failed\|/);
  });

  it("is what cutout(png, 'chroma') runs", async () => {
    const out = await cutout(await greenFigure(), "chroma");
    expect((await sharp(out).metadata()).hasAlpha).toBe(true);
  });
});

describe("matting client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("says the service is not configured when CUTOUT_URL is unset", async () => {
    vi.stubEnv("CUTOUT_URL", "");
    expect(await code(cutout(await poseFixture(), "matting"))).toBe("cutout_not_configured|cutout_not_configured");
  });

  it("times out cleanly instead of hanging", async () => {
    const hang = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const started = Date.now();
    const result = await code(mattingCutout(await poseFixture(), { url: "http://cutout.test/cutout", timeoutMs: 60, fetchImpl: hang }));
    expect(result).toMatch(/^cutout_failed\|.*timed out/);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("refuses a photo over the size limit without calling the service", async () => {
    const fetchImpl = vi.fn();
    const big = Buffer.alloc(MATTING_MAX_UPLOAD_BYTES + 1);
    expect(await code(mattingCutout(big, { url: "http://cutout.test/cutout", fetchImpl: fetchImpl as unknown as typeof fetch }))).toMatch(/^cutout_failed\|.*too large/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a service error and an answer that is not a transparent PNG", async () => {
    const err500 = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    expect(await code(mattingCutout(await poseFixture(), { url: "http://cutout.test/cutout", fetchImpl: err500 }))).toMatch(/^cutout_failed\|.*500/);
    const opaque = await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const noAlpha = (async () => new Response(new Uint8Array(opaque))) as unknown as typeof fetch;
    expect(await code(mattingCutout(await poseFixture(), { url: "http://cutout.test/cutout", fetchImpl: noAlpha }))).toMatch(/^cutout_failed\|.*transparent PNG/);
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await code(mattingCutout(await poseFixture(), { url: "http://cutout.test/cutout", fetchImpl: down }))).toMatch(/^cutout_failed\|.*could not be reached/);
  });

  it("posts the photo with the token and returns the service's PNG trimmed and sized", async () => {
    const answer = await poseFixture(); // a transparent figure, like the service returns
    const seen: { url?: string; auth?: string; size?: number } = {};
    const ok = (async (url: string, init: RequestInit) => {
      seen.url = url;
      seen.auth = (init.headers as Record<string, string>).authorization;
      seen.size = (init.body as Uint8Array).length;
      return new Response(new Uint8Array(answer), { headers: { "content-type": "image/png" } });
    }) as unknown as typeof fetch;
    const photo = Buffer.from("pretend jpeg bytes");
    const out = await mattingCutout(photo, { url: "http://cutout.test/cutout", token: "s3cret", fetchImpl: ok });
    expect(seen).toEqual({ url: "http://cutout.test/cutout", auth: "Bearer s3cret", size: photo.length });
    const m = await sharp(out).metadata();
    expect(m.hasAlpha).toBe(true);
    expect(m.width).toBeGreaterThanOrEqual(CUTOUT_MIN_PX);
    expect(m.width).toBeLessThan(320); // trimmed: the fixture's figure is 60% of 320
  });
});
