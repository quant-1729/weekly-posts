/**
 * Saving a brief from the editor (PRD v3 B-4.1, B-8): the brief service plus the one check it
 * cannot do itself, that a link QR points at a public address (`checkQrUrl`, with a DNS lookup).
 *
 * - A draft with a bad QR link still saves everything else; the QR is left as it was and the
 *   text of the problem comes back in `qrError`.
 * - "ready" with a bad QR link is refused (BriefValidationError on `qr`).
 * - "ready" with missing items is refused by the brief service (BriefIncompleteError).
 */
import { checkQrUrl, type QrResolver } from '@/lib/qr';
import { s } from '@/lib/i18n/strings';
import { BriefValidationError } from './errors';
import { createBrief, updateBrief, type BriefInput } from './service';
import type { Brief } from './types';

export interface SaveFromEditorOptions {
  status?: 'draft' | 'ready';
  now?: Date;
  /** For tests: the DNS lookup used to check a QR link. */
  resolver?: QrResolver;
  /** For tests: skip the DNS lookup and check only the text of the link. */
  resolve?: boolean;
}

export interface SaveFromEditorResult {
  brief: Brief;
  /** Owner-facing text when the QR link was refused; null otherwise. */
  qrError: string | null;
}

const qrErrors = s.create.qr.errors as Record<string, string>;

/** Creates (`briefId` null) or updates a brief from the editor's input. */
export async function saveBriefFromEditor(
  userId: string,
  brandId: string,
  briefId: string | null,
  input: BriefInput,
  opts: SaveFromEditorOptions = {},
): Promise<SaveFromEditorResult> {
  const status = opts.status ?? 'draft';
  let qrError: string | null = null;
  const next: BriefInput = { ...input };

  const qr = input.qr as { kind?: string; url?: string } | null | undefined;
  if (qr && qr.kind === 'link') {
    const check = await checkQrUrl(String(qr.url ?? ''), { resolver: opts.resolver, resolve: opts.resolve });
    if (!check.ok) {
      qrError = qrErrors[check.reason] ?? qrErrors.generic;
      delete next.qr; // keep whatever QR was saved before
    } else {
      next.qr = { ...(qr as object), url: check.url };
    }
  }
  if (qrError && status === 'ready') throw new BriefValidationError({ qr: 'invalid_url' });

  const saveOpts = { now: opts.now };
  const brief =
    briefId === null
      ? await createBrief(userId, brandId, { ...next, status }, saveOpts)
      : await updateBrief(userId, brandId, briefId, { ...next, status }, saveOpts);
  return { brief, qrError };
}
