import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrandAccessError } from "@/lib/brand/current";
import { setBrandLogo } from "@/lib/brand/profile";
import type { MockDb } from "@/lib/db/mock";
import { chooseLogoVariant, finishLogoUpload, getLogoInfo, imageSize, isLowResolution, LogoVariantError, removeWhiteBackground } from "@/lib/logo";
import { createMockStorage } from "@/lib/storage/mock";
import type { Storage } from "@/lib/storage/types";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";

/** A blue ring on white: the white inside the ring is part of the logo, the white around it is the background. */
async function ringOnWhite(size = 400, background = "#FFFFFF"): Promise<Buffer> {
  const c = size / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="${background}"/>
    <circle cx="${c}" cy="${c}" r="${size * 0.35}" fill="#1F4E9C"/>
    <circle cx="${c}" cy="${c}" r="${size * 0.17}" fill="#FFFFFF"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function pixel(png: Buffer, x: number, y: number): Promise<[number, number, number, number]> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

describe("white background removal", () => {
  it("makes the white around a logo transparent and keeps the white inside it", async () => {
    const r = await removeWhiteBackground(await ringOnWhite());
    expect(r.outcome).toBe("removed");
    if (r.outcome !== "removed") return;
    expect((await pixel(r.png, 2, 2))[3]).toBe(0); // corner
    expect((await pixel(r.png, 200, 5))[3]).toBe(0); // edge
    expect((await pixel(r.png, 200, 200)).slice(0, 4)).toEqual([255, 255, 255, 255]); // the hole of the ring is part of the logo
    const body = await pixel(r.png, 200 + 100, 200); // between the inner (r=68) and outer (r=140) circle
    expect(body[3]).toBe(255);
    expect(body[2]).toBeGreaterThan(body[0]); // still blue
    expect(r.removedShare).toBeGreaterThan(0.2);
    expect((await sharp(r.png).metadata()).hasAlpha).toBe(true);
  });

  it("removes the light halo along anti-aliased edges", async () => {
    const r = await removeWhiteBackground(await ringOnWhite());
    if (r.outcome !== "removed") throw new Error("expected removal");
    const { data, info } = await sharp(r.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // No visible pixel next to the cut is nearly white: blends were turned into partial transparency.
    let nearWhiteVisible = 0;
    for (let i = 0; i < info.width * info.height; i++) {
      const [R, G, B, A] = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]];
      const x = i % info.width;
      const y = Math.floor(i / info.width);
      const d = Math.hypot(x - 200, y - 200);
      if (d > 130 && A > 40 && R > 200 && G > 200 && B > 200) nearWhiteVisible++;
    }
    expect(nearWhiteVisible).toBe(0);
  });

  it("works on an off-white background too (a JPEG-ish 250, 250, 248)", async () => {
    const r = await removeWhiteBackground(await ringOnWhite(400, "#FAFAF8"));
    expect(r.outcome).toBe("removed");
  });

  it("leaves a photo-like border alone", async () => {
    const w = 300;
    const h = 200;
    const raw = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([(x * 255) / w, (y * 255) / h, 90 + ((x + y) % 60)], (y * w + x) * 3);
    const photo = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
    expect(await removeWhiteBackground(photo)).toEqual({ outcome: "kept", reason: "border_not_white" });
  });

  it("leaves a logo on a coloured or non-uniform border alone", async () => {
    expect(await removeWhiteBackground(await ringOnWhite(400, "#F2A900"))).toMatchObject({ outcome: "kept", reason: "border_not_white" });
    // White on three sides, a coloured band along the fourth: not a uniform border.
    const base = await ringOnWhite(400);
    const band = await sharp({ create: { width: 400, height: 40, channels: 3, background: "#222222" } }).png().toBuffer();
    const half = await sharp(base).composite([{ input: band, left: 0, top: 360 }]).png().toBuffer();
    expect(await removeWhiteBackground(half)).toMatchObject({ outcome: "kept", reason: "border_not_uniform" });
  });

  it("leaves a logo that is already transparent, or all white, alone", async () => {
    const transparent = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    expect(await removeWhiteBackground(transparent)).toMatchObject({ outcome: "kept", reason: "already_transparent" });
    const white = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#FFFFFF" } }).png().toBuffer();
    expect(await removeWhiteBackground(white)).toMatchObject({ outcome: "kept", reason: "nothing_left" });
    expect(await removeWhiteBackground(Buffer.from("not an image"))).toEqual({ outcome: "kept", reason: "unreadable" });
  });
});

describe("low-resolution warning", () => {
  it("is under 300 px on the short side", () => {
    expect(isLowResolution(299, 900)).toBe(true);
    expect(isLowResolution(300, 300)).toBe(false);
    expect(isLowResolution(1200, 120)).toBe(true);
    expect(isLowResolution(512, 340)).toBe(false);
  });

  it("reads the size of an image", async () => {
    expect(await imageSize(await ringOnWhite(250))).toEqual({ width: 250, height: 250 });
    expect(await imageSize(Buffer.from("nope"))).toBeNull();
  });
});

describe("the upload flow", () => {
  let db: MockDb;
  let root: string;
  let storage: Storage;
  let owner: string;
  let outsider: string;
  let brand: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "pm-logo-"));
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

  async function upload(bytes: Buffer) {
    await setBrandLogo({ userId: owner, brandId: brand, bytes, storage });
    return finishLogoUpload({ brandId: brand, uploaded: bytes, storage });
  }
  const get = async (name: string) => storage.get("brand-assets", `${brand}/${name}`);

  it("cleans a logo on white, warns about a small one, and lets the owner choose", async () => {
    const small = await ringOnWhite(200);
    const report = await upload(small);
    expect(report).toMatchObject({ width: 200, height: 200, lowResolution: true, background: "removed", active: "without_background" });
    expect(report.message).toBe("We removed the white background from your logo.");
    expect(await get("logo-original.png")).not.toBeNull();
    expect(await get("logo-clean.png")).not.toBeNull();
    expect((await sharp(Buffer.from((await get("logo.png"))!.bytes)).metadata()).hasAlpha).toBe(true);

    const logoPath = `brand-assets/${brand}/logo.png`;
    let info = await getLogoInfo(owner, brand, logoPath, storage);
    expect(info).toMatchObject({ hasChoice: true, active: "without_background", lowResolution: true, width: 200 });

    await chooseLogoVariant({ userId: owner, brandId: brand, variant: "with_background", storage });
    info = await getLogoInfo(owner, brand, logoPath, storage);
    expect(info.active).toBe("with_background");
    expect((await pixel(Buffer.from((await get("logo.png"))!.bytes), 2, 2))[3]).toBe(255); // the original, with its white

    await chooseLogoVariant({ userId: owner, brandId: brand, variant: "without_background", storage });
    expect((await getLogoInfo(owner, brand, logoPath, storage)).active).toBe("without_background");
  });

  it("keeps a logo it cannot clean as it is, and drops the variants of the earlier logo", async () => {
    const orange = await ringOnWhite(600, "#F2A900");
    const report = await upload(orange);
    expect(report).toMatchObject({ lowResolution: false, background: "kept", active: "with_background", message: "We kept your logo as it is." });
    expect(await get("logo-original.png")).toBeNull();
    expect(await get("logo-clean.png")).toBeNull();
    expect((await getLogoInfo(owner, brand, `brand-assets/${brand}/logo.png`, storage)).hasChoice).toBe(false);
  });

  it("judges the size of the upload, not of the 512 px copy", async () => {
    const wide = await sharp({ create: { width: 1400, height: 250, channels: 3, background: "#1F4E9C" } }).png().toBuffer();
    expect((await upload(wide)).lowResolution).toBe(true);
    const big = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#1F4E9C" } }).png().toBuffer();
    expect(await upload(big)).toMatchObject({ width: 2000, height: 1000, lowResolution: false });
  });

  it("refuses a non-member and a version that does not exist", async () => {
    await expect(chooseLogoVariant({ userId: outsider, brandId: brand, variant: "with_background", storage })).rejects.toBeInstanceOf(BrandAccessError);
    await upload(await sharp({ create: { width: 600, height: 600, channels: 3, background: "#1F4E9C" } }).png().toBuffer());
    await expect(chooseLogoVariant({ userId: owner, brandId: brand, variant: "without_background", storage })).rejects.toBeInstanceOf(LogoVariantError);
    await expect(getLogoInfo(outsider, brand, null, storage)).rejects.toBeInstanceOf(BrandAccessError);
  });
});
