// Weekly offer plans (owner request 2026-10-16): the requirement stage for a week of posts. Each chosen day becomes a
// ready brief with its own offer (a dated selling point the owner typed), all sharing one design made in the Design
// Studio; the automation stage approves and schedules every day's post at the owner's time (published when the channel
// is connected, else emailed ready to post). Server-only.

import { z } from 'zod';
import { requireBrandMember } from '@/lib/brand/current';
import { createBrief, defaultBlocks, getBrief } from '@/lib/briefs/service';
import type { CtaKind } from '@/lib/briefs/types';
import { CTA_KINDS } from '@/lib/briefs/types';
import { approvalCheck, approveCreatePost, listBriefPosts, type CreatePost } from '@/lib/create';
import { getDb } from '@/lib/db';
import { loadBrandTimezone, scheduleApproved, zonedToUtc, formatSlot } from '@/lib/queue';
import { createUsp, listUsps } from '@/lib/usps/service';
import { currencyForCountry } from '@/lib/usps/currency';
import { applyDay } from '@/lib/studio/ops';
import { getServerShaper } from '@/lib/studio/server';
import { finishStudio, loadStudioPage, parseStudioState } from '@/lib/studio/service';
import type { StudioDoc, StudioFormat, StudioState } from '@/lib/studio/types';
import { WEEKDAYS, WEEKDAY_LABEL, offerWords, shortDate, weekDates, type Weekday } from './parse';
import { summarize, type PlanPostStatus } from './status';

const CHANNELS = ['instagram', 'facebook', 'whatsapp', 'linkedin', 'gbp', 'youtube'] as const;

export const planInputSchema = z.object({
  title: z.string().trim().min(1).max(80).default('Weekly offers'),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  on: z.string().trim().max(50).default(''),
  days: z
    .array(
      z.object({
        day: z.enum(WEEKDAYS),
        on: z.boolean(),
        kind: z.enum(['percent', 'amount', 'text']),
        value: z.number().positive().max(100000).nullable(),
        text: z.string().trim().max(60),
        what: z.string().trim().max(50).optional(),
      }),
    )
    .length(7),
  channels: z.array(z.enum(CHANNELS)).min(1).max(6),
  cta: z.enum(CTA_KINDS).nullable(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  photoId: z.string().uuid().nullable(),
});
export type PlanInput = z.infer<typeof planInputSchema>;

export interface PlanDay {
  date: string;
  weekday: Weekday;
  label: string;
  offer: string;
  offerNote: string;
  /** The day's headline ("Monday's special"): made by code from the day, so it states nothing new. */
  headline: string;
  briefId: string;
}

export interface Plan {
  id: string;
  title: string;
  status: 'draft' | 'designed' | 'scheduled';
  days: PlanDay[];
  settings: { channels: string[]; cta: CtaKind | null; time: string; photoId: string | null; on: string };
  studio: StudioState | null;
  createdAt: string;
}

export class PlanError extends Error {
  constructor(
    public readonly code: 'invalid' | 'no_days' | 'past' | 'not_found',
    message: string,
  ) {
    super(message);
  }
}

function dayTitle(offer: string, what: string): string {
  const o = offer.charAt(0) + offer.slice(1).toLowerCase();
  return `${o}${what ? ` ${what}` : ''}`.slice(0, 60);
}

/** Creates the plan, one dated selling point and one ready brief per chosen day. */
export async function createPlan(userId: string, brandId: string, raw: unknown, now = new Date()): Promise<Plan> {
  await requireBrandMember(userId, brandId);
  const parsed = planInputSchema.safeParse(raw);
  if (!parsed.success) throw new PlanError('invalid', 'Some of the plan is not filled in correctly.');
  const input = parsed.data;
  const chosen = input.days.filter((d) => d.on && (d.kind === 'text' ? d.text.trim() !== '' : d.value !== null));
  if (chosen.length === 0) throw new PlanError('no_days', 'Choose at least one day with an offer.');
  const timezone = await loadBrandTimezone(userId, brandId);
  const dates = weekDates(input.start);
  const [mem] = await getDb().withUser(userId, (tx) => tx.query<{ country: string | null }>('select country from public.brand_memory where brand_id = $1', [brandId]));
  const currency = currencyForCountry(mem?.country ?? null);

  const planId = await getDb().withUser(userId, async (tx) => {
    const [row] = await tx.query<{ id: string }>(
      `insert into public.post_plans (brand_id, created_by, title, days, settings) values ($1, $2::uuid, $3, '[]'::jsonb, $4::jsonb) returning id::text as id`,
      [brandId, userId, input.title, JSON.stringify({ channels: input.channels, cta: input.cta, time: input.time, photoId: input.photoId, on: input.on, timezone })],
    );
    return row.id;
  });

  const existing = await listUsps(userId, brandId);
  const days: PlanDay[] = [];
  chosen.sort((a, b) => dates[a.day].localeCompare(dates[b.day]));
  for (const d of chosen) {
    const date = dates[d.day];
    // Skip a day whose posting time is already (nearly) over.
    if (zonedToUtc(date, input.time, timezone).getTime() < now.getTime() + 10 * 60 * 1000) continue;
    const what = (d.what || input.on).trim();
    const offer = offerWords(d, currency);
    const title = dayTitle(offer, what);
    const details =
      d.kind === 'percent'
        ? { percent: d.value!, on: what || 'everything', validFrom: date, validTo: date }
        : d.kind === 'amount'
          ? { amountOff: { amount: d.value!, currency }, on: what || 'everything', validFrom: date, validTo: date }
          : {};
    const kind = d.kind === 'text' ? 'custom' : 'discount';
    const same = existing.find((u) => u.kind === kind && u.title === title && JSON.stringify(u.details) === JSON.stringify(details));
    const usp = same ?? (await createUsp(userId, brandId, { kind, title, details }));
    const blocks = await defaultBlocks(userId, brandId, { hasDates: true });
    const brief = await createBrief(userId, brandId, {
      postType: 'offer',
      primaryUspId: usp.id,
      secondaryUspIds: [],
      cta: input.cta,
      blocks,
      photoId: input.photoId,
      startsOn: date,
      endsOn: date,
      channels: input.channels,
      notes: `${WEEKDAY_LABEL[d.day]} offer: ${offer}${what ? ` on ${what}` : ''}. Valid on ${WEEKDAY_LABEL[d.day]} ${shortDate(date)} only.`,
      status: 'ready',
    });
    await getDb().withUser(userId, (tx) => tx.query('update public.post_briefs set plan_id = $3, plan_date = $4::date where id = $1 and brand_id = $2', [brief.id, brandId, planId, date]));
    days.push({ date, weekday: d.day, label: shortDate(date), offer, offerNote: `${what ? `On ${what} · ` : ''}${WEEKDAY_LABEL[d.day]} only`, headline: `${WEEKDAY_LABEL[d.day]}'s special`, briefId: brief.id });
  }
  if (days.length === 0) throw new PlanError('past', 'Every chosen day is already over at that time. Pick a later week or time.');
  await getDb().withUser(userId, (tx) => tx.query('update public.post_plans set days = $3::jsonb, updated_at = now() where id = $1 and brand_id = $2', [planId, brandId, JSON.stringify(days)]));
  return (await getPlan(userId, brandId, planId))!;
}

interface PlanRow {
  id: string;
  title: string;
  status: Plan['status'];
  days: PlanDay[];
  settings: Plan['settings'];
  studio: unknown;
  created_at: string | Date;
}

export async function getPlan(userId: string, brandId: string, planId: string): Promise<Plan | null> {
  if (!/^[0-9a-f-]{36}$/i.test(planId)) return null;
  const [r] = await getDb().withUser(userId, (tx) => tx.query<PlanRow>('select id::text as id, title, status, days, settings, studio, created_at from public.post_plans where id = $1 and brand_id = $2', [planId, brandId]));
  if (!r) return null;
  return { id: r.id, title: r.title, status: r.status, days: r.days ?? [], settings: r.settings, studio: r.studio ? parseStudioState(r.studio) : null, createdAt: String(r.created_at) };
}

export async function listPlans(userId: string, brandId: string): Promise<Plan[]> {
  const rows = await getDb().withUser(userId, (tx) => tx.query<PlanRow>('select id::text as id, title, status, days, settings, null as studio, created_at from public.post_plans where brand_id = $1 order by created_at desc limit 12', [brandId]));
  return rows.map((r) => ({ id: r.id, title: r.title, status: r.status, days: r.days ?? [], settings: r.settings, studio: null, createdAt: String(r.created_at) }));
}

export async function savePlanStudio(userId: string, brandId: string, planId: string, raw: unknown): Promise<boolean> {
  const state = parseStudioState(raw);
  if (!state) return false;
  const rows = await getDb().withUser(userId, (tx) => tx.query<{ id: string }>('update public.post_plans set studio = $3::jsonb, updated_at = now() where id = $1 and brand_id = $2 returning id::text as id', [planId, brandId, JSON.stringify(state)]));
  return rows.length > 0;
}

/** One day's own documents: the owner's copy for that day, else the shared design with the day's offer. */
export async function dayState(state: StudioState, day: PlanDay): Promise<StudioState> {
  const shaper = await getServerShaper();
  const docs: Partial<Record<StudioFormat, StudioDoc>> = {};
  for (const [f, doc] of Object.entries(state.docs) as [StudioFormat, StudioDoc][]) {
    docs[f] = state.days?.[day.date]?.[f] ?? applyDay(doc, day, shaper);
  }
  return { v: 1, main: state.main, docs };
}

/** "Use this design for the week": draws every day's post from the shared design. */
export async function finishPlanDesign(userId: string, brandId: string, planId: string, raw: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
  const plan = await getPlan(userId, brandId, planId);
  if (!plan) return { ok: false, message: 'That plan was not found.' };
  const state = parseStudioState(raw);
  if (!state) return { ok: false, message: 'The design could not be read. Please try again.' };
  await savePlanStudio(userId, brandId, planId, state);
  for (const day of plan.days) {
    const page = await loadStudioPage({ userId, brandId, briefId: day.briefId });
    if (!page) continue;
    const r = await finishStudio({ userId, brandId, briefId: day.briefId, state: await dayState(state, day), input: page.input });
    if (!r.ok) return { ok: false, message: `${day.label}: ${r.message}` };
  }
  await getDb().withUser(userId, (tx) => tx.query(`update public.post_plans set status = 'designed', updated_at = now() where id = $1 and brand_id = $2`, [planId, brandId]));
  return { ok: true };
}

export interface PlanDayStatus extends PlanDay {
  posts: PlanPostStatus[];
}

/** What the automation stage shows: each day's posts, pictures, checks and queue slots. */
export async function planStatus(userId: string, brandId: string, plan: Plan): Promise<PlanDayStatus[]> {
  const timezone = await loadBrandTimezone(userId, brandId);
  const out: PlanDayStatus[] = [];
  for (const day of plan.days) {
    const posts: CreatePost[] = await listBriefPosts(userId, brandId, day.briefId).catch(() => []);
    const ids = posts.map((p) => p.id);
    const items = ids.length
      ? await getDb().withUser(userId, (tx) => tx.query<{ post_id: string; slot_at: Date | string; status: string; mode: string }>('select post_id::text as post_id, slot_at, status, mode from public.queue_items where brand_id = $1 and post_id = any($2::uuid[])', [brandId, ids]))
      : [];
    const images = ids.length
      ? await getDb().withUser(userId, (tx) => tx.query<{ post_id: string; format: string; image_path: string; updated_at: Date | string }>('select post_id::text as post_id, format::text as format, image_path, updated_at from public.post_images where brand_id = $1 and post_id = any($2::uuid[])', [brandId, ids]))
      : [];
    out.push({
      ...day,
      posts: posts.map((p) => {
        const it = items.find((i) => i.post_id === p.id);
        const imgs = images.filter((i) => i.post_id === p.id);
        const img = imgs.find((i) => i.format === 'portrait') ?? imgs.find((i) => i.format === 'square') ?? imgs[0];
        return {
          id: p.id,
          channel: p.channel,
          status: it ? it.status : p.status,
          postStatus: p.status,
          queueStatus: it ? it.status : null,
          canApprove: approvalCheck(p).ok,
          image: img ? `/api/files/${img.image_path}?v=${new Date(img.updated_at).getTime()}` : null,
          caption: p.caption,
          flags: p.flags.filter((f) => f.status === 'open').length,
          openFlags: p.flags.filter((f) => f.status === 'open' && f.kind !== 'regulated_reminder'),
          slot: it ? new Date(it.slot_at).toISOString() : null,
          mode: it?.mode ?? null,
          slotLabel: it ? formatSlot(new Date(it.slot_at), timezone) : null,
        };
      }),
    });
  }
  return out;
}

/** Approves every day's post that has nothing left to check and puts it in the queue at the plan's time on its day. */
export async function approveAndSchedulePlan(userId: string, brandId: string, planId: string): Promise<{ scheduled: number; scheduledDays: string[]; needsCheck: string[]; failed: string[] }> {
  const plan = await getPlan(userId, brandId, planId);
  if (!plan) throw new PlanError('not_found', 'That plan was not found.');
  const timezone = await loadBrandTimezone(userId, brandId);
  let scheduled = 0;
  const scheduledDays: string[] = [];
  const needsCheck: string[] = [];
  const failed: string[] = [];
  for (const day of plan.days) {
    const posts = await listBriefPosts(userId, brandId, day.briefId);
    // A day with anything left to check is left whole: none of its posts is approved (the server rule is also enforced by approveCreatePost).
    if (posts.some((p) => p.status !== 'approved' && p.status !== 'posted' && !approvalCheck(p).ok)) {
      needsCheck.push(day.label);
      continue;
    }
    const ok: string[] = [];
    for (const p of posts) {
      if (p.status === 'approved') {
        ok.push(p.id);
        continue;
      }
      const r = await approveCreatePost({ userId, brandId, postId: p.id });
      if (r.ok) ok.push(p.id);
      else needsCheck.push(day.label);
    }
    if (ok.length === 0) continue;
    const at = zonedToUtc(day.date, plan.settings.time, timezone).toISOString();
    const r = await scheduleApproved({ userId, brandId, postIds: ok, overrides: Object.fromEntries(ok.map((id) => [id, at])) });
    if (r.ok) {
      scheduled += r.outcome.items.length;
      if (r.outcome.items.length > 0) scheduledDays.push(day.label);
    } else failed.push(`${day.label}: ${r.message ?? r.code}`);
  }
  // The plan counts as scheduled only when every day is in the queue.
  const days = await planStatus(userId, brandId, plan);
  const all = summarize(days);
  await getDb().withUser(userId, (tx) => tx.query(`update public.post_plans set status = $3, updated_at = now() where id = $1 and brand_id = $2`, [planId, brandId, all.total > 0 && all.scheduled === all.total ? 'scheduled' : 'designed']));
  return { scheduled, scheduledDays, needsCheck: [...new Set(needsCheck)], failed };
}

export { getBrief };
