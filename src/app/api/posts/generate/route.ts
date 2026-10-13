import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCurrentBrand } from "@/lib/brand/current";
import { s } from "@/lib/i18n/strings";
import { generatePost, type PostInput } from "@/lib/posts/generate";
import type { StreamEvent } from "@/lib/posts/stream";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Vercel rejects request bodies over 4.5 MB; photos are downscaled in the browser to stay under this.
const MAX_BODY_BYTES = 4_400_000;

function bad(status: number, code: string, message: string) {
  return Response.json({ ok: false, code, message }, { status });
}

/**
 * POST multipart: type (photo | text | voice), then `text`, or `photo` (+ optional `caption`),
 * or `audio` (WAV). Works in the owner's current brand. Streams newline-delimited JSON:
 * `{"event":"stage","stage":"writing"}` lines, then one `{"event":"done", ...outcome}`.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return bad(401, "signed_out", s.errors.signedOut);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad(400, "invalid_input", s.errors.generic);
  }

  const type = form.get("type");
  let input: PostInput;
  if (type === "text") {
    const text = form.get("text");
    if (typeof text !== "string") return bad(400, "invalid_input", s.create.errors.emptyText);
    input = { type: "text", text };
  } else if (type === "photo") {
    const photo = form.get("photo");
    const caption = form.get("caption");
    if (!(photo instanceof File)) return bad(400, "invalid_input", s.create.needPhoto);
    if (photo.size > MAX_BODY_BYTES) return bad(413, "invalid_input", s.create.errors.invalidPhoto);
    input = {
      type: "photo",
      bytes: new Uint8Array(await photo.arrayBuffer()),
      caption: typeof caption === "string" ? caption : "",
    };
  } else if (type === "voice") {
    const audio = form.get("audio");
    if (!(audio instanceof File)) return bad(400, "invalid_input", s.errors.invalidAudio);
    if (audio.size > MAX_BODY_BYTES) return bad(413, "invalid_input", s.errors.audioTooLarge);
    input = { type: "voice", bytes: new Uint8Array(await audio.arrayBuffer()) };
  } else {
    return bad(400, "invalid_input", s.errors.generic);
  }

  const brand = await getCurrentBrand(user.id);
  if (!brand || !brand.setupCompleted) return bad(409, "no_brand", s.create.errors.noBrand);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        const outcome = await generatePost({
          userId: user.id,
          brandId: brand.id,
          input,
          onStage: (stage) => send({ event: "stage", stage }),
        });
        send({ event: "done", ...outcome });
      } catch (e) {
        console.error("[posts] route failed", e);
        send({ event: "done", ok: false, code: "generic", message: s.errors.generic, postId: null });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
