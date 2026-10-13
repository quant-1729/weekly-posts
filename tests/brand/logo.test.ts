import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrandAccessError } from "@/lib/brand/current";
import { LOGO_MAX_BYTES, LOGO_MAX_PX, LogoError, normalizeLogo } from "@/lib/brand/logo";
import { clearBrandLogo, getBrandProfile, setBrandLogo } from "@/lib/brand/profile";
import type { MockDb } from "@/lib/db/mock";
import { createMockStorage } from "@/lib/storage/mock";
import type { Storage } from "@/lib/storage/types";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "./helpers";

/** A solid-colour image in the given format, with an optional second colour block. */
async function image(format: "png" | "jpeg" | "webp", w = 200, h = 100, left = "#B5121B", right = "#F2A900") {
  const base = sharp({ create: { width: w, height: h, channels: 3, background: left } });
  const block = await sharp({ create: { width: Math.round(w / 3), height: h, channels: 3, background: right } })
    .png()
    .toBuffer();
  return base
    .composite([{ input: block, left: w - Math.round(w / 3), top: 0 }])
    .toFormat(format)
    .toBuffer();
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>`;

describe("logo normalisation", () => {
  it.each(["png", "jpeg", "webp"] as const)("accepts %s and saves a PNG", async (format) => {
    const out = await normalizeLogo(await image(format));
    const meta = await sharp(out.png).metadata();
    expect(meta.format).toBe("png");
    expect(out.width).toBe(200);
    expect(out.height).toBe(100);
  });

  it("shrinks a large image to at most 512 px, keeping the shape", async () => {
    const out = await normalizeLogo(await image("png", 2000, 1000));
    const meta = await sharp(out.png).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(LOGO_MAX_PX);
    expect(meta.width! / meta.height!).toBeCloseTo(2, 1);
  });

  it("does not enlarge a small image", async () => {
    const out = await normalizeLogo(await image("png", 64, 64));
    expect(out.width).toBe(64);
  });

  it("rejects SVG, by content and by declared type", async () => {
    await expect(normalizeLogo(Buffer.from(svg))).rejects.toMatchObject({ code: "unsupported_type" });
    await expect(normalizeLogo(Buffer.from(svg), "image/svg+xml")).rejects.toMatchObject({ code: "unsupported_type" });
    // An SVG renamed to look like a png is still caught: the content decides.
    await expect(normalizeLogo(Buffer.from(svg), "image/png")).rejects.toBeInstanceOf(LogoError);
  });

  it("rejects other image formats such as gif", async () => {
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).gif().toBuffer();
    await expect(normalizeLogo(gif)).rejects.toMatchObject({ code: "unsupported_type" });
  });

  it("rejects a file bigger than 2 MB", async () => {
    await expect(normalizeLogo(new Uint8Array(LOGO_MAX_BYTES + 1))).rejects.toMatchObject({ code: "too_large" });
  });

  it("accepts a large photo that is still under 2 MB", async () => {
    // Noise does not compress, so this stays large; keep it under the limit.
    const noise = await sharp({ create: { width: 600, height: 600, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 60 } } })
      .png()
      .toBuffer();
    expect(noise.length).toBeLessThanOrEqual(LOGO_MAX_BYTES);
    await expect(normalizeLogo(noise)).resolves.toBeTruthy();
  });

  it("rejects empty and corrupt files", async () => {
    await expect(normalizeLogo(new Uint8Array(0))).rejects.toMatchObject({ code: "empty" });
    await expect(normalizeLogo(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toMatchObject({ code: "invalid_image" });
  });

  it("suggests a palette from the logo's main colours", async () => {
    const out = await normalizeLogo(await image("png", 300, 100, "#B5121B", "#1B7F3B"));
    expect(out.palette).not.toBeNull();
    // The larger red block is the primary; the green block is the accent.
    const [r, g] = [parseInt(out.palette!.primary.slice(1, 3), 16), parseInt(out.palette!.primary.slice(3, 5), 16)];
    expect(r).toBeGreaterThan(150);
    expect(g).toBeLessThan(60);
    const accentG = parseInt(out.palette!.accent.slice(3, 5), 16);
    expect(accentG).toBeGreaterThan(90);
    expect(out.palette!.secondary).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("gives no palette for an all-white logo", async () => {
    const white = await sharp({ create: { width: 50, height: 50, channels: 3, background: "#ffffff" } }).png().toBuffer();
    expect((await normalizeLogo(white)).palette).toBeNull();
  });
});

describe("saving the logo", () => {
  let db: MockDb;
  let root: string;
  let storage: Storage;
  let owner: string;
  let outsider: string;
  let brandId: string;

  beforeAll(async () => {
    db = await openTestDb();
    root = await mkdtemp(path.join(os.tmpdir(), "pm-logo-"));
    storage = createMockStorage(root);
    owner = (await createUser(db)).id;
    outsider = (await createUser(db)).id;
    brandId = await createBrandFor(db, owner);
  });
  afterAll(async () => {
    await closeTestDb(db);
    await rm(root, { recursive: true, force: true });
  });

  it("stores a PNG at brand-assets/{brand_id}/logo.png and records the path", async () => {
    const res = await setBrandLogo({ userId: owner, brandId, bytes: await image("jpeg", 1200, 600), declaredType: "image/jpeg", storage });
    expect(res.logoPath).toBe(`brand-assets/${brandId}/logo.png`);
    const file = await storage.get("brand-assets", `${brandId}/logo.png`);
    expect(file?.contentType).toBe("image/png");
    expect((await sharp(file!.bytes).metadata()).format).toBe("png");
    expect((await getBrandProfile(owner, brandId))?.logoPath).toBe(`brand-assets/${brandId}/logo.png`);
    expect(await readFile(path.join(root, "brand-assets", brandId, "logo.png"))).toBeTruthy();
  });

  it("replacing the logo overwrites the same path", async () => {
    await setBrandLogo({ userId: owner, brandId, bytes: await image("png", 100, 100, "#1F4E9C", "#F59E0B"), storage });
    const meta = await sharp((await storage.get("brand-assets", `${brandId}/logo.png`))!.bytes).metadata();
    expect(meta.width).toBe(100);
  });

  it("a bad file changes nothing", async () => {
    await expect(setBrandLogo({ userId: owner, brandId, bytes: Buffer.from(svg), storage })).rejects.toBeInstanceOf(LogoError);
    expect((await sharp((await storage.get("brand-assets", `${brandId}/logo.png`))!.bytes).metadata()).width).toBe(100);
  });

  it("a non-member cannot set or remove the logo", async () => {
    await expect(setBrandLogo({ userId: outsider, brandId, bytes: await image("png"), storage })).rejects.toBeInstanceOf(BrandAccessError);
    await expect(clearBrandLogo({ userId: outsider, brandId, storage })).rejects.toBeInstanceOf(BrandAccessError);
    expect(await storage.get("brand-assets", `${brandId}/logo.png`)).not.toBeNull();
  });

  it("removing the logo clears the path and the file", async () => {
    await clearBrandLogo({ userId: owner, brandId, storage });
    expect((await getBrandProfile(owner, brandId))?.logoPath).toBeNull();
    expect(await storage.get("brand-assets", `${brandId}/logo.png`)).toBeNull();
  });
});
