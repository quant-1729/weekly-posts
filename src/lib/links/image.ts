import sharp from "sharp";
import { getDb } from "@/lib/db";
import { getStorage, type Storage } from "@/lib/storage";
import { verifyLink } from "./tokens";

/**
 * GET /i/[token]: a post's square image for an email (docs/email-links.md section 4). Email
 * clients cannot send our cookie, so the URL is the credential: a signed "img" token that expires
 * after 14 days and names one post. There is no listing and no way to ask for another post.
 *
 * The image is a 600 px wide JPEG (quality 82) made from the stored square PNG and cached in
 * storage at renders/{brand}/{post}/email.jpg. The approval pages (V-16) also ask for the
 * vertical and landscape previews (`format` in the token, cached as email-vertical.jpg and
 * email-landscape.jpg) and for a small thumbnail of one of the brand's library photos
 * (`photo` in the token), for the edit page's photo picker.
 */

export const EMAIL_IMAGE_WIDTH = 600;
export const EMAIL_IMAGE_QUALITY = 82;

const NOT_FOUND = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export const EMAIL_IMAGE_FORMATS = ["square", "vertical", "landscape", "portrait", "thumbnail", "banner"] as const;
export type EmailImageFormat = (typeof EMAIL_IMAGE_FORMATS)[number];
export const PHOTO_THUMB_PX = 240;

/** Cache path (in the "renders" bucket) of a post's email picture. Square keeps the V-15 name. */
export function emailImagePath(brandId: string, postId: string, format: EmailImageFormat = "square"): string {
  return `${brandId}/${postId}/${format === "square" ? "email.jpg" : `email-${format}.jpg`}`;
}

/** Every cached email picture of a post, to delete when its image changes. */
export function emailImagePaths(brandId: string, postId: string): string[] {
  return EMAIL_IMAGE_FORMATS.map((f) => emailImagePath(brandId, postId, f));
}

const HEADERS = {
  "Content-Type": "image/jpeg",
  "Cache-Control": "private, max-age=86400",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; sandbox",
} as const;

const jpegResponse = (bytes: Uint8Array) =>
  new Response(Buffer.from(bytes), { status: 200, headers: { ...HEADERS, "Content-Length": String(bytes.byteLength) } });

export async function serveEmailImage(args: { token: string; storage?: Storage; now?: Date }): Promise<Response> {
  const claims = await verifyLink(args.token, { act: "img", now: args.now });
  if (!claims || !claims.postId) return NOT_FOUND();
  const storage = args.storage ?? getStorage();

  // A thumbnail of one of the brand's library photos, for the edit page's picker.
  if (typeof claims.extra.photo === "string") {
    const [photo] = await getDb().withService((tx) =>
      tx.query<{ storage_path: string | null }>(
        `select ph.storage_path from public.photos ph
           join public.posts p on p.brand_id = ph.brand_id
          where p.id = $1 and p.brand_id = $2 and ph.id = $3 and ph.kind = 'photo'`,
        [claims.postId, claims.brandId, claims.extra.photo],
      ),
    );
    const path = photo?.storage_path;
    if (!path?.startsWith("photos/")) return NOT_FOUND();
    const source = await storage.get("photos", path.slice("photos/".length));
    if (!source) return NOT_FOUND();
    const bytes = await sharp(Buffer.from(source.bytes))
      .rotate()
      .resize(PHOTO_THUMB_PX, PHOTO_THUMB_PX, { fit: "cover" })
      .jpeg({ quality: EMAIL_IMAGE_QUALITY })
      .toBuffer();
    return jpegResponse(bytes);
  }

  const format = claims.extra.format;
  if (typeof format !== "string" || !(EMAIL_IMAGE_FORMATS as readonly string[]).includes(format)) return NOT_FOUND();
  const kind = format as EmailImageFormat;

  // The post must still belong to the brand in the token.
  const [row] = await getDb().withService((tx) =>
    tx.query<{ image_path: string; status: string }>(
      `select i.image_path, p.status::text as status from public.post_images i
         join public.posts p on p.id = i.post_id and p.brand_id = i.brand_id
        where p.id = $1 and p.brand_id = $2 and i.format = $3::public.image_format`,
      [claims.postId, claims.brandId, kind],
    ),
  );
  if (!row) return NOT_FOUND();

  // V-17: the full-size picture the owner shares or downloads (the stored PNG, not the 600 px email
  // copy). Only for a post that is approved or posted: a draft or skipped post is not shared.
  if (claims.extra.full === true) {
    if (row.status !== "approved" && row.status !== "posted") return NOT_FOUND();
    const full = await storage.get("renders", row.image_path.replace(/^renders\//, ""));
    if (!full) return NOT_FOUND();
    return new Response(Buffer.from(full.bytes), {
      status: 200,
      headers: { ...HEADERS, "Content-Type": full.contentType || "image/png", "Content-Length": String(full.bytes.byteLength) },
    });
  }

  const cachePath = emailImagePath(claims.brandId, claims.postId, kind);
  let bytes: Uint8Array | null = (await storage.get("renders", cachePath))?.bytes ?? null;
  if (!bytes) {
    const source = await storage.get("renders", row.image_path.replace(/^renders\//, ""));
    if (!source) return NOT_FOUND();
    // Flatten any transparency onto white: JPEG has no alpha.
    bytes = await sharp(Buffer.from(source.bytes))
      .resize({ width: EMAIL_IMAGE_WIDTH, withoutEnlargement: false })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: EMAIL_IMAGE_QUALITY })
      .toBuffer();
    await storage.put("renders", cachePath, bytes, "image/jpeg").catch((e) =>
      console.warn(`[link] could not cache email image: ${e instanceof Error ? e.message : String(e)}`),
    );
  }
  return jpegResponse(bytes);
}
