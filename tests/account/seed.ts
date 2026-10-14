import { randomBytes, randomUUID } from "node:crypto";
import type { MockDb } from "@/lib/db/mock";
import { BUCKETS, type Bucket, type Storage } from "@/lib/storage";

export interface SeededFile {
  bucket: Bucket;
  /** Inside the bucket: {brand_id}/... */
  path: string;
  bytes: Buffer;
}

export interface SeededAccount {
  userId: string;
  email: string;
  brandId: string;
  name: string;
  files: SeededFile[];
  photoId: string;
  photo2Id: string;
  pastPostId: string;
  postIds: string[];
  postCodes: string[];
  mascotId: string;
}

let counter = 0;

/**
 * A full account: user, profile, brand, memory, facts (one inactive), library photos, a past-post
 * screenshot and a pasted past post, owner dates, voice feedback, a v1 plan and idea, a mascot, a
 * weekly batch with posts, post images, a v1 output, actions, clicks, check-ins, approval link,
 * approval and comment, summary share, usage events, emails, and files in every bucket.
 */
export async function seedAccount(
  db: MockDb,
  storage: Storage,
  o: { email?: string; name?: string } = {},
): Promise<SeededAccount> {
  counter += 1;
  const n = counter;
  const email = o.email ?? `owner-${n}-${randomUUID().slice(0, 6)}@example.com`;
  const name = o.name ?? `Corner Bakery ${n}`;

  const userId = await db.withAdmin(async (tx) => {
    const [u] = await tx.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
    await tx.query("insert into public.profiles (id, email, consent_at) values ($1, $2, now())", [u.id, email]);
    return u.id;
  });
  const [{ id: brandId }] = await db.withUser(userId, (tx) => tx.query<{ id: string }>("select public.create_brand($1) as id", [name]));

  const files: SeededFile[] = [];
  const put = async (bucket: Bucket, rel: string, type: string, label: string) => {
    const bytes = Buffer.concat([Buffer.from(`${label}:${email}:`), randomBytes(200)]);
    await storage.put(bucket, `${brandId}/${rel}`, bytes, type);
    files.push({ bucket, path: `${brandId}/${rel}`, bytes });
  };

  const photoId = randomUUID();
  const photo2Id = randomUUID();
  const pastPostId = randomUUID();
  const textPostId = randomUUID();
  const mascotId = randomUUID();
  const postIds = [randomUUID(), randomUUID()];
  const postCodes = [`a${n}${randomUUID().slice(0, 5).replace(/-/g, "x")}`.toLowerCase(), `b${n}${randomUUID().slice(0, 5).replace(/-/g, "x")}`.toLowerCase()];
  const setupAudio = randomUUID();

  await put("brand-assets", "logo.png", "image/png", "logo");
  await put("photos", `${photoId}.jpg`, "image/jpeg", "photo1");
  await put("photos", `${photo2Id}.jpg`, "image/jpeg", "photo2");
  await put("photos", `${pastPostId}.jpg`, "image/jpeg", "pastpost");
  await put("inputs", `setup/${setupAudio}.wav`, "audio/wav", "audio");
  await put("mascots", `${mascotId}/sheet.png`, "image/png", "mascot-sheet");
  await put("mascots", `${mascotId}/poses/wave.svg`, "image/svg+xml", "mascot-pose");
  for (const [i, id] of postIds.entries()) {
    for (const format of ["square", "vertical", "landscape"]) {
      if (i === 1 && format !== "square") continue;
      await put("renders", `${id}/${format}.png`, "image/png", `render-${i}-${format}`);
    }
  }
  await put("renders", `${postIds[1]}/ig_feed.png`, "image/png", "render-v1");

  await db.withAdmin(async (tx) => {
    await tx.query(
      `update public.brand_memory set business_name = $2, category = 'bakery', city = 'London', country = 'GB',
              timezone = 'Europe/London', logo_path = $3, website_url = 'https://bakery.example.com',
              setup_transcript = 'we sell bread', setup_completed_at = now()
        where brand_id = $1`,
      [brandId, name, `brand-assets/${brandId}/logo.png`],
    );
    await tx.query("update public.profiles set last_brand_id = $2 where id = $1", [userId, brandId]);

    await tx.query(
      `insert into public.brand_facts (brand_id, kind, label, value, source_type, source_ref, source_quote, active, created_by)
       values ($1, 'price', 'Loaf', '£4.50', 'website', 'https://bakery.example.com/menu', 'Sourdough £4.50', true, $2),
              ($1, 'hours', 'Hours', '7am to 6pm', 'setup', 'q3', null, true, $2),
              ($1, 'offer', 'Old offer', '10% off', 'owner', null, null, false, $2)`,
      [brandId, userId],
    );
    await tx.query(
      `insert into public.photos (id, brand_id, kind, storage_path, width, height, description, has_people, created_by) values
         ($2, $1, 'photo', $5, 1200, 900, 'Bread on a table', false, $7),
         ($3, $1, 'photo', $6, 800, 800, 'The shop front', true, $7),
         ($4, $1, 'past_post', $8, 1080, 1080, null, null, $7)`,
      [brandId, photoId, photo2Id, pastPostId, `photos/${brandId}/${photoId}.jpg`, `photos/${brandId}/${photo2Id}.jpg`, userId, `photos/${brandId}/${pastPostId}.jpg`],
    );
    await tx.query("update public.photos set extracted_text = 'Fresh bread today' where id = $1", [pastPostId]);
    await tx.query(
      "insert into public.photos (id, brand_id, kind, extracted_text, created_by) values ($1, $2, 'past_post', 'Pasted caption about cake', $3)",
      [textPostId, brandId, userId],
    );
    await tx.query("insert into public.owner_dates (brand_id, date, name, yearly) values ($1, '2026-12-01', 'Shop birthday', true)", [brandId]);
    await tx.query("insert into public.voice_feedback (brand_id, instruction) values ($1, 'shorter please')", [brandId]);

    // v3 details: selling points, contact set, a brief that uses one of them and the photo.
    const [usp] = await tx.query<{ id: string }>(
      `insert into public.usps (brand_id, kind, title, details, source, created_by)
       values ($1, 'discount', '20% off cakes', '{"percent":20,"on":"cakes","upTo":false}', 'owner', $2) returning id`,
      [brandId, userId],
    );
    await tx.query("insert into public.usps (brand_id, kind, title, source, source_ref, sort) values ($1, 'custom', 'Family run', 'website', 'https://bakery.example.com/about', 1)", [brandId]);
    await tx.query(
      `insert into public.contact_points (brand_id, kind, value, display, details, created_by) values
         ($1, 'phone', '+442079460958', '020 7946 0958', '{}', $2),
         ($1, 'website', 'https://bakery.example.com', 'bakery.example.com', '{}', $2)`,
      [brandId, userId],
    );
    await tx.query(
      `insert into public.post_briefs (brand_id, post_type, primary_usp_id, usp_snapshot, cta, photo_id, ends_on, timezone, created_by)
       values ($1, 'offer', $2, '[{"title":"20% off cakes"}]', 'visit', $3, '2026-10-31', 'Europe/London', $4)`,
      [brandId, usp.id, photoId, userId],
    );

    const [plan] = await tx.query<{ id: string }>(
      "insert into public.weekly_plans (brand_id, week_start, created_by) values ($1, '2026-10-12', $2) returning id",
      [brandId, userId],
    );
    await tx.query("insert into public.plan_ideas (plan_id, brand_id, title, suggested_day) values ($1, $2, 'Idea', '2026-10-14')", [plan.id, brandId]);
    await tx.query(
      "insert into public.mascots (id, brand_id, status, name, sheet_path, created_by) values ($1, $2, 'active', 'Bready', $3, $4)",
      [mascotId, brandId, `mascots/${brandId}/${mascotId}/sheet.png`, userId],
    );

    const [batch] = await tx.query<{ id: string }>(
      "insert into public.weekly_batches (brand_id, week_start, status, usd) values ($1, '2026-10-12', 'ready', 0.12) returning id",
      [brandId],
    );
    for (const [i, id] of postIds.entries()) {
      await tx.query(
        `insert into public.posts (id, brand_id, created_by, batch_id, suggested_day, channel, post_language, caption, cta, hashtags,
                                   image_text, fact_flags, status, post_code, photo_id, approved_at, mascot_id)
         values ($1, $2, $3, $4, '2026-10-14', 'instagram', 'en', $5, 'Come in', '{#bread}', '{"headline":"Fresh"}',
                 '[{"id":"f1","text":"£4.50","kind":"price","status":"open"}]', 'approved', $6, $7, now(), $8)`,
        [id, brandId, userId, batch.id, `Caption number ${i} ${email}`, postCodes[i], i === 0 ? photoId : null, i === 0 ? mascotId : null],
      );
    }
    for (const format of ["square", "vertical", "landscape"]) {
      await tx.query(
        "insert into public.post_images (post_id, brand_id, format, template_id, image_path) values ($1, $2, $3::public.image_format, 't1', $4)",
        [postIds[0], brandId, format, `renders/${brandId}/${postIds[0]}/${format}.png`],
      );
    }
    await tx.query(
      "insert into public.post_images (post_id, brand_id, format, template_id, image_path) values ($1, $2, 'square', 't1', $3)",
      [postIds[1], brandId, `renders/${brandId}/${postIds[1]}/square.png`],
    );
    await tx.query(
      "insert into public.outputs (post_id, brand_id, channel, language, caption, image_path) values ($1, $2, 'ig_feed', 'en', 'v1 caption', $3)",
      [postIds[1], brandId, `renders/${brandId}/${postIds[1]}/ig_feed.png`],
    );
    await tx.query(
      `insert into public.post_actions (post_id, brand_id, action, via, user_id) values
         ($1, $2, 'approve', 'dashboard', $3), ($1, $2, 'share', 'email_link', null)`,
      [postIds[0], brandId, userId],
    );
    await tx.query(
      `insert into public.clicks (post_id, brand_id, user_agent) values
         ($1, $2, 'Mozilla/5.0 secret-agent-${n}'), ($1, $2, 'Mozilla/5.0 another'), ($1, $2, null)`,
      [postIds[0], brandId],
    );
    await tx.query("insert into public.checkins (brand_id, week_start, answer, via) values ($1, '2026-10-05', 'few', 'email_link')", [brandId]);

    const [link] = await tx.query<{ id: string }>(
      "insert into public.approval_links (brand_id, token_hash, approver_name, created_by) values ($1, $2, 'Sam', $3) returning id",
      [brandId, `hash-${randomUUID()}`, userId],
    );
    const [appr] = await tx.query<{ id: string }>(
      "insert into public.approvals (link_id, post_id, brand_id) values ($1, $2, $3) returning id",
      [link.id, postIds[0], brandId],
    );
    await tx.query("insert into public.approval_comments (approval_id, brand_id, author, body) values ($1, $2, 'approver', 'Looks good')", [appr.id, brandId]);
    await tx.query("insert into public.summary_shares (brand_id, token_hash, week_start, created_by) values ($1, $2, '2026-10-12', $3)", [
      brandId,
      `share-${randomUUID()}`,
      userId,
    ]);
    await tx.query("insert into public.usage_events (brand_id, user_id, kind, usd) values ($1, $2, 'weekly_batch', 0.12)", [brandId, userId]);

    // Emails: brand + user, user only (no brand), address only (sign-in email), brand only.
    await tx.query(
      `insert into public.email_log (brand_id, user_id, kind, to_email, subject, status) values
         ($1, $2, 'weekly', $3, 'Your posts', 'sent'),
         (null, $2, 'account_delete', $3, 'Confirm delete', 'sent'),
         (null, $2, 'magic_link', 'alt-' || $3, 'User-only row, other address', 'sent'),
         (null, null, 'magic_link', $3, 'Sign in', 'sent'),
         ($1, null, 'reminder', $3, 'Reminder', 'sent')`,
      [brandId, userId, email],
    );

    // Sign-in links (single-use ids) hold the address: one used, one still open.
    await tx.query(
      `insert into public.magic_links (jti, email, ip, expires_at, used_at) values
         ($1, $3, '203.0.113.9', now() + interval '15 minutes', now()),
         ($2, $3, null, now() + interval '15 minutes', null)`,
      [randomUUID(), randomUUID(), email],
    );
  });

  return { userId, email, brandId, name, files, photoId, photo2Id, pastPostId, postIds, postCodes, mascotId };
}

/** Which bucket files exist under the brand prefix now. */
export async function filesUnder(storage: Storage, brandId: string): Promise<string[]> {
  const out: string[] = [];
  for (const bucket of BUCKETS) for (const p of await storage.list(bucket, brandId)) out.push(`${bucket}/${p}`);
  return out;
}
