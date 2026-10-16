import type { NextRequest } from "next/server";
import { handleOwnerPhoto } from "@/lib/faces/photo-http";

export const dynamic = "force-dynamic";
// Removing the background of a photo can take a while.
export const maxDuration = 60;

/** POST multipart: face_id, pose (one or more), file (a jpg/png/webp of the owner). Replies { ok, poses }. */
export function POST(req: NextRequest) {
  return handleOwnerPhoto(req);
}
