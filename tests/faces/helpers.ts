import sharp from "sharp";
import type { MockDb } from "@/lib/db/mock";
import { approveFace, approvePose, createDraftFace, savePoseImage } from "@/lib/faces/service";
import { FACE_POSES, type BrandFace, type FaceKind } from "@/lib/faces/types";
import type { Storage } from "@/lib/storage";

/** The colour of the figure in a pose fixture: nothing else in a design is this magenta. */
export const FIGURE = { r: 255, g: 0, b: 170 };

/** A small transparent pose image: a magenta figure on nothing. No AI, no network. */
export async function poseFixture(w = 320, h = 480): Promise<Buffer> {
  const figure = await sharp({ create: { width: Math.round(w * 0.6), height: Math.round(h * 0.75), channels: 4, background: { ...FIGURE, alpha: 1 } } })
    .png()
    .toBuffer();
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: figure, left: Math.round(w * 0.2), top: Math.round(h * 0.2) }])
    .png()
    .toBuffer();
}

/** Counts the pixels near the figure colour inside a box of a PNG. */
export async function figurePixels(png: Buffer, box: { x: number; y: number; w: number; h: number }): Promise<number> {
  const { data, info } = await sharp(png)
    .extract({ left: Math.max(0, Math.floor(box.x)), top: Math.max(0, Math.floor(box.y)), width: Math.ceil(box.w), height: Math.ceil(box.h) })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (Math.abs(data[i] - FIGURE.r) < 24 && data[i + 1] < 40 && Math.abs(data[i + 2] - FIGURE.b) < 24) n++;
  }
  return n;
}

/** Saves all 7 poses of a draft face and has the owner approve them (`upTo` limits how many). */
export async function addPoses(o: { userId: string; brandId: string }, face: BrandFace, storage: Storage, upTo: number = FACE_POSES.length, approve = true): Promise<void> {
  const png = await poseFixture();
  for (const pose of FACE_POSES.slice(0, upTo)) {
    await savePoseImage({ userId: o.userId, brandId: o.brandId, faceId: face.id, pose, png, storage });
    if (approve) await approvePose(o.userId, o.brandId, face.id, pose);
  }
}

/** A draft face of the kind with every pose approved, then the face approved (owner_photo gets a confirmed consent first). */
export async function makeApprovedFace(
  db: MockDb,
  o: { userId: string; brandId: string },
  kind: Exclude<FaceKind, "mascot">,
  storage: Storage,
  name = "Mia",
): Promise<BrandFace> {
  const face = await createDraftFace(o.userId, o.brandId, { kind, name, description: kind === "owner_photo" ? "" : "A friendly baker in a green apron", style: kind === "photoreal" ? "photo" : "flat" });
  await addPoses(o, face, storage);
  if (kind === "owner_photo") await confirmConsent(db, o, face.id);
  return approveFace(o.userId, o.brandId, face.id);
}

export async function confirmConsent(db: MockDb, o: { userId: string }, faceId: string): Promise<void> {
  const consent = { user_id: o.userId, at: "2026-10-15T09:00:00Z", text_version: "v1", email_confirmed_at: "2026-10-15T09:05:00Z" };
  await db.withAdmin((tx) => tx.query("update public.brand_faces set consent = $2::jsonb where id = $1", [faceId, JSON.stringify(consent)]));
}
