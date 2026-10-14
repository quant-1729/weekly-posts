// The four post acts of the emailed links (Req 14-16): approve, skip, edit and ready.
// GET shows a page and never changes anything; POST (with the CSRF nonce, checked by the
// dispatcher) acts through src/lib/approvals/ops.ts, the same operations the dashboard uses.
// Every operation writes its own post_actions row, so the handlers do not log.

import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { BUBBLE_MAX_CHARS, loadUsableMascot } from '@/lib/mascot/posts';
import { localDateIn } from '@/lib/occasions/dates';
import { composeShareText } from '@/lib/shortlinks/compose';
import { signLink } from '@/lib/links/tokens';
import { SHARE_FORMATS, STORY_FORMAT, defaultShareFormat, shareFilename, type ShareFormat } from '@/lib/share/formats';
import { sharePageScript } from '@/lib/share/page-script';
import { fill, s } from '@/lib/i18n/strings';
import { formatDayMonth } from '@/lib/links/format';
import { registerLinkHandler, type LinkContext, type LinkHandler } from '@/lib/links/handlers';
import { buttonStyle, esc, para, unavailablePage, type LinkPage } from '@/lib/links/page';
import {
  approvePost,
  confirmFlag,
  editPost,
  removeFlag,
  rewritePost,
  skipPost,
  swapPhoto,
  undoPost,
  blockingFlags,
  logDownload,
  logShare,
  markPosted,
  unmarkPosted,
  UNMARK_WINDOW_MS,
} from './ops';
import { deliveryReadyPage } from '@/lib/queue/ready-page';
import { loadPost } from './data';
import {
  MUTED,
  button,
  flagsPanel,
  hrefFor,
  imageSrc,
  linkButton,
  notice,
  notices,
  opForm,
  postPreview,
  regulatedReminder,
  tokenFor,
  type Notice,
} from './link-views';
import { formText, parseHashtags } from './parse';
import type { OpFail, PostRecord, PostRef } from './types';
import type { RewriteOk } from './rewrite';

const t = s.approvals;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const refOf = (ctx: LinkContext): PostRef => ({
  brandId: ctx.brand.id,
  postId: ctx.claims.postId!,
  actor: { via: 'email_link', jtiHash: ctx.jtiHash },
});

const failNotice = (f: OpFail): Notice => ({ kind: 'error', text: f.message });
const unknownOp = (): Notice => ({ kind: 'error', text: t.errors.unknownOp });

async function postOrNull(ctx: LinkContext): Promise<PostRecord | null> {
  return loadPost(ctx.brand.id, ctx.claims.postId!);
}

const doneBody = (...parts: string[]) => parts.filter(Boolean).join('\n');

// ---------------------------------------------------------------------------------------------
// approve
// ---------------------------------------------------------------------------------------------

async function approveView(ctx: LinkContext, flash: Notice[] = []): Promise<LinkPage> {
  const post = await postOrNull(ctx);
  if (!post) return unavailablePage();
  const preview = await postPreview(ctx, post);
  const readyHref = hrefFor(await tokenFor(ctx, 'ready', post));
  const editHref = hrefFor(await tokenFor(ctx, 'edit', post));

  if (post.status === 'posted') {
    return { title: t.approve.postedTitle, body: doneBody(notices(flash), notice({ kind: 'info', text: t.approve.posted }), preview, linkButton(readyHref, t.approve.seeReady)) };
  }
  if (post.status === 'approved') {
    return {
      title: t.approve.doneTitle,
      body: doneBody(
        notices(flash),
        notice({ kind: 'ok', text: t.approve.already }),
        preview,
        regulatedReminder(post),
        opForm(ctx, 'undo', { buttons: [{ label: t.approve.undo, kind: 'secondary' }] }),
        linkButton(readyHref, t.approve.seeReady, 'primary'),
        linkButton(editHref, t.approve.edit),
      ),
    };
  }

  const open = blockingFlags(post.flags);
  const approve =
    open.length > 0
      ? `<p style="margin:0 0 8px;color:${MUTED};font-size:15px;">${esc(t.approve.blockedHint)}</p>${button(t.approve.button, { disabled: true })}`
      : opForm(ctx, 'approve', { buttons: [{ label: t.approve.button }] });
  return {
    title: t.approve.title,
    body: doneBody(
      notices(flash),
      post.status === 'skipped' ? notice({ kind: 'info', text: t.approve.skippedNote }) : '',
      preview,
      regulatedReminder(post),
      flagsPanel(ctx, post, editHref),
      approve,
      linkButton(editHref, t.approve.edit),
    ),
  };
}

const approveHandler: LinkHandler = {
  view: (ctx) => approveView(ctx),
  async act(ctx, form) {
    const ref = refOf(ctx);
    switch (formText(form, 'op')) {
      case 'approve': {
        const r = await approvePost(ref);
        if (!r.ok) return approveView(ctx, [failNotice(r)]);
        const readyHref = hrefFor(await tokenFor(ctx, 'ready', r.post));
        return {
          title: t.approve.doneTitle,
          body: doneBody(
            notice({ kind: 'ok', text: r.changed ? t.approve.done : t.approve.already }),
            await postPreview(ctx, r.post),
            regulatedReminder(r.post),
            opForm(ctx, 'undo', { buttons: [{ label: t.approve.undo, kind: 'secondary' }] }),
            linkButton(readyHref, t.approve.seeReady, 'primary'),
          ),
        };
      }
      case 'confirm_flag': {
        const r = await confirmFlag({ ...ref, flagId: formText(form, 'flag'), regulatedAck: formText(form, 'ack') === '1' });
        return approveView(ctx, [r.ok ? { kind: 'ok', text: t.flags.confirmedOk } : failNotice(r)]);
      }
      case 'remove_flag': {
        const r = await removeFlag({ ...ref, flagId: formText(form, 'flag') });
        return approveView(ctx, [r.ok ? { kind: 'ok', text: t.flags.removedOk } : failNotice(r)]);
      }
      case 'undo': {
        const r = await undoPost(ref);
        return approveView(ctx, [r.ok ? { kind: 'info', text: t.approve.undone } : failNotice(r)]);
      }
      default:
        return approveView(ctx, [unknownOp()]);
    }
  },
};

// ---------------------------------------------------------------------------------------------
// skip
// ---------------------------------------------------------------------------------------------

async function skipView(ctx: LinkContext, flash: Notice[] = []): Promise<LinkPage> {
  const post = await postOrNull(ctx);
  if (!post) return unavailablePage();
  const preview = await postPreview(ctx, post);
  if (post.status === 'posted') {
    return { title: t.approve.postedTitle, body: doneBody(notices(flash), notice({ kind: 'info', text: t.approve.posted }), preview) };
  }
  if (post.status === 'skipped') {
    return {
      title: t.skip.doneTitle,
      body: doneBody(notices(flash), notice({ kind: 'ok', text: t.skip.already }), preview, opForm(ctx, 'undo', { buttons: [{ label: t.skip.undo, kind: 'secondary' }] })),
    };
  }
  return {
    title: t.skip.title,
    body: doneBody(notices(flash), `<p style="margin:0 0 16px;color:${MUTED};">${esc(t.skip.intro)}</p>`, preview, opForm(ctx, 'skip', { buttons: [{ label: t.skip.button }] })),
  };
}

const skipHandler: LinkHandler = {
  view: (ctx) => skipView(ctx),
  async act(ctx, form) {
    const ref = refOf(ctx);
    switch (formText(form, 'op')) {
      case 'skip': {
        const r = await skipPost(ref);
        if (!r.ok) return skipView(ctx, [failNotice(r)]);
        return {
          title: t.skip.doneTitle,
          body: doneBody(
            notice({ kind: 'ok', text: r.changed ? t.skip.done : t.skip.already }),
            await postPreview(ctx, r.post),
            opForm(ctx, 'undo', { buttons: [{ label: t.skip.undo, kind: 'secondary' }] }),
          ),
        };
      }
      case 'undo': {
        const r = await undoPost(ref);
        return skipView(ctx, [r.ok ? { kind: 'info', text: t.approve.undone } : failNotice(r)]);
      }
      default:
        return skipView(ctx, [unknownOp()]);
    }
  },
};

// ---------------------------------------------------------------------------------------------
// edit
// ---------------------------------------------------------------------------------------------

interface PhotoChoice {
  id: string;
  usable: boolean | null;
  description: string | null;
}

async function listPhotoChoices(brandId: string): Promise<PhotoChoice[]> {
  return getDb().withService((tx) =>
    tx.query<PhotoChoice>(
      `select id::text as id, usable, description from public.photos
        where brand_id = $1 and kind = 'photo' and storage_path is not null
        order by (usable is false), created_at desc, id limit 30`,
      [brandId],
    ),
  );
}

interface EditFlash {
  notices?: Array<Notice | false | null | undefined>;
  /** Problems with a save, one per line. */
  problems?: string[];
  /** What the owner typed, so a failed save does not lose it. */
  values?: { caption: string; cta: string; hashtags: string; headline: string; subline: string };
  /** After a refused photo: offer "use it anyway" for this one. */
  insistPhoto?: string;
  rewrite?: RewriteOk;
  instruction?: string;
  /** What the owner typed for the mascot's words, so a failed save does not lose it. */
  bubble?: string;
}

const field = (label: string, input: string) =>
  `<label style="display:block;margin:0 0 14px;"><span style="display:block;margin:0 0 4px;font-weight:600;">${esc(label)}</span>${input}</label>`;
const inputStyle = 'display:block;box-sizing:border-box;width:100%;border:1px solid #d6d3d1;border-radius:8px;padding:10px 12px;font:inherit;font-size:16px;';

async function photoPicker(ctx: LinkContext, post: PostRecord, insistPhoto?: string): Promise<string> {
  const photos = await listPhotoChoices(ctx.brand.id);
  const tiles = await Promise.all(
    photos.map(async (p) => {
      const src = await imageSrc(ctx, post, { photo: p.id });
      const checked = p.id === post.photoId ? ' checked' : '';
      const warn = p.usable === false ? `<span style="display:block;font-size:13px;color:#92400e;">${esc(t.edit.photoLowQuality)}</span>` : '';
      return `<label style="display:inline-block;width:30%;min-width:96px;margin:0 2% 12px 0;vertical-align:top;text-align:center;font-size:14px;">
<img src="${esc(src)}" width="120" height="120" alt="${esc(p.description ?? '')}" style="display:block;width:100%;height:auto;border-radius:8px;background:#f5f5f4;">
<input type="radio" name="photo" value="${esc(p.id)}"${checked} style="margin-top:6px;transform:scale(1.3);">${warn}</label>`;
    }),
  );
  const none = `<label style="display:block;margin:0 0 12px;padding:10px 12px;border:1px solid #d6d3d1;border-radius:8px;"><input type="radio" name="photo" value="none"${post.photoId ? '' : ' checked'} style="margin-right:8px;transform:scale(1.3);">${esc(t.edit.photoNone)}</label>`;
  const grid = photos.length ? `<div>${tiles.join('')}</div>` : `<p style="color:${MUTED};">${esc(t.edit.photoEmpty)}</p>`;
  const insist = insistPhoto
    ? opForm(ctx, 'photo', { hidden: { photo: insistPhoto, insist: '1' }, buttons: [{ label: t.edit.photoInsist, kind: 'secondary' }] })
    : '';
  return `<section style="margin:0 0 24px;"><h2 style="margin:0 0 4px;font-size:18px;">${esc(t.edit.photoTitle)}</h2>
<p style="margin:0 0 12px;color:${MUTED};font-size:15px;">${esc(t.edit.photoHelp)}</p>
${insist}
${opForm(ctx, 'photo', { before: `${grid}${none}`, buttons: [{ label: t.edit.photoUse, kind: 'secondary' }] })}</section>`;
}

/** "Your mascot on this post" (V-25): show or hide it, and what it says. Only when the post has one or the brand can add one. */
async function mascotSection(ctx: LinkContext, post: PostRecord, bubble?: string): Promise<string> {
  if (!post.mascotId && !(await loadUsableMascot(ctx.brand.id))) return '';
  const m = s.mascot.post;
  const on = post.mascotId !== null;
  const radio = (value: string, checked: boolean, label: string) =>
    `<label style="display:block;margin:0 0 8px;padding:10px 12px;border:1px solid #d6d3d1;border-radius:8px;"><input type="radio" name="show" value="${value}"${checked ? ' checked' : ''} style="margin-right:8px;transform:scale(1.3);">${esc(label)}</label>`;
  const form = opForm(ctx, 'mascot', {
    before: [
      radio('1', on, m.show),
      radio('0', !on, m.hide),
      field(fill(m.bubbleLabel, { max: BUBBLE_MAX_CHARS }), `<input type="text" name="bubble" maxlength="${BUBBLE_MAX_CHARS}" value="${esc(bubble ?? post.imageText.bubble)}" style="${inputStyle}">`),
    ].join('\n'),
    buttons: [{ label: m.save }],
  });
  return `<section style="margin:0 0 24px;"><h2 style="margin:0 0 4px;font-size:18px;">${esc(m.title)}</h2><p style="margin:0 0 12px;color:${MUTED};font-size:15px;">${esc(m.help)}</p>${form}</section>`;
}

async function editView(ctx: LinkContext, flash: EditFlash = {}): Promise<LinkPage> {
  const post = await postOrNull(ctx);
  if (!post) return unavailablePage();
  if (post.status === 'posted') {
    return { title: t.approve.postedTitle, body: doneBody(notice({ kind: 'info', text: t.approve.posted }), await postPreview(ctx, post)) };
  }
  const v = flash.values ?? {
    caption: post.caption,
    cta: post.cta,
    hashtags: post.hashtags.join(' '),
    headline: post.imageText.headline,
    subline: post.imageText.subline,
  };
  const open = blockingFlags(post.flags).length;
  const approveHref = hrefFor(await tokenFor(ctx, 'approve', post));

  const rw = flash.rewrite;
  const rewriteNotices: Notice[] = rw
    ? [
        { kind: 'ok', text: t.edit.rewriteDone },
        { kind: 'info', text: fill(t.edit.rewriteTime, { seconds: (rw.timings.totalMs / 1000).toFixed(1) }) },
        { kind: 'info', text: t.edit.rewriteSaved },
        ...(rw.note ? [{ kind: 'info' as const, text: fill(t.edit.rewriteNote, { note: rw.note }) }] : []),
        ...(rw.guardrailTimedOut ? [{ kind: 'error' as const, text: t.edit.rewriteTimedOut }] : []),
        ...(rw.reapprove ? [{ kind: 'info' as const, text: t.edit.reapprove }] : []),
      ]
    : [];
  const problems =
    flash.problems && flash.problems.length > 0
      ? `<div role="alert" style="margin:0 0 16px;padding:10px 12px;border-radius:8px;background:#fef2f2;border:1px solid #fca5a5;color:#991b1b;"><p style="margin:0 0 4px;font-weight:600;">${esc(t.edit.problems)}</p><ul style="margin:0;padding-left:20px;">${flash.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`
      : '';

  const textForm = opForm(ctx, 'save', {
    before: [
      field(t.edit.captionLabel, `<textarea name="caption" rows="7" style="${inputStyle}">${esc(v.caption)}</textarea>`),
      field(t.edit.ctaLabel, `<input type="text" name="cta" value="${esc(v.cta)}" style="${inputStyle}">`),
      field(t.edit.hashtagsLabel, `<input type="text" name="hashtags" value="${esc(v.hashtags)}" style="${inputStyle}">`),
      field(t.edit.headlineLabel, `<input type="text" name="headline" value="${esc(v.headline)}" style="${inputStyle}">`),
      field(t.edit.sublineLabel, `<input type="text" name="subline" value="${esc(v.subline)}" style="${inputStyle}">`),
    ].join('\n'),
    buttons: [{ label: t.edit.save }],
  });

  const chips = t.edit.chips
    .map((c) => `<button type="submit" name="chip" value="${esc(c)}" style="display:inline-block;margin:0 8px 8px 0;padding:8px 14px;border:1px solid #d6d3d1;border-radius:999px;background:#f5f5f4;font:inherit;font-size:15px;cursor:pointer;">${esc(c)}</button>`)
    .join('');
  const rewriteForm = opForm(ctx, 'rewrite', {
    before: `<p style="margin:0 0 8px;">${chips}</p>${field(t.edit.rewriteLabel, `<input type="text" name="instruction" maxlength="200" value="${esc(flash.instruction ?? '')}" placeholder="${esc(t.edit.rewritePlaceholder)}" style="${inputStyle}">`)}`,
    buttons: [{ label: t.edit.rewriteButton }],
  });

  return {
    title: t.edit.title,
    body: doneBody(
      notices([...(flash.notices ?? []), ...rewriteNotices]),
      problems,
      await postPreview(ctx, post, { sizes: true }),
      regulatedReminder(post),
      open > 0 ? notice({ kind: 'info', text: fill(t.edit.flagsNote, { n: open }) }) : '',
      `<section style="margin:0 0 24px;"><h2 style="margin:0 0 12px;font-size:18px;">${esc(t.edit.textTitle)}</h2>${textForm}</section>`,
      await photoPicker(ctx, post, flash.insistPhoto),
      await mascotSection(ctx, post, flash.bubble),
      `<section style="margin:0 0 24px;"><h2 style="margin:0 0 4px;font-size:18px;">${esc(t.edit.rewriteTitle)}</h2><p style="margin:0 0 12px;color:${MUTED};font-size:15px;">${esc(t.edit.rewriteHelp)}</p>${rewriteForm}</section>`,
      linkButton(approveHref, t.edit.approveLink, 'primary'),
    ),
  };
}

const editHandler: LinkHandler = {
  view: (ctx) => editView(ctx),
  async act(ctx, form) {
    const ref = refOf(ctx);
    switch (formText(form, 'op')) {
      case 'save': {
        const values = {
          caption: formText(form, 'caption'),
          cta: formText(form, 'cta'),
          hashtags: formText(form, 'hashtags'),
          headline: formText(form, 'headline'),
          subline: formText(form, 'subline'),
        };
        const r = await editPost({
          ...ref,
          input: { caption: values.caption, cta: values.cta, hashtags: parseHashtags(values.hashtags), image_text: { headline: values.headline, subline: values.subline } },
        });
        if (!r.ok) {
          return editView(ctx, r.code === 'invalid' ? { problems: r.errors ?? [r.message], values } : { notices: [failNotice(r)], values });
        }
        return editView(ctx, {
          notices: [
            r.changed ? { kind: 'ok', text: t.edit.saved } : { kind: 'info', text: t.edit.unchanged },
            r.reapprove && { kind: 'info', text: t.edit.reapprove },
          ],
        });
      }
      case 'photo': {
        const choice = formText(form, 'photo');
        if (choice !== 'none' && !UUID_RE.test(choice)) return editView(ctx, { notices: [{ kind: 'error', text: t.edit.photoPick }] });
        const photoId = choice === 'none' ? null : choice;
        const r = await swapPhoto({ ...ref, photoId, insist: formText(form, 'insist') === '1' });
        if (!r.ok) {
          return editView(ctx, { notices: [failNotice(r)], insistPhoto: r.code === 'photo_unusable' && photoId ? photoId : undefined });
        }
        return editView(ctx, {
          notices: [r.warning ? { kind: 'info', text: t.edit.photoWarned } : { kind: 'ok', text: t.edit.photoSaved }, r.reapprove && { kind: 'info', text: t.edit.reapprove }],
        });
      }
      case 'mascot': {
        const bubble = formText(form, 'bubble');
        const r = await editPost({ ...ref, input: { image_text: { bubble }, showMascot: formText(form, 'show') === '1' } });
        if (!r.ok) {
          return editView(ctx, r.code === 'invalid' ? { problems: r.errors ?? [r.message], bubble } : { notices: [failNotice(r)], bubble });
        }
        return editView(ctx, {
          notices: [
            r.changed ? { kind: 'ok', text: s.mascot.post.saved } : { kind: 'info', text: s.mascot.post.unchanged },
            r.reapprove && { kind: 'info', text: t.edit.reapprove },
          ],
        });
      }
      case 'rewrite': {
        const instruction = formText(form, 'chip') || formText(form, 'instruction');
        const r = await rewritePost({ ...ref, instruction });
        if (!r.ok) return editView(ctx, { notices: [failNotice(r)], instruction: formText(form, 'instruction') });
        return editView(ctx, { rewrite: r });
      }
      default:
        return editView(ctx, { notices: [unknownOp()] });
    }
  },
};

// ---------------------------------------------------------------------------------------------
// ready: the week's approved posts (Req 16). V-17 adds Share, Download, Copy and Mark as posted.
// ---------------------------------------------------------------------------------------------

const sh = s.share;
const SMALL_NOTE = `margin:0 0 10px;font-size:15px;color:${MUTED};`;

/** The signed /i/ URL of the full-size picture (the stored PNG), for sharing and downloading. */
async function fullImageSrc(ctx: LinkContext, post: PostRecord, format: ShareFormat): Promise<string> {
  const token = await signLink({ brandId: ctx.brand.id, postId: post.id, act: 'img', extra: { format, full: true }, now: ctx.now });
  return `/i/${token}`;
}

async function renderedFormats(brandId: string, postId: string): Promise<ShareFormat[]> {
  const rows = await getDb().withService((tx) =>
    tx.query<{ format: string }>(`select format::text as format from public.post_images where post_id = $1 and brand_id = $2`, [postId, brandId]),
  );
  return SHARE_FORMATS.filter((f) => rows.some((r) => r.format === f));
}

/** "Posted on 14 Oct", with an undo button for the first 24 hours. */
function postedBlock(ctx: LinkContext, post: PostRecord): string {
  if (!post.postedAt) return '';
  let date: string;
  try {
    date = formatDayMonth(localDateIn(new Date(post.postedAt), ctx.brand.timezone));
  } catch {
    date = formatDayMonth(post.postedAt.slice(0, 10));
  }
  const chip = `<p style="margin:0 0 10px;"><span style="display:inline-block;padding:4px 12px;border-radius:999px;background:#dbeafe;color:#1e3a8a;font-weight:600;font-size:15px;">${esc(fill(sh.postedOn, { date }))}</span></p>`;
  const canUndo = ctx.now.getTime() - new Date(post.postedAt).getTime() <= UNMARK_WINDOW_MS;
  const undo = canUndo ? opForm(ctx, 'unposted', { hidden: { post: post.id }, buttons: [{ label: sh.unmarkPosted, kind: 'secondary' }] }) : '';
  return `${chip}${undo}`;
}

/**
 * Under each ready post (Req 17, 18): Share (phones that can share a picture), Share as story or
 * status, Download (everywhere else, and the fallback without JavaScript), Copy caption and Mark as
 * posted. The picture links are signed full-size /i/ URLs, same origin, so the page can fetch them to
 * make a File. A posted post shows "Posted on {date}" and, for a day, "Not posted yet".
 */
export async function readyPostActions(ctx: LinkContext, post: PostRecord): Promise<string> {
  if (post.status === 'posted') return postedBlock(ctx, post);
  if (post.status !== 'approved') return '';

  const formats = await renderedFormats(post.brandId, post.id);
  const text = composeShareText(post, { baseUrl: getEnv().appUrl });
  const main = defaultShareFormat(post.channel);
  const srcs = Object.fromEntries(await Promise.all(formats.map(async (f) => [f, await fullImageSrc(ctx, post, f)] as const)));

  const shareBtn = (format: ShareFormat, label: string, o: { story?: boolean; primary?: boolean }) =>
    srcs[format]
      ? `<button type="button" data-share-btn data-url="${esc(srcs[format])}" data-filename="${esc(shareFilename(post.channel, format))}" data-format="${format}"${o.story ? ' data-story="1"' : ''}${o.primary ? ' data-default="1"' : ''} style="${buttonStyle(o.primary ? 'primary' : 'secondary')}margin:0 0 12px;">${esc(label)}</button>`
      : '';
  const shareBlock = formats.length
    ? `<div hidden data-needs-share>${shareBtn(main, sh.share, { primary: true })}${main === STORY_FORMAT ? '' : shareBtn(STORY_FORMAT, sh.shareStory, { story: true })}<p hidden data-ios-hint style="${SMALL_NOTE}">${esc(sh.iosHint)}</p></div>`
    : '';
  const downloads = formats.length
    ? `<div data-no-share>${formats
        .map(
          (f) =>
            `<a href="${esc(srcs[f])}" download="${esc(shareFilename(post.channel, f))}" data-download-link data-format="${f}" style="${buttonStyle(f === main ? 'primary' : 'secondary')}margin:0 0 12px;">${esc(sh.downloadFormat[f])}</a>`,
        )
        .join('')}</div>`
    : `<p style="${SMALL_NOTE}">${esc(sh.noImage)}</p>`;
  const copy = `<div hidden data-js-only><button type="button" data-copy-btn style="${buttonStyle('secondary')}margin:0 0 12px;">${esc(sh.copyCaption)}</button></div>`;
  const message = `<p hidden data-share-msg role="status" style="margin:0 0 12px;padding:8px 12px;border-radius:8px;background:#ecfdf5;border:1px solid #6ee7b7;color:#065f46;font-size:15px;"></p>`;
  const paste = `<details style="margin:0 0 12px;"><summary style="cursor:pointer;font-size:15px;color:${MUTED};">${esc(sh.textToPaste)}</summary><textarea readonly rows="6" style="display:block;box-sizing:border-box;width:100%;margin:8px 0 0;border:1px solid #d6d3d1;border-radius:8px;padding:10px 12px;font:inherit;font-size:16px;">${esc(text)}</textarea></details>`;
  const prompt = `<p hidden data-share-prompt style="margin:0 0 8px;font-weight:600;">${esc(sh.didYouPost)}</p>`;
  const mark = opForm(ctx, 'posted', { hidden: { post: post.id }, buttons: [{ label: sh.markPosted, kind: 'secondary' }] });

  return `<div data-share-root data-post="${esc(post.id)}" data-text="${esc(text)}" data-token="${esc(ctx.token)}" data-nonce="${esc(ctx.nonce)}">${shareBlock}${downloads}${copy}${message}${paste}${prompt}${mark}</div>`;
}

/** A post named in a form, if it is one of the week this ready link is for. */
async function readyPost(ctx: LinkContext, form: FormData): Promise<PostRecord | null> {
  const id = formText(form, 'post');
  if (!UUID_RE.test(id)) return null;
  const post = await loadPost(ctx.brand.id, id);
  if (!post || (ctx.claims.weekStart && post.weekStart !== ctx.claims.weekStart)) return null;
  return post;
}

async function readyView(ctx: LinkContext, flash: Notice[] = []): Promise<LinkPage> {
  const wk = ctx.claims.weekStart;
  const ids = await getDb().withService(async (tx) => {
    const [batch] = await tx.query<{ id: string; week_start: string }>(
      wk
        ? `select id::text as id, week_start::text as week_start from public.weekly_batches where brand_id = $1 and week_start = $2::date`
        : `select id::text as id, week_start::text as week_start from public.weekly_batches where brand_id = $1 and status = 'ready' order by week_start desc limit 1`,
      wk ? [ctx.brand.id, wk] : [ctx.brand.id],
    );
    if (!batch) return { weekStart: wk ?? null, posts: [] as string[] };
    const rows = await tx.query<{ id: string }>(
      `select id::text as id from public.posts where batch_id = $1 and brand_id = $2 and status in ('approved', 'posted')
        order by suggested_day, created_at, id`,
      [batch.id, ctx.brand.id],
    );
    return { weekStart: batch.week_start, posts: rows.map((r) => r.id) };
  });
  const posts = (await Promise.all(ids.posts.map((id) => loadPost(ctx.brand.id, id)))).filter((p): p is PostRecord => Boolean(p));
  const allHref = hrefFor(await tokenFor(ctx, 'view_week', undefined, ids.weekStart ?? undefined));
  const intro = ids.weekStart ? `<p style="margin:0 0 20px;color:${MUTED};">${esc(fill(t.ready.forWeek, { date: formatDayMonth(ids.weekStart) }))}</p>` : '';
  const cards = await Promise.all(
    posts.map(async (p) => `<div style="margin:0 0 28px;padding:0 0 12px;border-bottom:1px solid #e7e5e4;">${await postPreview(ctx, p)}${await readyPostActions(ctx, p)}</div>`),
  );
  return {
    title: t.ready.title,
    body: doneBody(notices(flash), intro, posts.length ? cards.join('\n') : para(t.ready.empty), linkButton(allHref, t.ready.seeAll)),
    // The share buttons need a little JavaScript; the page works without it (Download and the text to paste).
    script: posts.some((p) => p.status === 'approved') ? sharePageScript() : undefined,
  };
}

const readyHandler: LinkHandler = {
  // A link for one post made from a brief (v3 delivery) opens that post's page; every other ready link is the v2 week page.
  view: async (ctx) => (await deliveryReadyPage(ctx)) ?? readyView(ctx),
  async act(ctx, form) {
    const delivery = await deliveryReadyPage(ctx, form);
    if (delivery) return delivery;
    switch (formText(form, 'op')) {
      case 'posted':
      case 'unposted': {
        const op = formText(form, 'op');
        const post = await readyPost(ctx, form);
        if (!post) return readyView(ctx, [{ kind: 'error', text: t.errors.notFound }]);
        const ref = { brandId: ctx.brand.id, postId: post.id, actor: { via: 'email_link', jtiHash: ctx.jtiHash } } as const;
        const r = op === 'posted' ? await markPosted(ref) : await unmarkPosted(ref);
        if (!r.ok) return readyView(ctx, [failNotice(r)]);
        return readyView(ctx, [{ kind: 'ok', text: op === 'posted' ? sh.markedPosted : sh.unmarked }]);
      }
      case 'log': {
        // Sent by the page script after a share or download. Nobody reads the answer.
        const post = await readyPost(ctx, form);
        const kind = formText(form, 'kind');
        if (!post || (kind !== 'share' && kind !== 'download')) return { status: 400, title: t.errors.unknownOp, body: '' };
        const ref = { brandId: ctx.brand.id, postId: post.id, actor: { via: 'email_link', jtiHash: ctx.jtiHash } } as const;
        const format = formText(form, 'format');
        const r = kind === 'share' ? await logShare({ ...ref, format, story: formText(form, 'story') === '1' }) : await logDownload({ ...ref, format });
        return { status: r.ok ? 200 : 400, title: r.ok ? sh.share : r.message, body: '' };
      }
      default:
        return readyView(ctx);
    }
  },
};

export function registerApprovalLinkHandlers(): void {
  registerLinkHandler('approve', approveHandler);
  registerLinkHandler('skip', skipHandler);
  registerLinkHandler('edit', editHandler);
  registerLinkHandler('ready', readyHandler);
}
