import { getDb } from "@/lib/db";
import { getStorage } from "./index";
import { isBucket, parseStoragePath } from "./paths";
import type { Storage } from "./types";

/**
 * Logic of GET /api/files/[bucket]/[...path]. Serves a file only to a signed-in
 * member of the brand named by the first path segment. Non-members get the same
 * 404 as a missing file, so brand ids cannot be probed.
 */
export async function serveFile(args: {
  userId: string | null;
  bucket: string;
  segments: string[];
  storage?: Storage;
}): Promise<Response> {
  const { userId, bucket, segments } = args;
  if (!userId) return new Response("Sign in required", { status: 401 });
  if (!isBucket(bucket)) return new Response("Not found", { status: 404 });

  let brandId: string;
  try {
    brandId = parseStoragePath(segments.join("/")).brandId;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const [row] = await getDb().withUser(userId, (tx) =>
    tx.query<{ ok: boolean }>("select public.is_brand_member($1::uuid) as ok", [brandId]),
  );
  if (!row?.ok) return new Response("Not found", { status: 404 });

  const file = await (args.storage ?? getStorage()).get(bucket, segments.join("/"));
  if (!file) return new Response("Not found", { status: 404 });

  return new Response(file.bytes as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.bytes.byteLength),
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      // Uploaded files (SVG, HTML) must never run scripts on our origin.
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}
