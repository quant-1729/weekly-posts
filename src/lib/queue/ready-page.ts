// The no-login "ready" page for a post made from a brief (PRD v3 S-3, change C-27): the page an emailed delivery
// links to. It is the v2 ready page's twin for v3 posts: the same /e/ signed link (act "ready", with the post id),
// the same share script (Share, Download, Copy caption) and "Mark as posted", but for one post, in every size its
// channel needs. The v2 handler calls `deliveryReadyPage` first and falls back to its week page when this returns null.
//
// GET only shows. The POST ops ("posted", "unposted" and the script's "log") arrive with the CSRF nonce already
// checked by the dispatcher, exactly as for the v2 page.

import { logAction } from '@/lib/approvals/data';
import { opForm, notices, type Notice } from '@/lib/approvals/link-views';
import { getDb } from '@/lib/db';
import type { DesignFormat } from '@/lib/design/types';
import { shareTextFor } from '@/lib/create/view';
import { getEnv } from '@/lib/env';
import { fill, s } from '@/lib/i18n/strings';
import { formatDayMonth } from '@/lib/links/format';
import type { LinkContext } from '@/lib/links/handlers';
import { buttonStyle, esc, para, type LinkPage } from '@/lib/links/page';
import { signLink } from '@/lib/links/tokens';
import { localDateIn } from '@/lib/occasions/dates';
import { sharePageScript } from '@/lib/share/page-script';
import { UNMARK_WINDOW_MS } from '@/lib/share/formats';
import { postWithSlides } from './data';
import { channelLabel, loadDeliveryPost, type DeliveryPost } from './deliver';

const t = s.share;
const rp = s.queue.readyPage;
const MUTED = '#57534e';
const SMALL_NOTE = `margin:0 0 10px;font-size:15px;color:${MUTED};`;

const sizeName = (f: DesignFormat): string => s.create.review.share.sizeNames[f];
const filename = (channel: string, format: string): string => `${channel.replace(/[^a-z0-9]+/gi, '') || 'post'}-${format}.png`;

interface Status {
  status: string;
  postedAt: Date | null;
}

async function loadStatus(brandId: string, postId: string): Promise<Status | null> {
  const [row] = await getDb().withService((tx) =>
    tx.query<{ status: string; posted_at: Date | string | null }>('select status::text as status, posted_at from public.posts where id = $1 and brand_id = $2', [postId, brandId]),
  );
  return row ? { status: row.status, postedAt: row.posted_at ? new Date(row.posted_at) : null } : null;
}

async function imgSrc(ctx: LinkContext, postId: string, format: DesignFormat, full = false): Promise<string> {
  return `/i/${await signLink({ brandId: ctx.brand.id, postId, act: 'img', extra: full ? { format, full: true } : { format }, now: ctx.now })}`;
}

function postedBlock(ctx: LinkContext, st: Status): string {
  if (!st.postedAt) return '';
  let date: string;
  try {
    date = formatDayMonth(localDateIn(st.postedAt, ctx.brand.timezone));
  } catch {
    date = formatDayMonth(st.postedAt.toISOString().slice(0, 10));
  }
  const chip = `<p style="margin:0 0 10px;"><span style="display:inline-block;padding:4px 12px;border-radius:999px;background:#dbeafe;color:#1e3a8a;font-weight:600;font-size:15px;">${esc(fill(t.postedOn, { date }))}</span></p>`;
  const canUndo = ctx.now.getTime() - st.postedAt.getTime() <= UNMARK_WINDOW_MS;
  return `${chip}${canUndo ? opForm(ctx, 'unposted', { buttons: [{ label: t.unmarkPosted, kind: 'secondary' }] }) : ''}`;
}

async function actionsHtml(ctx: LinkContext, post: DeliveryPost, st: Status): Promise<string> {
  if (st.status === 'posted') return postedBlock(ctx, st);
  if (st.status !== 'approved') return '';
  const text = shareTextFor({ channel: post.channel, caption: post.caption, cta: post.cta, hashtags: post.hashtags, postCode: post.postCode, aiFace: post.aiFace }, getEnv().appUrl);
  const main = post.formats[0];
  const story = post.formats.find((f) => f === 'vertical' && f !== main);
  const srcs = Object.fromEntries(await Promise.all(post.formats.map(async (f) => [f, await imgSrc(ctx, post.id, f, true)] as const)));
  // A carousel: Share sends every slide in order, and each slide can be downloaded.
  const slideSrcs = main ? await Promise.all(post.slideIds.slice(0, 10).map((id) => imgSrc(ctx, id, main, true))) : [];
  const slideNames = slideSrcs.map((_, i) => filename(post.channel, `slide-${i + 1}`));
  const carousel = slideSrcs.length > 1;
  const shareBtn = (format: DesignFormat, label: string, o: { story?: boolean; primary?: boolean }) =>
    `<button type="button" data-share-btn data-url="${esc(srcs[format])}" data-filename="${esc(filename(post.channel, format))}" data-format="${format}"${o.story ? ' data-story="1"' : ''}${o.primary ? ' data-default="1"' : ''} style="${buttonStyle(o.primary ? 'primary' : 'secondary')}margin:0 0 12px;">${esc(label)}</button>`;
  const shareAllBtn = `<button type="button" data-share-btn data-urls="${esc(slideSrcs.join(' '))}" data-filenames="${esc(slideNames.join(' '))}" data-url="${esc(slideSrcs[0] ?? '')}" data-filename="${esc(slideNames[0] ?? '')}" data-format="${main}" data-default="1" style="${buttonStyle('primary')}margin:0 0 12px;">${esc(fill(rp.shareAll, { n: slideSrcs.length }))}</button>`;
  const shareBlock = main
    ? `<div hidden data-needs-share>${carousel ? shareAllBtn : shareBtn(main, t.share, { primary: true })}${story && !carousel ? shareBtn(story, t.shareStory, { story: true }) : ''}<p hidden data-ios-hint style="${SMALL_NOTE}">${esc(t.iosHint)}</p></div>`
    : '';
  const slideLinks = carousel
    ? `<div data-no-share><p style="${SMALL_NOTE}">${esc(rp.slidesLabel)}</p>${slideSrcs
        .map((u, i) => `<a href="${esc(u)}" download="${esc(slideNames[i])}" data-download-link data-format="${main}" style="${buttonStyle(i === 0 ? 'primary' : 'secondary')}margin:0 8px 12px 0;">${esc(fill(rp.downloadSlide, { n: i + 1 }))}</a>`)
        .join('')}</div>`
    : '';
  const downloads = carousel
    ? slideLinks
    : post.formats.length
    ? `<div data-no-share>${post.formats
        .map(
          (f) =>
            `<a href="${esc(srcs[f])}" download="${esc(filename(post.channel, f))}" data-download-link data-format="${f}" style="${buttonStyle(f === main ? 'primary' : 'secondary')}margin:0 0 12px;">${esc(fill(s.create.review.share.downloadSize, { size: sizeName(f) }))}</a>`,
        )
        .join('')}</div>`
    : `<p style="${SMALL_NOTE}">${esc(t.noImage)}</p>`;
  const copy = `<div hidden data-js-only><button type="button" data-copy-btn style="${buttonStyle('secondary')}margin:0 0 12px;">${esc(t.copyCaption)}</button></div>`;
  const message = `<p hidden data-share-msg role="status" style="margin:0 0 12px;padding:8px 12px;border-radius:8px;background:#ecfdf5;border:1px solid #6ee7b7;color:#065f46;font-size:15px;"></p>`;
  const paste = `<details style="margin:0 0 12px;"><summary style="cursor:pointer;font-size:15px;color:${MUTED};">${esc(t.textToPaste)}</summary><textarea readonly rows="6" style="display:block;box-sizing:border-box;width:100%;margin:8px 0 0;border:1px solid #d6d3d1;border-radius:8px;padding:10px 12px;font:inherit;font-size:16px;">${esc(text)}</textarea></details>`;
  const prompt = `<p hidden data-share-prompt style="margin:0 0 8px;font-weight:600;">${esc(t.didYouPost)}</p>`;
  const mark = opForm(ctx, 'posted', { buttons: [{ label: t.markPosted, kind: 'secondary' }] });
  return `<div data-share-root data-post="${esc(post.id)}" data-text="${esc(text)}" data-token="${esc(ctx.token)}" data-nonce="${esc(ctx.nonce)}">${shareBlock}${downloads}${copy}${message}${paste}${prompt}${mark}</div>`;
}

async function view(ctx: LinkContext, post: DeliveryPost, flash: Notice[] = []): Promise<LinkPage> {
  const st = (await loadStatus(ctx.brand.id, post.id)) ?? { status: 'draft', postedAt: null };
  const channel = channelLabel(post.channel);
  const main = post.formats[0];
  const picture = main
    ? `<img src="${esc(await imgSrc(ctx, post.id, main))}" width="560" alt="${esc(fill(s.queue.email.imageAlt, { channel }))}" style="display:block;width:100%;height:auto;border:0;border-radius:8px;background:#f5f5f4;">`
    : `<p style="margin:0;padding:48px 0;text-align:center;background:#f5f5f4;color:${MUTED};border-radius:8px;">${esc(t.noImage)}</p>`;
  const slides = main
    ? (
        await Promise.all(
          post.slideIds.slice(0, 10).map(async (id, i) => `<img src="${esc(await imgSrc(ctx, id, main))}" width="86" alt="${esc(fill(s.queue.email.slideAlt, { n: i + 1 }))}" style="width:86px;height:auto;border:0;margin:0 6px 6px 0;border-radius:4px;background:#f5f5f4;">`),
        )
      ).join('')
    : '';
  const preview = `<section style="margin:0 0 20px;">
<p style="margin:0 0 8px;font-size:15px;font-weight:600;">${esc(fill(rp.forChannel, { channel }))}</p>
${picture}
${slides ? `<p style="margin:10px 0 0;">${slides}</p>` : ''}
<p style="margin:12px 0 0;white-space:pre-wrap;">${esc(post.caption.trim())}</p>
${post.cta ? `<p style="margin:8px 0 0;font-weight:600;">${esc(post.cta)}</p>` : ''}
${post.hashtags.length ? `<p style="margin:8px 0 0;color:${MUTED};font-size:15px;">${esc(post.hashtags.join(' '))}</p>` : ''}
</section>`;
  const intro = para(fill(st.status === 'approved' ? rp.intro : rp.introLate, { channel }));
  return {
    title: rp.title,
    body: `${notices(flash)}${intro}${preview}${await actionsHtml(ctx, post, st)}`,
    script: st.status === 'approved' ? sharePageScript() : undefined,
  };
}

const text = (form: FormData, name: string): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
};

/**
 * The page (GET) or the answer to one of its forms (POST) for a v3 post named in the link. Returns null when the link
 * is not for such a post, so the caller falls back to the v2 ready page.
 */
export async function deliveryReadyPage(ctx: LinkContext, form?: FormData): Promise<LinkPage | null> {
  const postId = ctx.claims.postId;
  if (!postId) return null;
  const post = await loadDeliveryPost(ctx.brand.id, postId);
  if (!post) return null;
  if (!form) return view(ctx, post);

  const actor = { via: 'email_link', jtiHash: ctx.jtiHash } as const;
  switch (text(form, 'op')) {
    case 'posted': {
      const flash = await getDb().withService(async (tx): Promise<Notice> => {
        const [row] = await tx.query<{ status: string }>('select status::text as status from public.posts where id = $1 and brand_id = $2 for update', [post.id, ctx.brand.id]);
        if (!row || (row.status !== 'approved' && row.status !== 'posted')) return { kind: 'error', text: t.errors.notApproved };
        if (row.status === 'approved') {
          const ids = await postWithSlides(tx, ctx.brand.id, post.id);
          await tx.query(`update public.posts set status = 'posted', posted_at = $3::timestamptz where brand_id = $1 and id = any($2::uuid[]) and status = 'approved'`, [ctx.brand.id, ids, ctx.now.toISOString()]);
          await logAction(tx, actor, ctx.brand.id, post.id, 'posted');
        }
        return { kind: 'ok', text: t.markedPosted };
      });
      return view(ctx, post, [flash]);
    }
    case 'unposted': {
      const flash = await getDb().withService(async (tx): Promise<Notice> => {
        const [row] = await tx.query<{ status: string; posted_at: Date | string | null }>('select status::text as status, posted_at from public.posts where id = $1 and brand_id = $2 for update', [post.id, ctx.brand.id]);
        if (!row) return { kind: 'error', text: t.errors.notApproved };
        if (row.status === 'approved') return { kind: 'ok', text: t.unmarked };
        if (row.status !== 'posted') return { kind: 'error', text: t.errors.notPosted };
        const at = row.posted_at ? new Date(row.posted_at).getTime() : 0;
        if (ctx.now.getTime() - at > UNMARK_WINDOW_MS) return { kind: 'error', text: t.errors.tooLate };
        const ids = await postWithSlides(tx, ctx.brand.id, post.id);
        await tx.query(`update public.posts set status = 'approved', posted_at = null where brand_id = $1 and id = any($2::uuid[]) and status = 'posted'`, [ctx.brand.id, ids]);
        await logAction(tx, actor, ctx.brand.id, post.id, 'undo', { from: 'posted' });
        return { kind: 'ok', text: t.unmarked };
      });
      return view(ctx, post, [flash]);
    }
    case 'log': {
      // Sent by the page script after a share or download. Nobody reads the answer.
      const kind = text(form, 'kind');
      if (kind !== 'share' && kind !== 'download') return { status: 400, title: s.approvals.errors.unknownOp, body: '' };
      const st = await loadStatus(ctx.brand.id, post.id);
      if (!st || (st.status !== 'approved' && st.status !== 'posted')) return { status: 400, title: t.errors.notApproved, body: '' };
      const format = text(form, 'format');
      const detail = { ...(post.formats.includes(format as DesignFormat) ? { format } : {}), ...(kind === 'share' && text(form, 'story') === '1' ? { story: true } : {}) };
      await getDb().withService((tx) => logAction(tx, actor, ctx.brand.id, post.id, kind, detail));
      return { status: 200, title: t.share, body: '' };
    }
    default:
      return view(ctx, post);
  }
}
