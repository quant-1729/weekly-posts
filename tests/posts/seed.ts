import type { MockDb } from "@/lib/db/mock";

let counter = 0;

export interface SeedOutput {
  channel: "ig_feed" | "status" | "facebook" | "gbp";
  language: "hi" | "hinglish" | "en";
  caption?: string;
  image?: boolean;
}

export interface SeedPost {
  /** Anything Postgres reads as a timestamp, e.g. "2026-10-13 23:59:00+05:30". */
  createdAt: string;
  status?: "generating" | "draft" | "ready" | "failed";
  language?: "hi" | "hinglish" | "en";
  inputType?: "photo" | "text" | "voice";
  inputText?: string | null;
  outputs?: SeedOutput[];
}

/** Inserts a post (with outputs) straight into the database, with a chosen created_at. */
export async function seedPost(db: MockDb, brandId: string, userId: string, p: SeedPost): Promise<string> {
  counter += 1;
  const code = `s${String(counter).padStart(6, "0")}`;
  return db.withAdmin(async (tx) => {
    const [row] = await tx.query<{ id: string }>(
      `insert into public.posts (brand_id, created_by, input_type, input_text, language, status, post_code, created_at)
       values ($1, $2, $3::public.input_type, $4, $5::public.content_language, $6::public.post_status, $7, $8::timestamptz)
       returning id`,
      [brandId, userId, p.inputType ?? "text", p.inputText ?? null, p.language ?? "hi", p.status ?? "draft", code, p.createdAt],
    );
    for (const o of p.outputs ?? []) {
      const image = o.image === false || o.channel === "gbp" ? null : `renders/${brandId}/${row.id}/${o.channel === "status" ? "status" : "ig_feed"}.png`;
      await tx.query(
        `insert into public.outputs (post_id, brand_id, channel, language, caption, image_path)
         values ($1, $2, $3::public.channel, $4::public.content_language, $5, $6)`,
        [row.id, brandId, o.channel, o.language, o.caption ?? `caption ${o.channel}`, image],
      );
    }
    return row.id;
  });
}

/** The four channels of a post, all in one language. */
export const allChannels = (language: SeedOutput["language"], caption = "First line\nSecond line"): SeedOutput[] => [
  { channel: "ig_feed", language, caption },
  { channel: "status", language },
  { channel: "facebook", language },
  { channel: "gbp", language },
];
