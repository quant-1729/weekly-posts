import { getDb } from "@/lib/db";
import { fill, s } from "@/lib/i18n/strings";
import { APP_NAME } from "@/lib/app";
import { addDaysIso, localDateIn } from "@/lib/occasions/dates";
import { formatDayMonth } from "./format";
import { registerLinkHandler, type LinkContext, type LinkHandler } from "./handlers";
import { logBrandAction } from "./log";
import { CHECKIN_ANSWERS, isCheckinAnswer, setEmailPausedUntil, setEmailUnsubscribed, upsertCheckin, type CheckinAnswer } from "./ops";
import { buttonStyle, esc, messagePage, para, postForm, signInLink, type LinkPage } from "./page";
import { signLink } from "./tokens";

const t = s.links;
const vars = { appName: APP_NAME };

const answerLabel = (a: CheckinAnswer) => ({ none: t.checkinNone, few: t.checkinFew, many: t.checkinMany })[a];

function formValue(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

// ---------------------------------------------------------------------------------------------
// view_week: read-only list of the week's posts
// ---------------------------------------------------------------------------------------------

interface WeekPostRow {
  id: string;
  suggested_day: string | null;
  channel: string | null;
  status: string;
  caption: string | null;
  fact_flags: Array<{ status?: string; kind?: string; text?: string }> | null;
  has_image: boolean;
}

const statusLabel = (st: string) =>
  ({ approved: t.status.approved, skipped: t.status.skipped, posted: t.status.posted })[st as "approved"] ?? t.status.draft;

async function viewWeek(ctx: LinkContext): Promise<LinkPage> {
  const { brand, claims } = ctx;
  const { weekStart, posts } = await getDb().withService(async (tx) => {
    const [batch] = await tx.query<{ id: string; week_start: string }>(
      claims.weekStart
        ? `select id::text as id, week_start::text as week_start from public.weekly_batches where brand_id = $1 and week_start = $2::date`
        : `select id::text as id, week_start::text as week_start from public.weekly_batches where brand_id = $1 and status = 'ready' order by week_start desc limit 1`,
      claims.weekStart ? [brand.id, claims.weekStart] : [brand.id],
    );
    if (!batch) return { weekStart: claims.weekStart ?? null, posts: [] as WeekPostRow[] };
    const rows = await tx.query<WeekPostRow>(
      `select p.id::text as id, p.suggested_day::text as suggested_day, p.channel::text as channel, p.status::text as status,
              p.caption, p.fact_flags,
              exists (select 1 from public.post_images i where i.post_id = p.id and i.brand_id = p.brand_id and i.format = 'square') as has_image
         from public.posts p where p.batch_id = $1 and p.brand_id = $2
        order by p.suggested_day, p.created_at, p.id`,
      [batch.id, brand.id],
    );
    return { weekStart: batch.week_start, posts: rows };
  });

  const title = weekStart ? fill(t.weekTitle, { date: formatDayMonth(weekStart) }) : fill(t.weekTitle, { date: "" }).trim();
  if (posts.length === 0) return { title, body: `${para(t.weekEmpty)}${signInLink()}` };

  const cards: string[] = [];
  for (const p of posts) {
    const channel = (s.week.channels as Record<string, string>)[p.channel ?? ""] ?? "";
    const heading = [p.suggested_day ? formatDayMonth(p.suggested_day) : "", channel].filter(Boolean).join(" · ");
    const open = (p.fact_flags ?? []).filter((f) => f.status === "open" && f.kind !== "regulated_reminder");
    const [imgTok, approveTok, editTok, skipTok] = await Promise.all([
      p.has_image ? signLink({ brandId: brand.id, postId: p.id, act: "img", extra: { format: "square" }, now: ctx.now }) : Promise.resolve(null),
      signLink({ brandId: brand.id, postId: p.id, act: "approve", weekStart: weekStart ?? undefined, now: ctx.now }),
      signLink({ brandId: brand.id, postId: p.id, act: "edit", weekStart: weekStart ?? undefined, now: ctx.now }),
      signLink({ brandId: brand.id, postId: p.id, act: "skip", weekStart: weekStart ?? undefined, now: ctx.now }),
    ]);
    const image = imgTok
      ? `<img src="/i/${esc(imgTok)}" width="560" height="560" alt="${esc(heading)}" style="display:block;width:100%;height:auto;border:0;border-radius:8px;background:#f5f5f4;">`
      : `<p style="margin:0;padding:48px 0;text-align:center;background:#f5f5f4;color:#57534e;border-radius:8px;">${esc(t.noImage)}</p>`;
    const flags =
      open.length > 0
        ? `<p style="margin:8px 0 0;font-weight:600;color:#92400e;background:#fef3c7;padding:6px 10px;border-radius:6px;">${esc(open.length === 1 ? t.flagsOne : fill(t.flagsMany, { n: open.length }))}</p>`
        : "";
    const action = (href: string, label: string) =>
      `<a href="/e/${esc(href)}" style="${buttonStyle("secondary")}margin:0 0 8px;">${esc(label)}</a>`;
    const actions =
      p.status === "posted" ? "" : `<div style="margin-top:12px;">${action(approveTok, t.approve)}${action(editTok, t.edit)}${action(skipTok, t.skip)}</div>`;
    cards.push(`<section style="margin:0 0 28px;padding:0 0 20px;border-bottom:1px solid #e7e5e4;">
<p style="margin:0 0 8px;font-size:15px;font-weight:600;">${esc(heading)} <span style="font-weight:400;color:#57534e;">- ${esc(statusLabel(p.status))}</span></p>
${image}
<p style="margin:12px 0 0;white-space:pre-wrap;">${esc((p.caption ?? "").trim())}</p>
${flags}
${actions}
</section>`);
  }
  return { title, body: cards.join("\n") };
}

// ---------------------------------------------------------------------------------------------
// checkin
// ---------------------------------------------------------------------------------------------

function checkinForm(ctx: LinkContext, selected: CheckinAnswer | null): string {
  const radios = CHECKIN_ANSWERS.map(
    (a) =>
      `<label style="display:block;margin:0 0 10px;padding:12px 14px;border:1px solid #d6d3d1;border-radius:8px;font-size:18px;"><input type="radio" name="answer" value="${a}"${selected === a ? " checked" : ""} style="margin-right:10px;transform:scale(1.3);">${esc(answerLabel(a))}</label>`,
  ).join("\n");
  return postForm({
    token: ctx.token,
    nonce: ctx.nonce,
    before: `<div style="margin:0 0 16px;">${radios}</div>`,
    buttons: [{ label: t.checkinSave }],
  });
}

const checkinHandler: LinkHandler = {
  async view(ctx) {
    const wk = ctx.claims.weekStart;
    if (!wk) return messagePage(t.checkinTitle, t.checkinMissing, 400);
    const picked = ctx.claims.extra.answer;
    const selected = isCheckinAnswer(picked) ? picked : null;
    return {
      title: t.checkinTitle,
      body: `${para(fill(t.checkinWeek, { date: formatDayMonth(wk) }))}${checkinForm(ctx, selected)}`,
    };
  },
  async act(ctx, form) {
    const wk = ctx.claims.weekStart;
    if (!wk) return messagePage(t.checkinTitle, t.checkinMissing, 400);
    const answer = formValue(form, "answer") || String(ctx.claims.extra.answer ?? "");
    if (!isCheckinAnswer(answer)) return checkinHandler.view(ctx);
    await upsertCheckin(ctx.brand.id, wk, answer);
    logBrandAction(ctx.claims, `checkin wk=${wk} answer=${answer}`);
    return {
      title: t.checkinSavedTitle,
      body: `${para(fill(t.checkinSaved, { answer: answerLabel(answer) }))}${checkinForm(ctx, answer)}`,
    };
  },
};

// ---------------------------------------------------------------------------------------------
// pause
// ---------------------------------------------------------------------------------------------

function pauseEnd(ctx: LinkContext): string {
  return addDaysIso(localDateIn(ctx.now, ctx.brand.timezone), 14);
}

const pauseHandler: LinkHandler = {
  async view(ctx) {
    return {
      title: t.pauseTitle,
      body: `${para(fill(t.pauseBody, { ...vars, date: formatDayMonth(pauseEnd(ctx), true) }))}${postForm({
        token: ctx.token,
        nonce: ctx.nonce,
        buttons: [{ label: t.pauseButton }],
      })}`,
    };
  },
  async act(ctx, form) {
    if (formValue(form, "do") === "resume") {
      await setEmailPausedUntil(ctx.brand.id, null);
      logBrandAction(ctx.claims, "resume");
      return messagePage(t.resumedTitle, t.resumed, 200, false);
    }
    const until = pauseEnd(ctx);
    await setEmailPausedUntil(ctx.brand.id, until);
    logBrandAction(ctx.claims, `pause until=${until}`);
    return {
      title: t.pauseDoneTitle,
      body: `${para(fill(t.pauseDone, { date: formatDayMonth(until, true) }))}${postForm({
        token: ctx.token,
        nonce: ctx.nonce,
        buttons: [{ label: t.pauseResume, name: "do", value: "resume", kind: "secondary" }],
      })}`,
    };
  },
};

// ---------------------------------------------------------------------------------------------
// unsubscribe (and resubscribe, a second POST with the same token)
// ---------------------------------------------------------------------------------------------

const unsubscribeHandler: LinkHandler = {
  async view(ctx) {
    return {
      title: t.unsubscribeTitle,
      body: `${para(fill(t.unsubscribeBody, vars))}${postForm({
        token: ctx.token,
        nonce: ctx.nonce,
        buttons: [{ label: t.unsubscribeButton }],
      })}`,
    };
  },
  async act(ctx, form) {
    if (formValue(form, "do") === "resubscribe") {
      await setEmailUnsubscribed(ctx.brand.id, false);
      logBrandAction(ctx.claims, "resubscribe");
      return messagePage(t.resubscribedTitle, t.resubscribed, 200, false);
    }
    await setEmailUnsubscribed(ctx.brand.id, true);
    logBrandAction(ctx.claims, "unsubscribe");
    return {
      title: t.unsubscribeDoneTitle,
      body: `${para(t.unsubscribeDone)}${postForm({
        token: ctx.token,
        nonce: ctx.nonce,
        buttons: [{ label: t.resubscribe, name: "do", value: "resubscribe", kind: "secondary" }],
      })}`,
    };
  },
};

// ---------------------------------------------------------------------------------------------
// resume (from the "we paused your emails" notice)
// ---------------------------------------------------------------------------------------------

const resumeHandler: LinkHandler = {
  async view(ctx) {
    return {
      title: t.resumeTitle,
      body: `${para(t.resumeBody)}${postForm({ token: ctx.token, nonce: ctx.nonce, buttons: [{ label: t.resumeButton }] })}`,
    };
  },
  async act(ctx) {
    await setEmailPausedUntil(ctx.brand.id, null);
    logBrandAction(ctx.claims, "resume");
    return messagePage(t.resumeDoneTitle, t.resumeDone, 200, false);
  },
};

const viewWeekHandler: LinkHandler = {
  view: viewWeek,
  // Read-only: a POST just shows the list again.
  act: viewWeek,
};

export function registerBuiltinLinkHandlers(): void {
  registerLinkHandler("view_week", viewWeekHandler);
  registerLinkHandler("checkin", checkinHandler);
  registerLinkHandler("pause", pauseHandler);
  registerLinkHandler("unsubscribe", unsubscribeHandler);
  registerLinkHandler("resume", resumeHandler);
}
