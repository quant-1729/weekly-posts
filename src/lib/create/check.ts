// The fact check of a post made from a brief (PRD v3 C-2, C-12; change C-16), and what stops approval.
//
// `checkPosts` runs the guardrail (code + AI) on the headline, subline, CTA, captions and the mascot's line,
// with the brief's own facts (`factsForBrief`) as the truth and the per-USP rules (`uspRules`) from the
// brief: the frozen USPs with their `confirmed` flag, the QR the post prints, and the brand's active
// payment addresses (loaded by the guardrail). Anything that is not backed becomes a "Please check" flag.
//
// Approval is blocked by open flags (as in v2), by text that does not fit its picture (`overflow`) and by a
// QR that does not read back exactly as intended (`qr_mismatch`).

import type { V2Channel } from '@/lib/ai/prompts/v2-weekly';
import type { V2FactCheck } from '@/lib/ai/schemas-v2';
import { aiMode } from '@/lib/ai/client';
import type { Brief } from '@/lib/briefs/types';
import type { DesignFormat, DesignReport } from '@/lib/design/types';
import { hasBlockingFlags, runGuardrail, type Flag, type PostGuardrailResult } from '@/lib/guardrail';
import { QR_LABEL, factsForBrief } from './content';
import type { CreateBrand, DesignBlocker, DesignWords } from './types';

export interface CheckPostInput {
  channel: string;
  caption: string;
  hashtags: string[];
}

/** The guardrail knows four channels; WhatsApp and YouTube are checked like Facebook (the limits are not flags). */
export function guardrailChannel(channel: string): V2Channel {
  return channel === 'instagram' || channel === 'facebook' || channel === 'linkedin' || channel === 'gbp' ? channel : 'facebook';
}

export interface CheckArgs {
  userId: string;
  brandId: string;
  brief: Brief;
  brand: CreateBrand;
  words: DesignWords;
  posts: CheckPostInput[];
  now?: Date;
  /** Fixture mode only (tests and offline dev): what the AI fact check "answers". Empty (nothing to question) when not given. */
  aiFixture?: V2FactCheck | (() => V2FactCheck);
}

/** Flags for several posts of one brief (one AI call for all). Same order as `posts`. */
export async function checkPosts(args: CheckArgs): Promise<PostGuardrailResult[]> {
  const { brief } = args;
  const qr = brief.qr
    ? { kind: brief.qr.kind, label: brief.qr.kind === 'payment' ? QR_LABEL.pay : QR_LABEL.visit, payeeShown: brief.qr.kind === 'payment' }
    : null;
  const rules = { usps: brief.uspSnapshot, qr, timezone: brief.timezone };
  const facts = factsForBrief(brief, args.brand);
  return runGuardrail({
    userId: args.userId,
    brandId: args.brandId,
    posts: args.posts.map((p) => ({
      channel: guardrailChannel(p.channel),
      caption: p.caption,
      cta: args.words.ctaText,
      hashtags: p.hashtags,
      image_text: { headline: args.words.headline, subline: args.words.subline, bubble: args.words.bubble },
    })),
    facts,
    uspRules: args.posts.map(() => rules),
    now: args.now,
    // The channels of one brief share their facts and often a sentence: they are not compared with each other, nor with
    // this brief's earlier posts; earlier posts of other briefs (and the weekly batches) are (C-3).
    compareWithinCall: false,
    excludeBriefId: brief.id,
    aiFixture: args.aiFixture ?? (aiMode() === 'fixture' ? { facts: [] } : undefined),
  });
}

/** Flags for one post. */
export async function checkPost(args: Omit<CheckArgs, 'posts'> & { post: CheckPostInput }): Promise<PostGuardrailResult> {
  const { post, ...rest } = args;
  return (await checkPosts({ ...rest, posts: [post] }))[0];
}

/**
 * The flags after a new check, keeping the owner's earlier "this is true" for a claim that is still there
 * (same id), so a small edit does not ask the same question twice.
 */
export function carryDecisions(next: Flag[], previous: Flag[]): Flag[] {
  const confirmed = new Map(previous.filter((f) => f.status === 'confirmed').map((f) => [f.id, f]));
  return next.map((f) => {
    const old = confirmed.get(f.id);
    return old && f.status === 'open' ? { ...f, status: 'confirmed' as const, decided_at: old.decided_at } : f;
  });
}

// ---------------------------------------------------------------------------------------------
// What blocks approval
// ---------------------------------------------------------------------------------------------

/** Problems in a drawn picture that stop approval: text that did not fit, or a QR that does not read back as intended. */
export function blockersFromReport(format: DesignFormat, report: DesignReport): DesignBlocker[] {
  const out: DesignBlocker[] = [];
  if (report.overflow.length > 0) out.push({ format, code: 'overflow', detail: report.overflow.join(', ') });
  if (report.qr && !report.qr.ok) out.push({ format, code: 'qr_mismatch', detail: report.qr.decoded ?? 'not readable' });
  return out;
}

export interface ApprovalCheck {
  ok: boolean;
  flags: Flag[];
  blockers: DesignBlocker[];
  /** The post has no drawn pictures yet (the owner has not used a design). */
  noDesign: boolean;
}

export function approvalCheck(post: { flags: Flag[]; design: { blockers: DesignBlocker[] } | null; themeId: string | null }): ApprovalCheck {
  const flags = post.flags.filter((f) => f.status === 'open' && f.kind !== 'regulated_reminder');
  const blockers = post.design?.blockers ?? [];
  const noDesign = !post.themeId || !post.design;
  return { ok: !hasBlockingFlags(post.flags) && blockers.length === 0 && !noDesign, flags, blockers, noDesign };
}
