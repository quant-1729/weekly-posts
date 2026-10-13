import type { NextRequest } from "next/server";
import { scheduleVoiceRefresh } from "@/lib/uploads/background";
import { handleUpload } from "@/lib/uploads/http";
import { addPastPostScreenshot } from "@/lib/uploads/past-posts";

export const dynamic = "force-dynamic";
// Reading a screenshot calls the AI.
export const maxDuration = 60;

/** POST multipart: brand_id, file (screenshot, jpg/png/webp, max 4 MB). Replies { ok, post } or the "not a post" message. */
export function POST(req: NextRequest) {
  return handleUpload(req, async (a) => {
    const post = await addPastPostScreenshot(a);
    scheduleVoiceRefresh(a.userId, a.brandId);
    return { post };
  });
}
