import { BrandAccessError } from "@/lib/brand/current";
import { getDb } from "@/lib/db";
import { fill, s } from "@/lib/i18n/strings";
import type { CheckinAnswer } from "@/lib/links/ops";
import { addDaysIso, localDateIn } from "@/lib/occasions/dates";
import { qrScansByPost } from "@/lib/qr/link";
import { scanCopy } from "@/lib/qr/copy";
import { clicksByPost } from "@/lib/shortlinks";
import { lastWeekStartFor } from "./checkin";
import { clicksPhrase, monthName, monthStartOf, postsPhrase, timeSavedPhrase, zonedMidnight } from "./format";

// The plain-language results summary (Req 21), read as the signed-in user (row-level security).
// Honest about what it cannot see: clicks undercount, and messages, calls and walk-ins are only
// known through the weekly check-in.

const r = s.results;

export const CHECKIN_WEEKS = 6;
const TOPIC_MAX = 80;

export interface PostClicks {
  postId: string;
  /** original.topic, else the first caption line. */
  topic: string;
  channel: string | null;
  /** The day the post was planned for ("YYYY-MM-DD"), or null. */
  day: string | null;
  clicks: number;
}

export interface CheckinWeek {
  weekStart: string;
  answer: CheckinAnswer | null;
  /** "None", "A few", "Many" or "Not answered". */
  label: string;
}

export interface Summary {
  /** A new owner with nothing to show yet: show the empty-state sentence. */
  empty: boolean;
  timezone: string;
  thisMonth: { start: string; name: string };
  lastMonth: { start: string; name: string };
  shared: { thisMonth: number; lastMonth: number; change: number; line: string };
  time: {
    minutesPerPost: number | null;
    minutesSaved: number | null;
    /** "about 3 hours", or null when there is nothing to show. */
    text: string | null;
    /** The sentence to show, or null when minutes_per_post is not set. */
    line: string | null;
    /** minutes_per_post is not set: show the prompt linking to settings. */
    needsMinutes: boolean;
    prompt: string;
  };
  clicks: {
    thisMonth: PostClicks[];
    lastMonth: PostClicks[];
    totalThisMonth: number;
    totalLastMonth: number;
    top: PostClicks | null;
    line: string;
    footnote: string;
  };
  /** QR code scans, counted apart from link clicks (clicks.source = 'qr'). `thisMonth` and `lastMonth` reuse PostClicks: `clicks` is the scan count. */
  scans: {
    thisMonth: PostClicks[];
    lastMonth: PostClicks[];
    totalThisMonth: number;
    totalLastMonth: number;
    line: string;
    footnote: string;
  };
  /** Newest first: last week, the week before, and so on. */
  checkins: CheckinWeek[];
  notMeasured: string;
}

export const checkinLabel = (a: CheckinAnswer | null): string =>
  a === "none" ? r.checkinsNone : a === "few" ? r.checkinsFew : a === "many" ? r.checkinsMany : r.checkinsUnanswered;

function sharedLine(thisN: number, lastN: number, lastMonthName: string): string {
  if (thisN === 0) {
    return lastN === 0 ? r.sharedNoneNow : fill(r.sharedNoneNowBefore, { month: lastMonthName, last: postsPhrase(lastN) });
  }
  const vars = { n: postsPhrase(thisN), last: String(lastN), month: lastMonthName };
  if (lastN === 0) return fill(r.sharedFirst, vars);
  if (thisN > lastN) return fill(r.sharedUp, vars);
  if (thisN < lastN) return fill(r.sharedDown, vars);
  return fill(r.sharedSame, vars);
}

function topicOf(topic: string | null, caption: string | null): string {
  const t =
    (topic ?? "").trim() ||
    (caption ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) ||
    "";
  if (!t) return r.untitledPost;
  return t.length > TOPIC_MAX ? `${t.slice(0, TOPIC_MAX - 1).trimEnd()}…` : t;
}

interface PostRow {
  id: string;
  channel: string | null;
  suggested_day: string | null;
  topic: string | null;
  caption: string | null;
  in_this: boolean;
  in_last: boolean;
}

/**
 * "Posts shared" in a window: posts with posted_at in the window, or with a `share` action in it.
 * A post counts once however many times it was shared or marked posted.
 */
const SHARED_IN = (from: string, to: string) =>
  `(p.posted_at >= ${from}::timestamptz and p.posted_at < ${to}::timestamptz
    or exists (select 1 from public.post_actions a
                where a.post_id = p.id and a.brand_id = p.brand_id and a.action = 'share'
                  and a.created_at >= ${from}::timestamptz and a.created_at < ${to}::timestamptz))`;

export async function buildSummary(userId: string, brandId: string, now: Date = new Date()): Promise<Summary> {
  const meta = await getDb().withUser(userId, async (tx) => {
    const [m] = await tx.query<{ ok: boolean; timezone: string | null; minutes: number | null }>(
      `select public.is_brand_member($1::uuid) as ok,
              (select timezone from public.brand_memory where brand_id = $1) as timezone,
              (select minutes_per_post from public.brand_memory where brand_id = $1) as minutes`,
      [brandId],
    );
    if (!m?.ok) throw new BrandAccessError();
    return { timezone: m.timezone || "UTC", minutes: m.minutes };
  });
  const { timezone } = meta;

  // Calendar months in the brand's time zone, as instants.
  const today = localDateIn(now, timezone);
  const thisStart = monthStartOf(today);
  const lastStart = monthStartOf(today, -1);
  const nextStart = monthStartOf(today, 1);
  const lastFrom = zonedMidnight(lastStart, timezone);
  const thisFrom = zonedMidnight(thisStart, timezone);
  const nextFrom = zonedMidnight(nextStart, timezone);

  const clicksThis = await clicksByPost(userId, brandId, { from: thisFrom, to: nextFrom });
  const clicksLast = await clicksByPost(userId, brandId, { from: lastFrom, to: thisFrom });
  const scansThis = await qrScansByPost(userId, brandId, { from: thisFrom, to: nextFrom });
  const scansLast = await qrScansByPost(userId, brandId, { from: lastFrom, to: thisFrom });

  // Check-in weeks, newest first.
  const lastWeek = lastWeekStartFor(now, timezone);
  const weeks = Array.from({ length: CHECKIN_WEEKS }, (_, i) => addDaysIso(lastWeek, -7 * i));

  const { posts, answers } = await getDb().withUser(userId, async (tx) => {
    // $2 = start of this month, $3 = start of next month, $4 = start of last month.
    const posts = await tx.query<PostRow>(
      `select p.id::text as id, p.channel::text as channel, p.suggested_day::text as suggested_day,
              p.original->>'topic' as topic, p.caption,
              ${SHARED_IN("$2", "$3")} as in_this,
              ${SHARED_IN("$4", "$2")} as in_last
         from public.posts p
        where p.brand_id = $1
          and (${SHARED_IN("$4", "$3")}
               or exists (select 1 from public.clicks c
                           where c.post_id = p.id and c.brand_id = p.brand_id
                             and c.clicked_at >= $4::timestamptz and c.clicked_at < $3::timestamptz))`,
      [brandId, thisFrom.toISOString(), nextFrom.toISOString(), lastFrom.toISOString()],
    );
    const answers = await tx.query<{ week_start: string; answer: CheckinAnswer }>(
      `select week_start::text as week_start, answer::text as answer from public.checkins
        where brand_id = $1 and week_start >= $2::date and week_start <= $3::date`,
      [brandId, weeks[weeks.length - 1], weeks[0]],
    );
    return { posts, answers };
  });

  const byId = new Map(posts.map((p) => [p.id, p]));
  const toClicks = (rows: { postId: string; clicks: number }[]): PostClicks[] =>
    rows.map((c) => {
      const p = byId.get(c.postId);
      return {
        postId: c.postId,
        topic: topicOf(p?.topic ?? null, p?.caption ?? null),
        channel: p?.channel ?? null,
        day: p?.suggested_day ?? null,
        clicks: c.clicks,
      };
    });
  const clicksThisList = toClicks(clicksThis);
  const clicksLastList = toClicks(clicksLast);
  const totalThis = clicksThisList.reduce((n, c) => n + c.clicks, 0);
  const totalLast = clicksLastList.reduce((n, c) => n + c.clicks, 0);
  const top = clicksThisList[0] ?? null;
  const scansThisList = toClicks(scansThis.map((x) => ({ postId: x.postId, clicks: x.scans })));
  const scansLastList = toClicks(scansLast.map((x) => ({ postId: x.postId, clicks: x.scans })));
  const scanTotalThis = scansThisList.reduce((n, c) => n + c.clicks, 0);
  const scanTotalLast = scansLastList.reduce((n, c) => n + c.clicks, 0);

  const sharedThis = posts.filter((p) => p.in_this).length;
  const sharedLast = posts.filter((p) => p.in_last).length;
  const lastMonthName = monthName(lastStart);

  const minutesSaved = meta.minutes == null ? null : sharedThis * meta.minutes;
  const timeText = minutesSaved == null ? null : timeSavedPhrase(minutesSaved);
  const timeLine = meta.minutes == null ? null : timeText ? fill(r.timeSaved, { time: timeText }) : r.timeNone;

  const answerByWeek = new Map(answers.map((a) => [a.week_start, a.answer]));
  const checkins = weeks.map((weekStart) => {
    const answer = answerByWeek.get(weekStart) ?? null;
    return { weekStart, answer, label: checkinLabel(answer) };
  });

  const clicksLine =
    totalThis === 0
      ? r.clicksNone
      : [
          fill(r.clicksTotal, { clicks: clicksPhrase(totalThis) }),
          top ? fill(r.clicksTop, { topic: top.topic, clicks: clicksPhrase(top.clicks) }) : "",
        ]
          .filter(Boolean)
          .join(" ");

  const empty =
    sharedThis === 0 && sharedLast === 0 && totalThis === 0 && totalLast === 0 && scanTotalThis === 0 && scanTotalLast === 0 && !checkins.some((c) => c.answer !== null);

  return {
    empty,
    timezone,
    thisMonth: { start: thisStart, name: monthName(thisStart) },
    lastMonth: { start: lastStart, name: lastMonthName },
    shared: {
      thisMonth: sharedThis,
      lastMonth: sharedLast,
      change: sharedThis - sharedLast,
      line: sharedLine(sharedThis, sharedLast, lastMonthName),
    },
    time: {
      minutesPerPost: meta.minutes,
      minutesSaved,
      text: timeText,
      line: timeLine,
      needsMinutes: meta.minutes == null,
      prompt: r.timeNeedsMinutes,
    },
    clicks: {
      thisMonth: clicksThisList,
      lastMonth: clicksLastList,
      totalThisMonth: totalThis,
      totalLastMonth: totalLast,
      top,
      line: clicksLine,
      footnote: r.clicksFootnote,
    },
    scans: {
      thisMonth: scansThisList,
      lastMonth: scansLastList,
      totalThisMonth: scanTotalThis,
      totalLastMonth: scanTotalLast,
      line: scanTotalThis === 0 ? scanCopy.none : scanCopy.total(scanTotalThis),
      footnote: scanCopy.footnote,
    },
    checkins,
    notMeasured: r.notMeasured,
  };
}
