import type { NextRequest } from "next/server";
import { handleUpload } from "@/lib/uploads/http";
import { addPhoto } from "@/lib/uploads/photos";

export const dynamic = "force-dynamic";
// Describing a photo calls the AI.
export const maxDuration = 60;

/** POST multipart: brand_id, file (jpg/png/webp, max 4 MB). Replies { ok, photo, warning }. */
export function POST(req: NextRequest) {
  return handleUpload(req, (a) => addPhoto(a));
}
