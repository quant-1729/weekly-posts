// HTML pieces for the no-login approval pages (/e/{token}): the post preview, the "please check"
// panel, notices and the forms. Plain HTML with inline styles and no JavaScript, built with the
// helpers in src/lib/links/page.ts. Every dynamic value goes through esc().

import { getDb } from '@/lib/db';
import type { Flag } from '@/lib/guardrail';
import { fill, s } from '@/lib/i18n/strings';
import { formatDayMonth } from '@/lib/links/format';
import type { LinkContext } from '@/lib/links/handlers';
import { buttonStyle, esc, postForm } from '@/lib/links/page';
import { signLink } from '@/lib/links/tokens';
import { blockingFlags } from './ops';
import type { PostRecord } from './types';

const t = s.approvals;

export const MUTED = '#57534e';

export type Notice = { kind: 'ok' | 'error' | 'info'; text: string };

export function notice(n: Notice): string {
  const colors = {
    ok: 'background:#ecfdf5;border:1px solid #6ee7b7;color:#065f46;',
    error: 'background:#fef2f2;border:1px solid #fca5a5;color:#991b1b;',
    info: 'background:#eff6ff;border:1px solid #93c5fd;color:#1e3a8a;',
  }[n.kind];
  return `<p role="${n.kind === 'error' ? 'alert' : 'status'}" style="margin:0 0 16px;padding:10px 12px;border-radius:8px;font-weight:600;${colors}">${esc(n.text)}</p>`;
}

export const notices = (list: Array<Notice | null | undefined | false>): string =>
  list.filter((n): n is Notice => Boolean(n)).map(notice).join('\n');

/** A button as postForm makes it, for the cases postForm cannot (disabled, formnovalidate). */
export function button(label: string, o: { kind?: 'primary' | 'secondary'; disabled?: boolean; name?: string; value?: string; formnovalidate?: boolean } = {}): string {
  const attrs = [
    o.disabled ? 'disabled aria-disabled="true"' : '',
    o.name ? `name="${esc(o.name)}" value="${esc(o.value ?? '')}"` : '',
    o.formnovalidate ? 'formnovalidate' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const extra = o.disabled ? 'opacity:0.45;cursor:not-allowed;' : '';
  return `<button type="submit"${attrs ? ` ${attrs}` : ''} style="${buttonStyle(o.kind)}margin:0 0 12px;${extra}">${esc(label)}</button>`;
}

export const hiddenInput = (name: string, value: string) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`;

/** A form that POSTs `op` (and any hidden values) back to this token. */
export function opForm(
  ctx: LinkContext,
  op: string,
  o: { hidden?: Record<string, string>; before?: string; buttons?: Parameters<typeof postForm>[0]['buttons']; extraButtons?: string },
): string {
  const hidden = [hiddenInput('op', op), ...Object.entries(o.hidden ?? {}).map(([k, v]) => hiddenInput(k, v))].join('');
  const form = postForm({ token: ctx.token, nonce: ctx.nonce, before: `${hidden}${o.before ?? ''}`, buttons: o.buttons ?? [] });
  return o.extraButtons ? form.replace('</form>', `${o.extraButtons}\n</form>`) : form;
}

export const linkButton = (href: string, label: string, kind: 'primary' | 'secondary' = 'secondary') =>
  `<a href="${esc(href)}" style="${buttonStyle(kind)}margin:0 0 12px;">${esc(label)}</a>`;

const channelName = (c: string) => (s.week.channels as Record<string, string>)[c] ?? '';

export const statusLabel = (status: string) => (t.status as Record<string, string>)[status] ?? t.status.draft;

export function heading(post: PostRecord): string {
  const day = post.suggestedDay ? formatDayMonth(post.suggestedDay) : '';
  return fill(t.post.dayChannel, { day, channel: channelName(post.channel) }).replace(/^ · | · $/g, '');
}

const imgStyle = 'display:block;width:100%;height:auto;border:0;border-radius:8px;background:#f5f5f4;';

/** The signed /i/ URL of a post picture (square by default), or of a library photo thumbnail. */
export async function imageSrc(ctx: LinkContext, post: PostRecord, what: { format: 'square' | 'vertical' | 'landscape' } | { photo: string }): Promise<string> {
  const token = await signLink({ brandId: ctx.brand.id, postId: post.id, act: 'img', extra: what, now: ctx.now });
  return `/i/${token}`;
}

async function hasImages(brandId: string, postId: string): Promise<boolean> {
  const [row] = await getDb().withService((tx) =>
    tx.query<{ n: number }>(`select count(*)::int as n from public.post_images where post_id = $1 and brand_id = $2 and format = 'square'`, [postId, brandId]),
  );
  return (row?.n ?? 0) > 0;
}

/** Status chip + heading + picture + the words. `sizes` adds the vertical and landscape previews. */
export async function postPreview(ctx: LinkContext, post: PostRecord, o: { sizes?: boolean } = {}): Promise<string> {
  const pic = (await hasImages(post.brandId, post.id))
    ? `<img src="${esc(await imageSrc(ctx, post, { format: 'square' }))}" width="560" height="560" alt="${esc(t.post.imageAlt)}" style="${imgStyle}">`
    : `<p style="margin:0;padding:48px 0;text-align:center;background:#f5f5f4;color:${MUTED};border-radius:8px;">${esc(t.post.noImage)}</p>`;
  let sizes = '';
  if (o.sizes && (await hasImages(post.brandId, post.id))) {
    const [v, l] = await Promise.all([imageSrc(ctx, post, { format: 'vertical' }), imageSrc(ctx, post, { format: 'landscape' })]);
    sizes = `<p style="margin:12px 0 4px;font-size:14px;color:${MUTED};">${esc(t.post.otherSizes)}</p>
<table role="presentation" style="border-collapse:collapse;width:100%;"><tr>
<td style="width:34%;vertical-align:bottom;padding:0 8px 0 0;"><img src="${esc(v)}" alt="${esc(t.post.story)}" style="${imgStyle}"></td>
<td style="vertical-align:bottom;padding:0;"><img src="${esc(l)}" alt="${esc(t.post.wide)}" style="${imgStyle}"></td>
</tr></table>`;
  }
  const tags = post.hashtags.length ? `<p style="margin:8px 0 0;color:${MUTED};font-size:15px;">${esc(post.hashtags.join(' '))}</p>` : '';
  const cta = post.cta ? `<p style="margin:8px 0 0;font-weight:600;">${esc(post.cta)}</p>` : '';
  return `<section style="margin:0 0 20px;">
<p style="margin:0 0 8px;font-size:15px;font-weight:600;">${esc(heading(post))} <span style="font-weight:400;color:${MUTED};">- ${esc(statusLabel(post.status))}</span></p>
${pic}
${sizes}
<p style="margin:12px 0 0;white-space:pre-wrap;">${esc(post.caption.trim())}</p>
${cta}
${tags}
</section>`;
}

const fieldName = (f: Flag['field']) => t.fieldNames[f];
const kindName = (k: Flag['kind']) => t.flags.kinds[k];

/** The "Please check" list. Empty string when nothing blocks. */
export function flagsPanel(ctx: LinkContext, post: PostRecord, editHref: string): string {
  const open = blockingFlags(post.flags);
  if (open.length === 0) return '';
  const items = open
    .map((f) => {
      const canConfirm = f.kind !== 'avoid';
      const canRemove = f.highlight;
      const confirm = canConfirm
        ? opForm(ctx, 'confirm_flag', {
            hidden: { flag: f.id },
            before: f.regulated
              ? `<p style="margin:0 0 8px;padding:8px 10px;background:#fef3c7;border-radius:6px;font-size:15px;">${esc(t.flags.regulatedWarning)}</p>
<label style="display:block;margin:0 0 12px;font-size:16px;"><input type="checkbox" name="ack" value="1" required style="margin-right:8px;transform:scale(1.3);">${esc(t.flags.regulatedTick)}</label>`
              : '',
            buttons: [{ label: t.flags.confirm, kind: 'secondary' }],
          })
        : '';
      const remove = canRemove
        ? opForm(ctx, 'remove_flag', { hidden: { flag: f.id }, buttons: [{ label: f.kind === 'avoid' ? t.flags.removeWord : t.flags.remove, kind: 'secondary' }] })
        : '';
      const edit = !canRemove || !canConfirm ? `<p style="margin:0 0 12px;font-size:15px;color:${MUTED};">${esc(t.flags.editToFix)} <a href="${esc(editHref)}">${esc(t.approve.edit)}</a></p>` : '';
      return `<div style="padding:12px 0;border-top:1px solid #fcd34d;">
<p style="margin:0 0 4px;font-size:15px;color:${MUTED};">${esc(kindName(f.kind))} · ${esc(fill(t.flags.where, { field: fieldName(f.field) }))}</p>
<p style="margin:0 0 12px;font-size:18px;font-weight:600;"><mark style="background:#fde68a;padding:0 4px;border-radius:4px;">${esc(f.text)}</mark></p>
${confirm}${remove}${edit}
</div>`;
    })
    .join('\n');
  return `<section aria-label="${esc(t.flags.title)}" style="margin:0 0 20px;padding:12px 14px;background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;">
<h2 style="margin:0 0 4px;font-size:18px;color:#92400e;">${esc(t.flags.title)}</h2>
<p style="margin:0 0 8px;font-size:15px;color:${MUTED};">${esc(t.flags.intro)}</p>
${items}
</section>`;
}

/** The fixed reminder for regulated brands (an informational flag that never blocks). */
export function regulatedReminder(post: PostRecord): string {
  return post.flags.some((f) => f.kind === 'regulated_reminder')
    ? `<p style="margin:0 0 16px;padding:8px 12px;background:#f5f5f4;border-radius:8px;font-size:15px;">${esc(t.flags.reminder)}</p>`
    : '';
}

export async function tokenFor(ctx: LinkContext, act: 'approve' | 'edit' | 'skip' | 'ready' | 'view_week', post?: PostRecord, weekStart?: string): Promise<string> {
  const wk = weekStart ?? post?.weekStart ?? ctx.claims.weekStart;
  return signLink({ brandId: ctx.brand.id, postId: post?.id, act, weekStart: wk, now: ctx.now });
}

export const hrefFor = (token: string) => `/e/${token}`;
