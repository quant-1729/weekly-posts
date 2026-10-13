// The "ready to share" reminder (Req 25): if approved posts are not marked Posted within 3 days,
// the owner gets ONE short email with a Share link for each. At most one per weekly batch, so one
// per week. The hourly cron route (src/app/api/cron/reminders/route.ts) calls sendPostingReminders.
//
// A batch is due when it has approved posts with no posted_at, the earliest approved_at among them
// is 72 hours or more ago (and under 14 days: the links in the email last 14 days), the batch has
// not been reminded, and the brand has not unsubscribed or paused. weekly_batches.reminder_sent_at
// is the once-per-batch marker: only the run that sets it sends. A send that fails for every owner
// clears it again, so the next hourly run retries; after 3 failed attempts (counted in email_log) it
// stops.

import { APP_NAME } from "@/lib/app";
import { getDb } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { COLORS, FONT, button, esc, footerParts, footerRow, footerText, headerRow, paragraph, row, shell } from "@/lib/email/layout";
import type { BuiltEmail } from "@/lib/email/notices";
import { captionLines } from "@/lib/email/weekly";
import { fill, s } from "@/lib/i18n/strings";
import { imageUrl, linkUrl, signLink } from "@/lib/links/tokens";
import { WEEKDAY_NAMES, localDateIn, weekdayOf } from "@/lib/occasions/dates";

export const REMINDER_AFTER_MS = 72 * 3600 * 1000;
/** Do not remind about approvals older than this (the emailed links last 14 days). */
export const REMINDER_MAX_AGE_MS = 14 * 24 * 3600 * 1000;
export const MAX_REMINDER_ATTEMPTS = 3;

const r = s.share.reminder;

// ---------------------------------------------------------------------------------------------
// Building the email
// ---------------------------------------------------------------------------------------------

export interface ReminderPost {
  id: string;
  suggestedDay: string | null;
  channel: string | null;
  caption: string;
  hasImage: boolean;
}

export interface BuildReminderInput {
  brand: { id: string; name: string };
  weekStart: string;
  posts: ReminderPost[];
  /** Test clock for the link expiry. */
  now?: Date;
}

const channelName = (c: string | null) => (s.week.channels as Record<string, string>)[c ?? ""] ?? "";
const dayName = (d: string | null) => (d ? WEEKDAY_NAMES[weekdayOf(d)] : "");
const heading = (p: ReminderPost) =>
  fill(s.email.postHeading, { day: dayName(p.suggestedDay), channel: channelName(p.channel) })
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .trim();

export async function buildReminderEmail(input: BuildReminderInput): Promise<BuiltEmail> {
  const { brand, now } = input;
  const n = input.posts.length;
  const subject = n === 1 ? r.subjectOne : fill(r.subjectMany, { n });

  const footer = await footerParts(brand.id, now);
  const cards = await Promise.all(
    input.posts.map(async (p) => ({
      p,
      img: p.hasImage ? imageUrl(await signLink({ brandId: brand.id, postId: p.id, act: "img", extra: { format: "square" }, now })) : null,
      share: linkUrl(await signLink({ brandId: brand.id, postId: p.id, act: "ready", weekStart: input.weekStart, now })),
    })),
  );

  const rows: string[] = [headerRow(brand.name)];
  rows.push(row(`${paragraph(subject, { size: 20, bold: true, margin: "0 0 8px" })}${paragraph(`${r.intro} ${r.introHelp}`)}`, "20px 20px 0 20px"));
  for (const c of cards) {
    const thumb = c.img
      ? `<img src="${esc(c.img)}" width="120" height="120" alt="${esc(fill(r.imageAlt, { channel: channelName(c.p.channel) }))}" style="display:block;width:120px;height:120px;border:0;outline:none;text-decoration:none;background-color:${COLORS.page};">`
      : `<table role="presentation" width="120" cellpadding="0" cellspacing="0" border="0"><tr><td width="120" height="120" align="center" bgcolor="${COLORS.page}" style="background-color:${COLORS.page};font-family:${FONT};font-size:13px;color:${COLORS.muted};">${esc(r.noImage)}</td></tr></table>`;
    const first = captionLines(c.p.caption)[0] ?? "";
    rows.push(
      row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${COLORS.line};padding:16px 0 0 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="132" valign="top" style="width:132px;padding:0 12px 0 0;">${thumb}</td>
<td valign="top" style="padding:0;">${paragraph(heading(c.p), { bold: true, margin: "0 0 4px" })}${first ? paragraph(first, { margin: "0 0 10px", size: 15 }) : ""}${button(c.share, r.share, "primary")}</td>
</tr></table>
</td></tr></table>`,
        "16px 20px 0 20px",
      ),
    );
  }
  rows.push(footerRow(brand.name, footer.links));

  const html = shell({ title: subject, preheader: r.preheader, rows });
  const text: string[] = [`${APP_NAME} - ${fill(s.email.forBrand, { name: brand.name })}`, "", subject, `${r.intro} ${r.introHelp}`, ""];
  cards.forEach((c, i) => {
    text.push(`${i + 1}. ${heading(c.p)}`);
    const first = captionLines(c.p.caption)[0];
    if (first) text.push(first);
    text.push(`${r.share}: ${c.share}`, "");
  });
  text.push(...footerText(brand.name, footer.links), "");
  return { subject, html, text: text.join("\n"), headers: footer.headers };
}

// ---------------------------------------------------------------------------------------------
// Which batches are due, and sending
// ---------------------------------------------------------------------------------------------

export interface DueReminder {
  batchId: string;
  brandId: string;
  weekStart: string;
  /** The earliest approval among the unposted approved posts. */
  firstApprovedAt: Date;
  unposted: number;
  timezone: string;
  pausedUntil: string | null;
}

interface DueRow {
  batch_id: string;
  brand_id: string;
  week_start: string;
  first_approved: Date | string;
  n: number;
  timezone: string | null;
  paused_until: string | null;
}

function isPaused(d: { timezone: string; pausedUntil: string | null }, now: Date): boolean {
  if (!d.pausedUntil) return false;
  let today: string;
  try {
    today = localDateIn(now, d.timezone);
  } catch {
    today = now.toISOString().slice(0, 10);
  }
  return today < d.pausedUntil;
}

/** Batches that should get a reminder now (service role). Paused brands are left out here. */
export async function dueReminders(now: Date = new Date()): Promise<DueReminder[]> {
  const rows = await getDb().withService((tx) =>
    tx.query<DueRow>(
      `select b.id::text as batch_id, b.brand_id::text as brand_id, b.week_start::text as week_start,
              min(p.approved_at) as first_approved, count(*)::int as n,
              m.timezone, m.email_paused_until::text as paused_until
         from public.weekly_batches b
         join public.posts p on p.batch_id = b.id and p.brand_id = b.brand_id
         join public.brand_memory m on m.brand_id = b.brand_id
        where b.reminder_sent_at is null and b.status = 'ready'
          and p.status = 'approved' and p.posted_at is null and p.approved_at is not null
          and m.email_unsubscribed_at is null
        group by b.id, b.brand_id, b.week_start, m.timezone, m.email_paused_until
       having min(p.approved_at) <= $1::timestamptz and min(p.approved_at) > $2::timestamptz
        order by min(p.approved_at), b.id`,
      [new Date(now.getTime() - REMINDER_AFTER_MS).toISOString(), new Date(now.getTime() - REMINDER_MAX_AGE_MS).toISOString()],
    ),
  );
  return rows
    .map((x) => ({
      batchId: x.batch_id,
      brandId: x.brand_id,
      weekStart: x.week_start,
      firstApprovedAt: new Date(x.first_approved),
      unposted: x.n,
      timezone: x.timezone || "UTC",
      pausedUntil: x.paused_until,
    }))
    .filter((d) => !isPaused(d, now));
}

export type ReminderOutcome = "sent" | "no_owner" | "gave_up" | "already_sent" | "nothing_to_send" | "failed";

export interface ReminderItem {
  batchId: string;
  brandId: string;
  outcome: ReminderOutcome;
  /** For `failed` and `gave_up`: how many sends have failed so far, this one included. */
  attempts?: number;
  recipients?: number;
  error?: string;
}

export interface ReminderSummary {
  due: number;
  sent: number;
  failed: number;
  skipped: number;
  items: ReminderItem[];
}

interface Owner {
  userId: string;
  email: string;
}

async function loadOwners(brandId: string): Promise<Owner[]> {
  return getDb().withService((tx) =>
    tx.query<Owner>(
      `select p.id::text as "userId", p.email as email
         from public.brand_members m join public.profiles p on p.id = m.user_id
        where m.brand_id = $1 and m.role = 'owner' and p.email is not null
        order by m.created_at, p.id`,
      [brandId],
    ),
  );
}

/**
 * The attempt counter. When a send fails for every owner, the run writes one extra failed row to
 * email_log with this subject (it names the batch), and the cap counts them. Counting by subject
 * keeps one week's failures from counting against another week, and does not depend on clocks.
 */
const attemptSubject = (batchId: string) => `Reminder attempt failed (batch ${batchId})`;

async function failedAttempts(batchId: string): Promise<number> {
  const [row] = await getDb().withService((tx) =>
    tx.query<{ n: number }>(`select count(*)::int as n from public.email_log where kind = 'reminder' and status = 'failed' and subject = $1`, [attemptSubject(batchId)]),
  );
  return row?.n ?? 0;
}

async function recordFailedAttempt(d: DueReminder, owner: Owner, error: string): Promise<void> {
  await getDb()
    .withService((tx) =>
      tx.query(
        `insert into public.email_log (brand_id, user_id, kind, to_email, subject, status, error) values ($1, $2, 'reminder', $3, $4, 'failed', $5)`,
        [d.brandId, owner.userId, owner.email, attemptSubject(d.batchId), error.slice(0, 500)],
      ),
    )
    .catch((err) => console.error(`[reminder] could not record the failed attempt: ${err instanceof Error ? err.message : String(err)}`));
}

async function sendOne(d: DueReminder, now: Date): Promise<ReminderItem> {
  const base = { batchId: d.batchId, brandId: d.brandId };
  const owners = await loadOwners(d.brandId);
  if (owners.length === 0) return { ...base, outcome: "no_owner" };

  const before = await failedAttempts(d.batchId);
  if (before >= MAX_REMINDER_ATTEMPTS) return { ...base, outcome: "gave_up", attempts: before };

  // Claim the batch: only the run that flips reminder_sent_at sends.
  const claimed = await getDb().withService((tx) =>
    tx.query<{ id: string }>(
      `update public.weekly_batches set reminder_sent_at = $2::timestamptz where id = $1 and reminder_sent_at is null returning id::text as id`,
      [d.batchId, now.toISOString()],
    ),
  );
  if (claimed.length === 0) return { ...base, outcome: "already_sent" };
  const release = () =>
    getDb()
      .withService((tx) => tx.query("update public.weekly_batches set reminder_sent_at = null where id = $1", [d.batchId]))
      .catch((err) => console.error(`[reminder] could not release batch ${d.batchId}: ${err instanceof Error ? err.message : String(err)}`));

  let built: BuiltEmail | null = null;
  let lastError = "";
  try {
    const { posts, brandName } = await getDb().withService(async (tx) => ({
      posts: await tx.query<{ id: string; suggested_day: string | null; channel: string | null; caption: string | null; has_image: boolean }>(
        `select p.id::text as id, p.suggested_day::text as suggested_day, p.channel::text as channel, p.caption,
                exists (select 1 from public.post_images i where i.post_id = p.id and i.brand_id = p.brand_id and i.format = 'square') as has_image
           from public.posts p
          where p.batch_id = $1 and p.brand_id = $2 and p.status = 'approved' and p.posted_at is null
          order by p.suggested_day, p.created_at, p.id`,
        [d.batchId, d.brandId],
      ),
      brandName: (
        await tx.query<{ name: string }>(
          `select coalesce(nullif(trim(m.business_name), ''), b.name) as name from public.brands b left join public.brand_memory m on m.brand_id = b.id where b.id = $1`,
          [d.brandId],
        )
      )[0]?.name,
    }));
    if (posts.length === 0) {
      // Everything was posted in the meantime: nothing to remind about. Give the claim back so a
      // later approval in this batch can still be reminded.
      await release();
      return { ...base, outcome: "nothing_to_send" };
    }
    built = await buildReminderEmail({
      brand: { id: d.brandId, name: brandName ?? "" },
      weekStart: d.weekStart,
      posts: posts.map((p) => ({ id: p.id, suggestedDay: p.suggested_day, channel: p.channel, caption: p.caption ?? "", hasImage: p.has_image })),
      now,
    });
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  }

  let sent = 0;
  if (built) {
    for (const o of owners) {
      try {
        await sendEmail({ to: o.email, userId: o.userId, brandId: d.brandId, kind: "reminder", ...built });
        sent += 1;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.error(`[reminder] send failed for brand ${d.brandId}: ${lastError}`);
      }
    }
  }
  if (sent === 0) {
    await recordFailedAttempt(d, owners[0], lastError || "no email could be sent");
    await release();
    return { ...base, outcome: "failed", attempts: before + 1, error: lastError || "no email could be sent" };
  }
  console.info(`[reminder] sent brand=${d.brandId} week=${d.weekStart} recipients=${sent}`);
  return { ...base, outcome: "sent", recipients: sent };
}

/** Sends the reminders that are due. One failing brand does not stop the others. */
export async function sendPostingReminders(opts: { now?: Date } = {}): Promise<ReminderSummary> {
  const now = opts.now ?? new Date();
  const due = await dueReminders(now);
  const items: ReminderItem[] = [];
  for (const d of due) {
    try {
      items.push(await sendOne(d, now));
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[reminder] batch ${d.batchId} crashed: ${error}`);
      items.push({ batchId: d.batchId, brandId: d.brandId, outcome: "failed", error });
    }
  }
  return {
    due: due.length,
    sent: items.filter((i) => i.outcome === "sent").length,
    failed: items.filter((i) => i.outcome === "failed").length,
    skipped: items.filter((i) => i.outcome !== "sent" && i.outcome !== "failed").length,
    items,
  };
}
