// Delivery to the owner (PRD v3 S-3, change C-27): the email for a post that cannot (or could not) be
// auto-published. It carries the picture, the caption and a no-login "ready" link where the owner copies the
// caption and shares or downloads the picture (the same signed-link machinery as the v2 ready page).

import { APP_NAME } from '@/lib/app';
import { getDb } from '@/lib/db';
import { sendEmail as realSendEmail } from '@/lib/email';
import { button, COLORS, esc, FONT, footerParts, footerRow, footerText, headerRow, paragraph, row, shell } from '@/lib/email/layout';
import type { BuiltEmail } from '@/lib/email/notices';
import { channelFormats } from '@/lib/create/content';
import { shareTextFor } from '@/lib/create/view';
import type { DesignFormat } from '@/lib/design/types';
import { getEnv } from '@/lib/env';
import { fill, s } from '@/lib/i18n/strings';
import { imageUrl, linkUrl, signLink } from '@/lib/links/tokens';
import { formatSlot } from './format';
import type { PublishResult, QueueChannel } from './types';

const t = s.queue.email;

export interface DeliveryPost {
  id: string;
  brandId: string;
  channel: QueueChannel;
  caption: string;
  cta: string;
  hashtags: string[];
  postCode: string;
  /** The sizes that were drawn, in the channel's order. */
  formats: DesignFormat[];
  /** The carousel slides' post ids, in order (empty when there is no carousel). */
  slideIds: string[];
}

/** Loads what the email and the ready page show for one v3 post. Service role: the caller has the proof (a queue row or a signed link). */
export async function loadDeliveryPost(brandId: string, postId: string): Promise<DeliveryPost | null> {
  return getDb().withService(async (tx) => {
    const [p] = await tx.query<{ id: string; channel: string; caption: string | null; cta: string | null; hashtags: string[] | null; post_code: string; carousel_id: string | null }>(
      `select id::text as id, channel::text as channel, caption, cta, hashtags, post_code, design -> 'carousel' ->> 'id' as carousel_id
         from public.posts where id = $1 and brand_id = $2 and brief_id is not null and batch_id is null and carousel_id is null`,
      [postId, brandId],
    );
    if (!p) return null;
    const images = await tx.query<{ format: DesignFormat }>('select format::text as format from public.post_images where post_id = $1 and brand_id = $2', [postId, brandId]);
    const slides = p.carousel_id
      ? await tx.query<{ id: string }>('select id::text as id from public.posts where carousel_id = $1 and brand_id = $2 order by slide_index', [p.carousel_id, brandId])
      : [];
    const have = new Set(images.map((i) => i.format));
    return {
      id: p.id,
      brandId,
      channel: p.channel as QueueChannel,
      caption: p.caption ?? '',
      cta: p.cta ?? '',
      hashtags: p.hashtags ?? [],
      postCode: p.post_code,
      formats: channelFormats(p.channel).filter((f) => have.has(f)),
      slideIds: slides.map((x) => x.id),
    };
  });
}

/** Plain words for a failed publish, for the "we couldn't publish this" email. */
export const failureReason = (reason: Extract<PublishResult, { ok: false }>['reason'] | 'interrupted' | 'email_failed'): string =>
  (t.reasons as Record<string, string>)[reason] ?? t.reasons.unknown;

export interface BuildDeliveryInput {
  brand: { id: string; name: string };
  post: DeliveryPost;
  slotAt: string;
  timezone: string;
  /** 'delivery': the post is meant to be shared by the owner. 'fallback': auto-publishing failed. */
  kind: 'delivery' | 'fallback';
  /** For 'fallback': why, in plain words. */
  reason?: string;
  now?: Date;
}

export const channelLabel = (c: string): string => (s.create.channels.options as Record<string, string>)[c] ?? c;

/**
 * The email: subject, the picture (and the carousel's slides), the caption, and a button to the ready page where
 * Copy, Share and Download work. Email cannot copy by itself, so the caption is also printed in full.
 */
export async function buildDeliveryEmail(input: BuildDeliveryInput): Promise<BuiltEmail> {
  const { brand, post, now } = input;
  const channel = channelLabel(post.channel);
  const when = formatSlot(input.slotAt, input.timezone);
  const fallback = input.kind === 'fallback';
  const subject = fill(fallback ? t.subjectFallback : t.subject, { channel });
  const intro = fallback ? fill(t.introFallback, { channel, reason: input.reason ?? t.reasons.unknown }) : fill(t.intro, { channel, when });
  const main = post.formats[0] ?? null;

  const [footer, readyToken, mainToken, fullToken] = await Promise.all([
    footerParts(brand.id, now),
    signLink({ brandId: brand.id, postId: post.id, act: 'ready', now }),
    main ? signLink({ brandId: brand.id, postId: post.id, act: 'img', extra: { format: main }, now }) : Promise.resolve(null),
    main ? signLink({ brandId: brand.id, postId: post.id, act: 'img', extra: { format: main, full: true }, now }) : Promise.resolve(null),
  ]);
  const readyUrl = linkUrl(readyToken);
  const mainUrl = mainToken ? imageUrl(mainToken) : null;
  const downloadUrl = fullToken ? imageUrl(fullToken) : null;
  const slideUrls = main
    ? await Promise.all(post.slideIds.slice(0, 10).map(async (id) => imageUrl(await signLink({ brandId: brand.id, postId: id, act: 'img', extra: { format: main }, now }))))
    : [];

  const text = shareTextFor({ channel: post.channel, caption: post.caption, cta: post.cta, hashtags: post.hashtags, postCode: post.postCode }, getEnv().appUrl);

  const picture = mainUrl
    ? `<img src="${esc(mainUrl)}" width="560" alt="${esc(fill(t.imageAlt, { channel }))}" style="display:block;width:100%;max-width:560px;height:auto;border:0;outline:none;text-decoration:none;background-color:${COLORS.page};">`
    : paragraph(t.noImage, { color: COLORS.muted });
  const slides =
    slideUrls.length > 0
      ? `${paragraph(fill(t.slides, { n: post.slideIds.length }), { bold: true, margin: '12px 0 6px' })}<p style="margin:0;font-size:0;">${slideUrls
          .map((u, i) => `<img src="${esc(u)}" width="86" alt="${esc(fill(t.slideAlt, { n: i + 1 }))}" style="width:86px;height:auto;border:0;margin:0 6px 6px 0;background-color:${COLORS.page};">`)
          .join('')}</p>`
      : '';
  const captionBox = `<p style="margin:0 0 6px;font-family:${FONT};font-size:14px;font-weight:bold;color:${COLORS.muted};">${esc(t.captionLabel)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${COLORS.page}" style="background-color:${COLORS.page};border:1px solid ${COLORS.line};border-radius:6px;padding:12px;font-family:${FONT};font-size:15px;line-height:1.5;color:${COLORS.text};white-space:pre-wrap;">${esc(text)}</td></tr></table>`;

  const rows = [
    headerRow(brand.name),
    row(`${paragraph(subject, { size: 20, bold: true, margin: '0 0 8px' })}${paragraph(intro)}`, '20px 20px 0 20px'),
    row(`${picture}${slides}`, '4px 20px 0 20px'),
    row(captionBox, '16px 20px 0 20px'),
    row(`${button(readyUrl, t.button, 'primary', true)}`, '16px 20px 0 20px'),
    row(`${paragraph(t.help, { size: 14, color: COLORS.muted, margin: '0 0 8px' })}${downloadUrl ? button(downloadUrl, t.download, 'secondary') : ''}`, '8px 20px 0 20px'),
    footerRow(brand.name, footer.links),
  ];
  const html = shell({ title: subject, preheader: fill(t.preheader, { channel }), rows });
  const lines = [
    `${APP_NAME} - ${fill(s.email.forBrand, { name: brand.name })}`,
    '',
    subject,
    intro,
    '',
    `${t.button}: ${readyUrl}`,
    ...(downloadUrl ? [`${t.download}: ${downloadUrl}`] : []),
    '',
    t.captionLabel,
    text,
    '',
    t.help,
    '',
    ...footerText(brand.name, footer.links),
    '',
  ];
  return { subject, html, text: lines.join('\n'), headers: footer.headers };
}

export interface Owner {
  userId: string;
  email: string;
}

/** The brand's owners with an email address. */
export async function loadOwnerEmails(brandId: string): Promise<Owner[]> {
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

/** Sends the delivery email to every owner. Returns how many were sent (0 = none, so the caller can retry). */
export async function sendDeliveryEmail(
  args: BuildDeliveryInput & { send?: typeof realSendEmail },
): Promise<{ sent: number; error: string | null }> {
  const owners = await loadOwnerEmails(args.brand.id);
  if (owners.length === 0) return { sent: 0, error: 'no recipients' };
  const built = await buildDeliveryEmail(args);
  const send = args.send ?? realSendEmail;
  let sent = 0;
  let error: string | null = null;
  for (const o of owners) {
    try {
      await send({ to: o.email, userId: o.userId, brandId: args.brand.id, kind: 'post_delivery', ...built });
      sent += 1;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.error(`[queue] delivery email failed for brand ${args.brand.id}: ${error}`);
    }
  }
  return { sent, error };
}
