import { APP_NAME } from "@/lib/app";
import { getDb } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { fill, s } from "@/lib/i18n/strings";
import { formatDayMonth } from "@/lib/links/format";
import { PAUSED_FOREVER } from "@/lib/links/ops";
import { imageUrl, linkUrl, signLink } from "@/lib/links/tokens";
import { emailSummaryLine, loadEmailSummary, type EmailSummary } from "@/lib/results/email";
import { WEEKDAY_NAMES, addDaysIso, localDateIn, weekdayOf } from "@/lib/occasions/dates";
import { BATCH_STATE_COLUMNS, MAX_CRON_ATTEMPTS, RETRY_WINDOW_MS, STALE_GENERATING_MS, readBatchState, toDate } from "@/lib/weekly/meta";
import {
  FONT,
  COLORS,
  button,
  buttonRow,
  esc,
  footerParts,
  footerRow,
  footerText,
  headerRow,
  paragraph,
  row,
  shell,
} from "./layout";
import { buildLateNotice, buildPausedNotice, type BuiltEmail } from "./notices";

// ---------------------------------------------------------------------------------------------
// Building the weekly email (Req 14, 20, 24; docs/email-links.md section 4)
// ---------------------------------------------------------------------------------------------

export type WeeklyVariant = "normal" | "short";

export interface WeeklyEmailPost {
  id: string;
  /** "YYYY-MM-DD" or null. */
  suggestedDay: string | null;
  channel: string | null;
  caption: string;
  /** Open flags the owner has to look at. */
  flagCount: number;
  /** The square image was rendered. */
  hasImage: boolean;
}

export interface BuildWeeklyInput {
  brand: { id: string; name: string };
  batch: { id: string; weekStart: string; late?: boolean };
  posts: WeeklyEmailPost[];
  /** Monday of last week when it was emailed, for the check-in row; null leaves the row out. */
  lastWeekStart: string | null;
  variant: WeeklyVariant;
  /** V-19: the last 4 weeks in one line; null or left out when there is nothing to show. */
  summary?: EmailSummary | null;
  /** Test clock for the link expiry. */
  now?: Date;
}

const e = s.email;
const SHORT_POSTS = 3;
const MAX_LINE = 220;

/** The first two non-empty lines of a caption (long lines are cut). */
export function captionLines(caption: string): string[] {
  return caption
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((l) => (l.length > MAX_LINE ? `${l.slice(0, MAX_LINE - 1).trimEnd()}…` : l));
}

const channelName = (c: string | null) => (s.week.channels as Record<string, string>)[c ?? ""] ?? "";
const dayName = (d: string | null) => (d ? WEEKDAY_NAMES[weekdayOf(d)] : "");

function heading(p: WeeklyEmailPost): string {
  return fill(e.postHeading, { day: dayName(p.suggestedDay), channel: channelName(p.channel) })
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .trim();
}

const flagNote = (n: number) => (n === 1 ? e.flagOne : fill(e.flagMany, { n }));

export async function buildWeeklyEmail(input: BuildWeeklyInput): Promise<BuiltEmail> {
  const { brand, batch, variant, now } = input;
  const short = variant === "short";
  const posts = short ? input.posts.slice(0, SHORT_POSTS) : input.posts;
  const date = formatDayMonth(batch.weekStart);

  const subject = short
    ? fill(e.subjectShort, { n: Math.min(SHORT_POSTS, input.posts.length) })
    : fill(e.subject, { n: input.posts.length, date });
  const preheader = short ? e.preheaderShort : e.preheader;
  const intro = short ? e.introShort : fill(e.intro, { date });

  const sign = (act: Parameters<typeof signLink>[0]["act"], extra: Partial<Parameters<typeof signLink>[0]> = {}) =>
    signLink({ brandId: brand.id, act, weekStart: batch.weekStart, now, ...extra }).then(linkUrl);

  const [viewWeekUrl, footer] = await Promise.all([sign("view_week"), footerParts(brand.id, now)]);

  // Per post: image, and (normal variant) approve / edit / skip links.
  const cards = await Promise.all(
    posts.map(async (p) => {
      const [img, approve, edit, skip] = await Promise.all([
        p.hasImage
          ? signLink({ brandId: brand.id, postId: p.id, act: "img", extra: { format: "square" }, now }).then(imageUrl)
          : Promise.resolve(null),
        short ? null : sign("approve", { postId: p.id }),
        short ? null : sign("edit", { postId: p.id }),
        short ? null : sign("skip", { postId: p.id }),
      ]);
      return { p, img, approve, edit, skip };
    }),
  );

  const checkin =
    !short && input.lastWeekStart
      ? await Promise.all(
          (["none", "few", "many"] as const).map(async (answer) => ({
            answer,
            label: { none: e.checkinNone, few: e.checkinFew, many: e.checkinMany }[answer],
            url: linkUrl(
              await signLink({ brandId: brand.id, act: "checkin", weekStart: input.lastWeekStart!, extra: { answer }, now }),
            ),
          })),
        )
      : null;

  // ---- HTML ----
  const rows: string[] = [headerRow(brand.name)];
  const introHtml = `${batch.late ? paragraph(e.late, { bold: true, color: COLORS.warnText }) : ""}${paragraph(intro)}`;
  rows.push(row(introHtml, "20px 20px 0 20px"));

  for (const c of cards) {
    const h = heading(c.p);
    const image = c.img
      ? `<img src="${esc(c.img)}" width="560" height="560" alt="${esc(fill(e.imageAlt, { channel: channelName(c.p.channel), day: dayName(c.p.suggestedDay) }))}" style="display:block;width:100%;max-width:560px;height:auto;border:0;outline:none;text-decoration:none;background-color:${COLORS.page};">`
      : "";
    const lines = captionLines(c.p.caption)
      .map((l) => paragraph(l, { margin: "0 0 4px" }))
      .join("");
    const flag =
      c.p.flagCount > 0
        ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${COLORS.warnBg}" style="background-color:${COLORS.warnBg};border-radius:4px;padding:4px 10px;font-family:${FONT};font-size:14px;line-height:20px;font-weight:bold;color:${COLORS.warnText};">${esc(flagNote(c.p.flagCount))}</td></tr></table>`
        : "";
    const buttons =
      c.approve && c.edit && c.skip
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:12px 0 0 0;">${buttonRow([
            { href: c.approve, label: e.approve, kind: "primary" },
            { href: c.edit, label: e.edit, kind: "secondary" },
            { href: c.skip, label: e.skip, kind: "secondary" },
          ])}</td></tr></table>`
        : "";
    rows.push(
      row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${COLORS.line};padding:16px 0 0 0;">
${paragraph(h, { bold: true, margin: "0 0 8px" })}
${image}
<div style="padding:10px 0 0 0;">${lines}</div>
${flag ? `<div style="padding:4px 0 0 0;">${flag}</div>` : ""}
${buttons}
</td></tr></table>`,
        "16px 20px 0 20px",
      ),
    );
  }

  rows.push(row(button(viewWeekUrl, short ? e.seeAndApprove : e.seeAll, short ? "primary" : "secondary", short), "20px 20px 0 20px"));

  if (checkin) {
    rows.push(
      row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${COLORS.line};padding:16px 0 0 0;">
${paragraph(e.checkinTitle, { bold: true, margin: "0 0 8px" })}
${buttonRow(checkin.map((c) => ({ href: c.url, label: c.label })))}
</td></tr></table>`,
        "20px 20px 0 20px",
      ),
    );
  }
  // V-19 (Req 21): one summary line and the "not measured" line, above the footer.
  const summaryLine = !short && input.summary ? emailSummaryLine(input.summary) : null;
  if (summaryLine) {
    rows.push(
      row(
        `${paragraph(summaryLine, { size: 14, margin: "0 0 4px" })}${paragraph(s.results.notMeasured, { size: 12, color: COLORS.muted, margin: "0" })}`,
        "16px 20px 0 20px",
      ),
    );
  }
  rows.push(footerRow(brand.name, footer.links));

  const html = shell({ title: subject, preheader, rows });

  // ---- Plain text: same content, same links ----
  const text: string[] = [`${APP_NAME} - ${fill(e.forBrand, { name: brand.name })}`, ""];
  if (batch.late) text.push(e.late, "");
  text.push(intro, "");
  cards.forEach((c, i) => {
    text.push(`${i + 1}. ${heading(c.p)}`);
    text.push(...captionLines(c.p.caption));
    if (c.p.flagCount > 0) text.push(flagNote(c.p.flagCount));
    if (c.approve && c.edit && c.skip) {
      text.push(`${e.approve}: ${c.approve}`, `${e.edit}: ${c.edit}`, `${e.skip}: ${c.skip}`);
    }
    text.push("");
  });
  text.push(`${short ? e.seeAndApprove : e.seeAll}: ${viewWeekUrl}`, "");
  if (checkin) {
    text.push(e.checkinTitle, ...checkin.map((c) => `${c.label}: ${c.url}`), "");
  }
  if (summaryLine) text.push(summaryLine, s.results.notMeasured, "");
  text.push(...footerText(brand.name, footer.links), "");

  return { subject, html, text: text.join("\n"), headers: footer.headers };
}

// ---------------------------------------------------------------------------------------------
// Sending (service role)
// ---------------------------------------------------------------------------------------------

interface BatchInfo {
  id: string;
  brand_id: string;
  week_start: string;
  status: string;
  error: string | null;
  attempts: number;
  regens: number;
  claimed_at: Date | string | null;
  created_at: Date | string;
  email_sent_at: Date | string | null;
  /** A late notice went out for this batch (so the weekly email says sorry). */
  late: boolean;
}

interface BrandInfo {
  name: string;
  timezone: string;
  pausedUntil: string | null;
  unsubscribed: boolean;
}

interface Recipient {
  userId: string;
  email: string;
}

async function loadBatch(batchId: string): Promise<BatchInfo | null> {
  const [b] = await getDb().withService((tx) =>
    tx.query<BatchInfo>(
      `select id::text as id, brand_id::text as brand_id, week_start::text as week_start, status::text as status,
              ${BATCH_STATE_COLUMNS}, created_at, email_sent_at, late
         from public.weekly_batches where id = $1`,
      [batchId],
    ),
  );
  return b ?? null;
}

async function loadBrand(brandId: string): Promise<BrandInfo | null> {
  const [m] = await getDb().withService((tx) =>
    tx.query<{ name: string; timezone: string | null; paused: string | null; unsub: Date | string | null }>(
      `select coalesce(nullif(trim(m.business_name), ''), b.name) as name, m.timezone,
              m.email_paused_until::text as paused, m.email_unsubscribed_at as unsub
         from public.brands b left join public.brand_memory m on m.brand_id = b.id where b.id = $1`,
      [brandId],
    ),
  );
  return m ? { name: m.name, timezone: m.timezone || "UTC", pausedUntil: m.paused, unsubscribed: Boolean(m.unsub) } : null;
}

/** Emails of the brand's owner members. */
async function loadOwners(brandId: string): Promise<Recipient[]> {
  return getDb().withService((tx) =>
    tx.query<Recipient>(
      `select p.id::text as "userId", p.email as email
         from public.brand_members m join public.profiles p on p.id = m.user_id
        where m.brand_id = $1 and m.role = 'owner' and p.email is not null
        order by m.created_at, p.id`,
      [brandId],
    ),
  );
}

function isPaused(brand: BrandInfo, now: Date): boolean {
  if (!brand.pausedUntil) return false;
  let today: string;
  try {
    today = localDateIn(now, brand.timezone);
  } catch {
    today = now.toISOString().slice(0, 10);
  }
  return today < brand.pausedUntil;
}

/**
 * How many weeks in a row, just before `weekStart`, were emailed and then ignored: the batch's email
 * was sent and it has no post_actions and no check-in at all. Counting stops at the first week that
 * was not emailed or that the owner engaged with.
 */
export async function countMissedWeeks(brandId: string, weekStart: string): Promise<number> {
  const rows = await getDb().withService((tx) =>
    tx.query<{ sent: boolean; engaged: boolean }>(
      `select b.email_sent_at is not null as sent,
              (exists (select 1 from public.post_actions a join public.posts p on p.id = a.post_id and p.brand_id = a.brand_id
                        where p.batch_id = b.id)
               or exists (select 1 from public.checkins c where c.brand_id = b.brand_id and c.week_start = b.week_start)) as engaged
         from public.weekly_batches b
        where b.brand_id = $1 and b.week_start < $2::date
        order by b.week_start desc limit 12`,
      [brandId, weekStart],
    ),
  );
  let missed = 0;
  for (const r of rows) {
    if (!r.sent || r.engaged) break;
    missed += 1;
  }
  return missed;
}

export const MISSED_WEEKS_SHORT = 2;
export const MISSED_WEEKS_PAUSE = 4;

export type SendWeeklyResult =
  | { status: "sent"; variant: WeeklyVariant; recipients: number; late: boolean }
  | { status: "paused_notice"; recipients: number }
  | {
      status: "skipped";
      reason: "not_found" | "not_ready" | "already_sent" | "unsubscribed" | "paused" | "no_recipients" | "no_posts";
    }
  | { status: "failed"; error: string };

/**
 * Emails the week's posts to the brand's owners, once per batch (email_sent_at). Skips a brand that
 * unsubscribed or paused. After 2 or 3 ignored weeks it sends the short version; after 4 it pauses
 * the brand and sends the "we paused your posts" notice instead (PRD section 8). A batch that
 * failed first and got a late notice (which sets late = true) goes out with "Sorry these are late".
 */
export async function sendWeeklyEmail(batchId: string, opts: { now?: Date } = {}): Promise<SendWeeklyResult> {
  const now = opts.now ?? new Date();
  const batch = await loadBatch(batchId);
  if (!batch) return { status: "skipped", reason: "not_found" };
  if (batch.status !== "ready") return { status: "skipped", reason: "not_ready" };
  if (batch.email_sent_at) return { status: "skipped", reason: "already_sent" };
  const brand = await loadBrand(batch.brand_id);
  if (!brand) return { status: "skipped", reason: "not_found" };
  if (brand.unsubscribed) return { status: "skipped", reason: "unsubscribed" };
  if (isPaused(brand, now)) return { status: "skipped", reason: "paused" };

  const owners = await loadOwners(batch.brand_id);
  if (owners.length === 0) return { status: "skipped", reason: "no_recipients" };

  const missed = await countMissedWeeks(batch.brand_id, batch.week_start);

  if (missed >= MISSED_WEEKS_PAUSE) {
    // Only the call that flips the pause sends the notice.
    const flipped = await getDb().withService((tx) =>
      tx.query<{ brand_id: string }>(
        `update public.brand_memory set email_paused_until = $2::date
          where brand_id = $1 and email_paused_until is distinct from $2::date returning brand_id::text as brand_id`,
        [batch.brand_id, PAUSED_FOREVER],
      ),
    );
    if (flipped.length === 0) return { status: "skipped", reason: "paused" };
    const notice = await buildPausedNotice({ brand: { id: batch.brand_id, name: brand.name }, now });
    let sent = 0;
    for (const o of owners) {
      try {
        await sendEmail({ to: o.email, userId: o.userId, brandId: batch.brand_id, kind: "paused_notice", ...notice });
        sent += 1;
      } catch (err) {
        console.error(`[email] paused notice failed for brand ${batch.brand_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    console.info(`[email] paused brand ${batch.brand_id} after ${missed} ignored weeks`);
    return { status: "paused_notice", recipients: sent };
  }

  const posts = await getDb().withService((tx) =>
    tx.query<{
      id: string;
      suggested_day: string | null;
      channel: string | null;
      caption: string | null;
      fact_flags: Array<{ status?: string; kind?: string }> | null;
      has_image: boolean;
    }>(
      `select p.id::text as id, p.suggested_day::text as suggested_day, p.channel::text as channel, p.caption, p.fact_flags,
              exists (select 1 from public.post_images i where i.post_id = p.id and i.brand_id = p.brand_id and i.format = 'square') as has_image
         from public.posts p where p.batch_id = $1 and p.brand_id = $2
        order by p.suggested_day, p.created_at, p.id`,
      [batch.id, batch.brand_id],
    ),
  );
  if (posts.length === 0) return { status: "skipped", reason: "no_posts" };

  const [previous] = await getDb().withService((tx) =>
    tx.query<{ n: number }>(
      `select count(*)::int as n from public.weekly_batches where brand_id = $1 and week_start = $2::date and email_sent_at is not null`,
      [batch.brand_id, addDaysIso(batch.week_start, -7)],
    ),
  );
  const lastWeekStart = (previous?.n ?? 0) > 0 ? addDaysIso(batch.week_start, -7) : null;
  const late = batch.late;
  const variant: WeeklyVariant = missed >= MISSED_WEEKS_SHORT ? "short" : "normal";

  // Claim the send: only one caller gets the row back.
  const claimed = await getDb().withService((tx) =>
    tx.query<{ id: string }>(
      `update public.weekly_batches set email_sent_at = $2::timestamptz where id = $1 and email_sent_at is null returning id::text as id`,
      [batch.id, now.toISOString()],
    ),
  );
  if (claimed.length === 0) return { status: "skipped", reason: "already_sent" };

  const release = () =>
    getDb()
      .withService((tx) => tx.query("update public.weekly_batches set email_sent_at = null where id = $1", [batch.id]))
      .catch((err) => console.error(`[email] could not release batch ${batch.id}: ${err instanceof Error ? err.message : String(err)}`));

  let built: BuiltEmail;
  try {
    // V-19: a failed summary lookup must not stop the weekly email.
    const summary = await loadEmailSummary(batch.brand_id, now).catch(() => null);
    built = await buildWeeklyEmail({
      brand: { id: batch.brand_id, name: brand.name },
      batch: { id: batch.id, weekStart: batch.week_start, late },
      posts: posts.map((p) => ({
        id: p.id,
        suggestedDay: p.suggested_day,
        channel: p.channel,
        caption: p.caption ?? "",
        flagCount: (p.fact_flags ?? []).filter((f) => f.status === "open" && f.kind !== "regulated_reminder").length,
        hasImage: p.has_image,
      })),
      lastWeekStart,
      variant,
      summary,
      now,
    });
  } catch (err) {
    await release();
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }

  let sent = 0;
  let lastError = "";
  for (const o of owners) {
    try {
      await sendEmail({ to: o.email, userId: o.userId, brandId: batch.brand_id, kind: "weekly", ...built });
      sent += 1;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[email] weekly email failed for brand ${batch.brand_id}: ${lastError}`);
    }
  }
  if (sent === 0) {
    await release();
    return { status: "failed", error: lastError || "no email could be sent" };
  }
  console.info(`[email] weekly sent brand=${batch.brand_id} week=${batch.week_start} variant=${variant} late=${late} recipients=${sent}`);
  return { status: "sent", variant, recipients: sent, late };
}

export type SendLateResult =
  | { status: "sent"; recipients: number }
  | { status: "skipped"; reason: "not_found" | "not_failed" | "retries_left" | "already_sent" | "unsubscribed" | "paused" | "no_recipients" }
  | { status: "failed"; error: string };

/**
 * "This week's posts are running late." Sent once per batch, and only when the batch failed and the
 * automatic retries are used up (3 attempts, or more than 24 hours since it started).
 */
export async function sendLateNotice(batchId: string, opts: { now?: Date } = {}): Promise<SendLateResult> {
  const now = opts.now ?? new Date();
  const batch = await loadBatch(batchId);
  if (!batch) return { status: "skipped", reason: "not_found" };
  const meta = readBatchState(batch);
  const crashed =
    batch.status === "generating" &&
    now.getTime() - (meta.claimedAt ? new Date(meta.claimedAt) : toDate(batch.created_at)).getTime() > STALE_GENERATING_MS;
  if (batch.status !== "failed" && !crashed) return { status: "skipped", reason: "not_failed" };
  const exhausted =
    Math.max(1, meta.attempts) >= MAX_CRON_ATTEMPTS || now.getTime() - toDate(batch.created_at).getTime() >= RETRY_WINDOW_MS;
  if (!exhausted) return { status: "skipped", reason: "retries_left" };

  const brand = await loadBrand(batch.brand_id);
  if (!brand) return { status: "skipped", reason: "not_found" };
  if (brand.unsubscribed) return { status: "skipped", reason: "unsubscribed" };
  if (isPaused(brand, now)) return { status: "skipped", reason: "paused" };
  if (batch.late) return { status: "skipped", reason: "already_sent" };
  const owners = await loadOwners(batch.brand_id);
  if (owners.length === 0) return { status: "skipped", reason: "no_recipients" };

  // `late` is the once-per-batch marker: only the call that flips it sends the notice.
  const flipped = await getDb().withService((tx) =>
    tx.query<{ id: string }>("update public.weekly_batches set late = true where id = $1 and late = false returning id::text as id", [batch.id]),
  );
  if (flipped.length === 0) return { status: "skipped", reason: "already_sent" };

  const notice = await buildLateNotice({ brand: { id: batch.brand_id, name: brand.name }, now });
  let sent = 0;
  let lastError = "";
  for (const o of owners) {
    try {
      await sendEmail({ to: o.email, userId: o.userId, brandId: batch.brand_id, kind: "late_notice", ...notice });
      sent += 1;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[email] late notice failed for brand ${batch.brand_id}: ${lastError}`);
    }
  }
  if (sent === 0) {
    await getDb()
      .withService((tx) => tx.query("update public.weekly_batches set late = false where id = $1", [batch.id]))
      .catch(() => undefined);
    return { status: "failed", error: lastError || "no email could be sent" };
  }
  console.info(`[email] late notice sent brand=${batch.brand_id} week=${batch.week_start} recipients=${sent}`);
  return { status: "sent", recipients: sent };
}
