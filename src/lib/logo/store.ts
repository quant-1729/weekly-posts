/**
 * Logo variants in storage. `brand-assets/{brand}/logo.png` stays the logo everything else uses
 * (brand_memory.logo_path points at it). When a white background can be removed safely, the upload is
 * also kept as `logo-original.png` and the cleaned one as `logo-clean.png`, and the owner chooses which
 * one `logo.png` is. Which is active is read by comparing the files, so no new column is needed.
 */
import { requireBrandMember } from "@/lib/brand/current";
import { logoStoragePath } from "@/lib/brand/logo-url";
import { kitCopy } from "@/lib/kit/copy";
import { getStorage, type Storage } from "@/lib/storage";
import { removeWhiteBackground } from "./background";
import { imageSize, isLowResolution } from "./quality";

export type LogoVariant = "with_background" | "without_background";

const BUCKET = "brand-assets" as const;
const ACTIVE = (brandId: string) => `${brandId}/logo.png`;
const ORIGINAL = (brandId: string) => `${brandId}/logo-original.png`;
const CLEAN = (brandId: string) => `${brandId}/logo-clean.png`;

export class LogoVariantError extends Error {
  constructor() {
    super("That logo version is not available");
    this.name = "LogoVariantError";
  }
}

export interface LogoReport {
  width: number;
  height: number;
  /** Under 300 px on the short side. */
  lowResolution: boolean;
  /** "removed": a cleaned copy exists and is in use. "kept": the logo is as uploaded. */
  background: "removed" | "kept";
  message: string;
  active: LogoVariant;
}

/**
 * After an upload was saved (setBrandLogo): checks the size, tries to remove a white background and
 * stores the variants. `uploaded` is the file as the owner sent it (for its true size). Never throws
 * for an image problem: the logo is then simply kept as it is.
 */
export async function finishLogoUpload(args: { brandId: string; uploaded?: Uint8Array; storage?: Storage }): Promise<LogoReport> {
  const storage = args.storage ?? getStorage();
  const { brandId } = args;
  const stored = await storage.get(BUCKET, ACTIVE(brandId));
  const normalized = stored ? Buffer.from(stored.bytes) : null;
  const size = (args.uploaded && (await imageSize(args.uploaded))) || (normalized && (await imageSize(normalized))) || { width: 0, height: 0 };
  const lowResolution = size.width > 0 && isLowResolution(size.width, size.height);

  const result = normalized ? await removeWhiteBackground(normalized) : null;
  if (!normalized || !result || result.outcome === "kept") {
    await clearLogoVariants(brandId, storage);
    return { ...size, lowResolution, background: "kept", message: kitCopy.logo.kept, active: "with_background" };
  }
  await storage.put(BUCKET, ORIGINAL(brandId), normalized, "image/png");
  await storage.put(BUCKET, CLEAN(brandId), result.png, "image/png");
  await storage.put(BUCKET, ACTIVE(brandId), result.png, "image/png");
  return { ...size, lowResolution, background: "removed", message: kitCopy.logo.removed, active: "without_background" };
}

export async function clearLogoVariants(brandId: string, storage: Storage = getStorage()): Promise<void> {
  await storage.remove(BUCKET, ORIGINAL(brandId));
  await storage.remove(BUCKET, CLEAN(brandId));
}

export interface LogoInfo {
  logoPath: string | null;
  /** Both versions exist, so the owner can choose. */
  hasChoice: boolean;
  active: LogoVariant;
  /** Storage paths for /api/files, when there is a choice. */
  originalFile: string | null;
  cleanFile: string | null;
  width: number;
  height: number;
  /** Short side under 300 px. For a stored logo that was shrunk to 512 px this stays false (the upload response is the exact check). */
  lowResolution: boolean;
}

/** What the Look section shows about the logo. */
export async function getLogoInfo(userId: string, brandId: string, logoPath: string | null, storage: Storage = getStorage()): Promise<LogoInfo> {
  await requireBrandMember(userId, brandId);
  const none: LogoInfo = { logoPath, hasChoice: false, active: "with_background", originalFile: null, cleanFile: null, width: 0, height: 0, lowResolution: false };
  if (!logoPath) return none;
  const [active, original, clean] = await Promise.all([storage.get(BUCKET, ACTIVE(brandId)), storage.get(BUCKET, ORIGINAL(brandId)), storage.get(BUCKET, CLEAN(brandId))]);
  if (!active) return none;
  const size = (await imageSize(active.bytes)) ?? { width: 0, height: 0 };
  const lowResolution = size.width > 0 && Math.max(size.width, size.height) < 512 && isLowResolution(size.width, size.height);
  const hasChoice = Boolean(original && clean);
  const isClean = hasChoice && Buffer.from(active.bytes).equals(Buffer.from(clean!.bytes));
  return {
    logoPath,
    hasChoice,
    active: isClean ? "without_background" : "with_background",
    originalFile: hasChoice ? `brand-assets/${ORIGINAL(brandId)}` : null,
    cleanFile: hasChoice ? `brand-assets/${CLEAN(brandId)}` : null,
    ...size,
    lowResolution,
  };
}

/** "Use with background" / "Use without background". Throws LogoVariantError when that version does not exist. */
export async function chooseLogoVariant(args: { userId: string; brandId: string; variant: LogoVariant; storage?: Storage }): Promise<{ logoPath: string; active: LogoVariant }> {
  const { userId, brandId, variant } = args;
  await requireBrandMember(userId, brandId);
  const storage = args.storage ?? getStorage();
  const chosen = await storage.get(BUCKET, variant === "without_background" ? CLEAN(brandId) : ORIGINAL(brandId));
  if (!chosen) throw new LogoVariantError();
  await storage.put(BUCKET, ACTIVE(brandId), chosen.bytes, "image/png");
  return { logoPath: logoStoragePath(brandId), active: variant };
}
