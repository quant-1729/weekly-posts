import { APP_NAME } from "@/lib/app";
import { getDb } from "@/lib/db";
import type { Tx } from "@/lib/db";
import { getStorage, isBucket, parseStoragePath, type Bucket, type Storage } from "@/lib/storage";
import { zipStream, type ZipEntry } from "./zip";

/**
 * Account export (Req 22): a ZIP with the owner's data as JSON plus their files.
 *
 * Every row is read through withUser, so row-level security decides what the owner can
 * see: another user's data can never be in the file. Files are then read one at a time
 * through the storage interface at the paths those rows name (and each path is checked
 * to sit under a brand the user belongs to), so memory use stays at one file at a time.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function exportFileName(now: Date = new Date()): string {
  return `weekly-posts-export-${now.toISOString().slice(0, 10)}.zip`;
}

export const EXPORT_README = `${APP_NAME}: your data export
==============================

This ZIP holds the data we keep for your account. Everything is in plain files:
JSON files open in any text editor, and images open in any photo app.

account.json        Your sign-in email, when your account was made, and when you agreed to our terms.
brand.json          Your business details (the "brand" and your "brand memory"), your mascots and faces
                    (with their pose images) and the instructions you gave when rewriting posts.
facts.json          Every fact in your brand memory, including ones you removed (active = false),
                    and where each came from (website, setup, an upload, or you).
photos.json         Your photo library and past posts: the text we read and the file name in photos/.
                    Posts and photos from Instagram also carry the link to the original (source_url).
posts.json          Every post: caption, call to action, hashtags, text on the image, the checks we
                    flagged, status and dates, and the image files it has.
actions.json        What was done to each post: approved, edited, shared, marked as posted and so on.
checkins.json       Your weekly check-in answers.
clicks.json         How many times each post's link was opened. We do not keep who opened it.
owner-dates.json    The dates you added.
usps.json           Your selling points (discounts, prices, ratings ...) and where each came from.
contact-points.json How customers reach you: phone, website, address, hours and social handles.
post-briefs.json    The details you gave for each post: type, format (post or carousel and its slide count), selling points as used, dates, QR choice.
payment-ids.json    Your payment IDs (like UPI) and their status. The confirmation codes are not included.
connections.json    The Instagram and Facebook accounts you connected for posting: account name, status and dates.
                    The saved permissions (tokens) are never included.
queue.json          Your queue: for each post the channel, the planned time, whether it was published or emailed to you,
                    its status, the link to the published post and dates.
queue-settings.json How often, on which days and at what time you chose to post, and your auto-approve and pause choices.
insights.json       How each published post did on Instagram or Facebook (reach, likes, comments, saves, shares, views) about 1, 3 and 7 days after
                    it went out, where those platforms gave us the numbers.
competitors.json    The competitors you named, with the public counts we stored for their Instagram (followers, posts).
research.json       Your trend research: each run with its cost, and the trend cards (sources with links and dates) and
                    post ideas it made. Your research focus and weekly switch are in brand.json.
emails.json         The emails we sent you, including sign-in and delete-confirmation emails: kind, subject,
                    date and status. Not the email text.
sessions.json       Your sign-ins: when, the device type, browser and system, the approximate city and country
                    (from an offline database, not your IP address), when it was last used and whether it was
                    signed out. We do not keep your IP address.

logo.png            Your logo.
photos/             Your photos. photos/past-posts/ holds screenshots of past posts.
renders/            The finished post images: renders/{post code}/{square|vertical|landscape}.png.
mascots/            Your mascot files, if you made one. mascots/faces/ holds the pose images of your faces.
inputs/             Photos and voice notes you sent when making posts, if any.

Dates are in UTC, like 2026-10-13T09:30:00.000Z.
If a file could not be found, it is listed in MISSING-FILES.txt.

Not included: usage counts we keep to limit AI use and to work out costs, and the secret parts of
sign-in and approval links.
`;

interface BrandBlock {
  brand: Record<string, unknown>;
  memory: Record<string, unknown> | null;
}

interface FileRef {
  zipName: string;
  stored: string; // "{bucket}/{brand_id}/..." as saved in the database
}

interface ListRef {
  zipPrefix: string;
  bucket: Bucket;
  brandId: string;
}

interface Plan {
  json: Array<{ name: string; value: unknown }>;
  files: FileRef[];
  lists: ListRef[];
  brandIds: Set<string>;
}

const json = (value: unknown) =>
  new TextEncoder().encode(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n",
  );

const text = (value: string) => new TextEncoder().encode(value);

function extOf(p: string, fallback: string): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(p);
  return m ? m[1].toLowerCase() : fallback;
}

function slug(name: string): string {
  return (
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "business"
  );
}

type Row = Record<string, unknown>;
const rows = (tx: Tx, sql: string, params: unknown[]) => tx.query<Row>(sql, params);

/** Reads all rows as the user. Row-level security is the only filter that matters. */
async function readRows(userId: string): Promise<{ account: Row | null; blocks: BrandBlock[]; perBrand: Map<string, Record<string, Row[]>>; emails: Row[]; sessions: Row[] }> {
  return getDb().withUser(userId, async (tx) => {
    const [account] = await rows(
      tx,
      "select email, phone, created_at, consent_at from public.profiles where id = $1",
      [userId],
    );
    const brandRows = await tx.query<{ brand: Row; memory: Row | null }>(
      `select to_jsonb(b) as brand, to_jsonb(m) as memory
         from public.brand_members bm
         join public.brands b on b.id = bm.brand_id
         left join public.brand_memory m on m.brand_id = b.id
        where bm.user_id = $1
        order by bm.created_at, b.id`,
      [userId],
    );
    const blocks = brandRows.map((r) => ({ brand: r.brand, memory: r.memory }));
    const perBrand = new Map<string, Record<string, Row[]>>();

    for (const { brand } of blocks) {
      const id = String(brand.id);
      const q = (sql: string) => rows(tx, sql, [id]);
      perBrand.set(id, {
        facts: await q(
          `select to_jsonb(f) as row from public.brand_facts f where brand_id = $1 order by created_at, id`,
        ),
        photos: await q(`select to_jsonb(p) as row from public.photos p where brand_id = $1 order by created_at, id`),
        posts: await q(`select to_jsonb(p) as row from public.posts p where brand_id = $1 order by created_at, id`),
        images: await q(
          `select p.post_code, to_jsonb(i) as row
             from public.post_images i join public.posts p on p.id = i.post_id and p.brand_id = i.brand_id
            where i.brand_id = $1 order by i.created_at, i.id`,
        ),
        outputs: await q(
          `select p.post_code, to_jsonb(o) as row
             from public.outputs o join public.posts p on p.id = o.post_id and p.brand_id = o.brand_id
            where o.brand_id = $1 order by o.created_at, o.id`,
        ),
        actions: await q(
          `select p.post_code, a.action, a.via, a.detail, a.created_at
             from public.post_actions a join public.posts p on p.id = a.post_id and p.brand_id = a.brand_id
            where a.brand_id = $1 order by a.created_at, a.id`,
        ),
        checkins: await q(`select to_jsonb(c) as row from public.checkins c where brand_id = $1 order by week_start`),
        clicks: await q(
          `select p.post_code, count(c.id)::int as clicks, min(c.clicked_at) as first_click, max(c.clicked_at) as last_click
             from public.posts p left join public.clicks c on c.post_id = p.id and c.brand_id = p.brand_id
            where p.brand_id = $1 group by p.id, p.post_code, p.created_at order by p.created_at, p.id`,
        ),
        dates: await q(`select to_jsonb(d) as row from public.owner_dates d where brand_id = $1 order by date, id`),
        voice: await q(
          `select to_jsonb(v) as row from public.voice_feedback v where brand_id = $1 order by created_at, id`,
        ),
        mascots: await q(`select to_jsonb(m) as row from public.mascots m where brand_id = $1 order by created_at, id`),
        // Brand Face: the faces and their pose images (the files are under mascots/faces/ in the ZIP).
        faces: await q(`select to_jsonb(f) as row from public.brand_faces f where brand_id = $1 order by created_at, id`),
        facePoses: await q(`select to_jsonb(p) as row from public.brand_face_poses p where brand_id = $1 order by created_at, id`),
        // v3 details. The payment ID's confirmation token hash and its expiry are secrets and are left out.
        usps: await q(`select to_jsonb(u) as row from public.usps u where brand_id = $1 order by sort, created_at, id`),
        contacts: await q(`select to_jsonb(c) as row from public.contact_points c where brand_id = $1 order by created_at, id`),
        briefs: await q(`select to_jsonb(b) as row from public.post_briefs b where brand_id = $1 order by created_at, id`),
        paymentIds: await q(
          `select to_jsonb(p) - 'confirm_token_hash' - 'confirm_expires_at' as row from public.payment_ids p where brand_id = $1 order by created_at, id`,
        ),
        // Connected publishing accounts: name, status and dates only. Never a token (those live in channel_tokens, which is not read here).
        connections: await q(
          `select jsonb_build_object('provider', c.provider, 'account_name', c.account_name, 'status', c.status,
                                     'connected_at', to_char(c.connected_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'expires_at', to_char(c.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'updated_at', to_char(c.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) as row
             from public.channel_connections c where brand_id = $1 order by connected_at, id`,
        ),
        // The queue (v3): when each post goes out and what happened. No tokens, no platform account ids.
        queue: await q(
          `select jsonb_build_object('post_code', p.post_code, 'channel', i.channel, 'slot_at', to_char(i.slot_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                     'status', i.status, 'mode', i.mode, 'attempts', i.attempts, 'last_error', i.last_error, 'permalink', i.permalink,
                                     'done_at', to_char(i.done_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                     'created_at', to_char(i.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) as row
             from public.queue_items i join public.posts p on p.id = i.post_id and p.brand_id = i.brand_id
            where i.brand_id = $1 order by i.slot_at, i.id`,
        ),
        queueSettings: await q(`select to_jsonb(s) as row from public.queue_settings s where brand_id = $1`),
        // Insights (R-8): the numbers Instagram and Facebook gave for each published post, by post code. No platform ids.
        insights: await q(
          `select jsonb_build_object('post_code', p.post_code, 'channel', i.channel, 'age_hours', m.age_hours,
                                     'fetched_at', to_char(m.fetched_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                     'reach', m.reach, 'impressions', m.impressions, 'likes', m.likes, 'comments', m.comments,
                                     'saves', m.saves, 'shares', m.shares, 'views', m.views) as row
             from public.post_metrics m
             join public.queue_items i on i.id = m.queue_item_id and i.brand_id = m.brand_id
             join public.posts p on p.id = i.post_id and p.brand_id = i.brand_id
            where m.brand_id = $1 order by i.slot_at, i.id, m.age_hours`,
        ),
        // Ideas (trend research): the competitors the owner named (with the counts we stored for them), and every run, card and idea.
        competitors: await q(`select to_jsonb(c) as row from public.competitors c where brand_id = $1 order by created_at, id`),
        competitorSnapshots: await q(`select to_jsonb(s) as row from public.competitor_snapshots s where brand_id = $1 order by taken_at, id`),
        researchRuns: await q(`select to_jsonb(r) as row from public.research_runs r where brand_id = $1 order by started_at, id`),
        trendCards: await q(`select to_jsonb(c) as row from public.trend_cards c where brand_id = $1 order by created_at, id`),
        postIdeas: await q(`select to_jsonb(i) as row from public.post_ideas i where brand_id = $1 order by created_at, id`),
      });
    }
    // The owner's own emails (policy email_log_select_own, including ones with no brand) and their brands' emails.
    const emails = await rows(
      tx,
      `select kind, subject, created_at, status from public.email_log
        where user_id = $1 or brand_id = any ($2::uuid[]) order by created_at, id`,
      [userId, blocks.map((b) => String(b.brand.id))],
    );
    // Sign-in devices (policy user_sessions_select_own). Device fields only: no ip_hash, no raw user agent.
    const sessions = await rows(
      tx,
      `select created_at, last_seen_at, revoked_at, revoked_by, device_type, browser, os, country, city
         from public.user_sessions where user_id = $1 order by created_at, id`,
      [userId],
    );
    return { account: account ?? null, blocks, perBrand, emails, sessions };
  });
}

const unwrap = (list: Row[]) => list.map((r) => (r.row ?? r) as Row);

function buildPlan(
  userId: string,
  data: Awaited<ReturnType<typeof readRows>>,
  generatedAt: Date,
): Plan {
  const { account, blocks, perBrand, emails, sessions } = data;
  const multi = blocks.length > 1;
  const plan: Plan = { json: [], files: [], lists: [], brandIds: new Set() };

  plan.json.push({
    name: "account.json",
    value: {
      user_id: userId,
      email: account?.email ?? null,
      phone: account?.phone ?? null,
      created_at: account?.created_at ?? null,
      consent_at: account?.consent_at ?? null,
      exported_at: generatedAt.toISOString(),
    },
  });

  plan.json.push({ name: "emails.json", value: emails });
  plan.json.push({ name: "sessions.json", value: sessions });

  for (const { brand, memory } of blocks) {
    const brandId = String(brand.id);
    plan.brandIds.add(brandId);
    const prefix = multi ? `${slug(String(brand.name ?? ""))}-${brandId.slice(0, 8)}/` : "";
    const d = perBrand.get(brandId)!;
    const photos = unwrap(d.photos);
    const posts = unwrap(d.posts);

    plan.json.push({
      name: `${prefix}brand.json`,
      value: {
        brand,
        brand_memory: memory,
        mascots: unwrap(d.mascots),
        faces: unwrap(d.faces),
        face_poses: unwrap(d.facePoses),
        voice_feedback: unwrap(d.voice),
      },
    });
    plan.json.push({ name: `${prefix}facts.json`, value: unwrap(d.facts) });

    plan.json.push({
      name: `${prefix}photos.json`,
      value: photos.map((p) => ({
        ...p,
        file: p.storage_path
          ? `${prefix}photos/${p.kind === "past_post" ? "past-posts/" : ""}${p.id}.${extOf(String(p.storage_path), "jpg")}`
          : null,
      })),
    });

    const imagesByPost = new Map<string, Row[]>();
    for (const r of d.images) {
      const img = r.row as Row;
      const list = imagesByPost.get(String(img.post_id)) ?? [];
      list.push({ format: img.format, template_id: img.template_id, image_path: img.image_path, file: `${prefix}renders/${r.post_code}/${img.format}.${extOf(String(img.image_path), "png")}` });
      imagesByPost.set(String(img.post_id), list);
    }
    const outputsByPost = new Map<string, Row[]>();
    for (const r of d.outputs) {
      const out = r.row as Row;
      const list = outputsByPost.get(String(out.post_id)) ?? [];
      list.push({ ...out, file: out.image_path ? `${prefix}renders/${r.post_code}/${out.channel}.${extOf(String(out.image_path), "png")}` : null });
      outputsByPost.set(String(out.post_id), list);
    }
    plan.json.push({
      name: `${prefix}posts.json`,
      value: posts.map((p) => ({
        ...p,
        post_images: imagesByPost.get(String(p.id)) ?? [],
        outputs: outputsByPost.get(String(p.id)) ?? [],
      })),
    });
    plan.json.push({ name: `${prefix}actions.json`, value: d.actions });
    plan.json.push({ name: `${prefix}checkins.json`, value: unwrap(d.checkins) });
    plan.json.push({ name: `${prefix}clicks.json`, value: d.clicks });
    plan.json.push({ name: `${prefix}owner-dates.json`, value: unwrap(d.dates) });
    plan.json.push({ name: `${prefix}usps.json`, value: unwrap(d.usps) });
    plan.json.push({ name: `${prefix}contact-points.json`, value: unwrap(d.contacts) });
    plan.json.push({ name: `${prefix}post-briefs.json`, value: unwrap(d.briefs) });
    plan.json.push({ name: `${prefix}payment-ids.json`, value: unwrap(d.paymentIds) });
    plan.json.push({ name: `${prefix}connections.json`, value: unwrap(d.connections) });
    plan.json.push({ name: `${prefix}queue.json`, value: unwrap(d.queue) });
    plan.json.push({ name: `${prefix}queue-settings.json`, value: unwrap(d.queueSettings)[0] ?? null });
    plan.json.push({ name: `${prefix}insights.json`, value: unwrap(d.insights) });
    const snapshots = unwrap(d.competitorSnapshots);
    plan.json.push({
      name: `${prefix}competitors.json`,
      value: unwrap(d.competitors).map((c) => ({ ...c, snapshots: snapshots.filter((s) => s.competitor_id === c.id) })),
    });
    const ideas = unwrap(d.postIdeas);
    const cards: Row[] = unwrap(d.trendCards).map((c) => ({ ...c, ideas: ideas.filter((i) => i.card_id === c.id) }));
    plan.json.push({
      name: `${prefix}research.json`,
      value: unwrap(d.researchRuns).map((r) => ({ ...r, cards: cards.filter((c) => c.run_id === r.id) })),
    });

    // Files, in the order they are written.
    const logo = memory?.logo_path;
    if (typeof logo === "string" && logo) plan.files.push({ zipName: `${prefix}logo.png`, stored: logo });
    for (const p of photos) {
      if (typeof p.storage_path !== "string" || !p.storage_path) continue;
      plan.files.push({
        zipName: `${prefix}photos/${p.kind === "past_post" ? "past-posts/" : ""}${p.id}.${extOf(p.storage_path, "jpg")}`,
        stored: p.storage_path,
      });
    }
    for (const r of d.images) {
      const img = r.row as Row;
      plan.files.push({
        zipName: `${prefix}renders/${r.post_code}/${img.format}.${extOf(String(img.image_path), "png")}`,
        stored: String(img.image_path),
      });
    }
    for (const r of d.outputs) {
      const out = r.row as Row;
      if (typeof out.image_path !== "string" || !out.image_path) continue;
      plan.files.push({
        zipName: `${prefix}renders/${r.post_code}/${out.channel}.${extOf(out.image_path, "png")}`,
        stored: out.image_path,
      });
    }
    plan.lists.push({ zipPrefix: `${prefix}mascots/`, bucket: "mascots", brandId });
    plan.lists.push({ zipPrefix: `${prefix}inputs/`, bucket: "inputs", brandId });
  }
  return plan;
}

/** "{bucket}/{brand_id}/..." as saved in the database, checked to be inside one of the user's brands. */
function splitStored(stored: string, brandIds: Set<string>): { bucket: Bucket; rel: string } | null {
  const slash = stored.indexOf("/");
  if (slash < 1) return null;
  const bucket = stored.slice(0, slash);
  const rel = stored.slice(slash + 1);
  if (!isBucket(bucket)) return null;
  try {
    const { brandId } = parseStoragePath(rel);
    return brandIds.has(brandId) ? { bucket, rel } : null;
  } catch {
    return null;
  }
}

async function* entriesFor(plan: Plan, storage: Storage): AsyncGenerator<ZipEntry> {
  const missing: string[] = [];
  yield { name: "README.txt", data: text(EXPORT_README) };
  for (const j of plan.json) yield { name: j.name, data: json(j.value) };

  const seen = new Set<string>(["README.txt", ...plan.json.map((j) => j.name)]);

  for (const f of plan.files) {
    if (seen.has(f.zipName)) continue; // the same stored file named twice
    const loc = splitStored(f.stored, plan.brandIds);
    if (!loc) {
      missing.push(`${f.zipName} (path not usable: ${f.stored})`);
      continue;
    }
    const file = await storage.get(loc.bucket, loc.rel);
    if (!file) {
      missing.push(`${f.zipName} (not found: ${f.stored})`);
      continue;
    }
    seen.add(f.zipName);
    yield { name: f.zipName, data: file.bytes };
  }

  for (const l of plan.lists) {
    for (const rel of await storage.list(l.bucket, l.brandId)) {
      const zipName = `${l.zipPrefix}${rel.slice(l.brandId.length + 1)}`;
      if (seen.has(zipName)) continue;
      const file = await storage.get(l.bucket, rel);
      if (!file) {
        missing.push(`${zipName} (not found)`);
        continue;
      }
      seen.add(zipName);
      yield { name: zipName, data: file.bytes };
    }
  }

  if (missing.length > 0) {
    yield { name: "MISSING-FILES.txt", data: text(`These files could not be added to the export:\n\n${missing.join("\n")}\n`) };
  }
}

/**
 * Starts an export for `userId` and returns the ZIP as a stream. The database is read
 * first (so a failure there is an error, not a half-written file); files are then read and
 * written one at a time as the stream is pulled.
 */
export async function buildExport(
  userId: string,
  opts: { storage?: Storage; now?: Date } = {},
): Promise<ReadableStream<Uint8Array>> {
  if (!UUID_RE.test(userId)) throw new Error("Invalid user id");
  const now = opts.now ?? new Date();
  const data = await readRows(userId);
  const plan = buildPlan(userId, data, now);
  return zipStream(entriesFor(plan, opts.storage ?? getStorage()), now);
}
