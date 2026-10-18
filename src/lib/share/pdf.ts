import { PDFDocument } from "pdf-lib";
import { requireBrandMember } from "@/lib/brand/current";
import { getDb } from "@/lib/db";
import { loadReviewData } from "@/lib/create";
import { getStorage, isBucket, type Bucket, type Storage } from "@/lib/storage";

/**
 * One PDF with every picture of a brief's posts (the "Download PDF" of the Share menu). Pages are the stored pictures, embedded
 * as they are (PNG stays lossless), one page per picture at the picture's own size, in this order: a carousel's slides in slide
 * order; otherwise the post's main size first, then its other sizes. A brief with several channels lists each channel's post in
 * turn; `postId` narrows it to one post.
 */

export type PdfResult =
  | { ok: true; bytes: Uint8Array; filename: string; pages: number }
  | { ok: false; status: 404 | 409; reason: "not_found" | "not_approved" | "no_pictures" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Corner Bakery" -> "corner-bakery"; a name with no Latin letters or digits becomes "posts". */
export function pdfFilename(businessName: string, now: Date): string {
  const slug = businessName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "posts"}-${now.toISOString().slice(0, 10)}.pdf`;
}

/** "/api/files/renders/<brand>/<post>/square.png?v=1" -> bucket and the path inside it. */
function splitUrl(url: string): { bucket: Bucket; path: string } | null {
  const m = /^\/api\/files\/([^/]+)\/([^?]+)/.exec(url);
  return m && isBucket(m[1]) ? { bucket: m[1], path: m[2] } : null;
}

export async function buildPostPdf(args: { userId: string; briefId: string; postId?: string; storage?: Storage; now?: Date }): Promise<PdfResult> {
  const { userId, briefId } = args;
  if (!UUID_RE.test(briefId)) return { ok: false, status: 404, reason: "not_found" };
  // The brief is looked up as the signed-in user: row-level security shows it only to a member of its brand.
  const [brief] = await getDb().withUser(userId, (tx) =>
    tx.query<{ brand_id: string; name: string }>(
      `select b.brand_id::text as brand_id, br.name from public.post_briefs b join public.brands br on br.id = b.brand_id where b.id = $1`,
      [briefId],
    ),
  );
  if (!brief) return { ok: false, status: 404, reason: "not_found" };
  await requireBrandMember(userId, brief.brand_id);
  const review = await loadReviewData(userId, brief.brand_id, briefId);
  const posts = (review?.posts ?? []).filter((p) => !args.postId || p.id === args.postId);
  if (posts.length === 0) return { ok: false, status: 404, reason: "not_found" };
  // Like Share and Download, only approved posts leave the app.
  if (posts.some((p) => p.status !== "approved" && p.status !== "posted")) return { ok: false, status: 409, reason: "not_approved" };

  const urls = posts.flatMap((p) => (p.carouselAsked && p.slides.length > 0 ? p.slides : p.images.map((i) => i.url)));
  const storage = args.storage ?? getStorage();
  const now = args.now ?? new Date();
  const pdf = await PDFDocument.create();
  for (const url of urls) {
    const at = splitUrl(url);
    const file = at ? await storage.get(at.bucket, at.path) : null;
    if (!file) continue;
    const bytes = file.bytes;
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const img = jpeg ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
    const page = pdf.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  if (pdf.getPageCount() === 0) return { ok: false, status: 404, reason: "no_pictures" };
  pdf.setTitle(`${brief.name} posts`);
  pdf.setAuthor(brief.name);
  pdf.setCreator("Weekly Posts");
  pdf.setProducer("Weekly Posts");
  pdf.setCreationDate(now);
  pdf.setModificationDate(now);
  return { ok: true, bytes: await pdf.save(), filename: pdfFilename(brief.name, now), pages: pdf.getPageCount() };
}
