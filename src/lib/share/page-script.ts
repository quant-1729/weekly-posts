// The script for the no-login "ready" page (Req 17). The page is plain HTML, so the share code in
// core.ts is sent as an inline script: its source text, called with the page's window. The page
// CSP allows exactly this script by hash (see src/lib/links/page.ts).

import { s } from '@/lib/i18n/strings';
import { bindShareDom, createShareKit, type ShareDomText } from './core';

export function sharePageText(): ShareDomText {
  const t = s.share;
  return { copied: t.copied, pasteHint: t.pasteHint, copyFailed: t.copyFailed, imageFailed: t.imageFailed, shareFailed: t.shareFailed, tapAgain: t.tapAgain, preparing: t.preparing };
}

/** JavaScript source for the ready page. Contains no user data. */
export function sharePageScript(): string {
  const text = JSON.stringify(sharePageText()).replace(/</g, '\\u003c');
  return `(${bindShareDom.toString()})(${createShareKit.toString()}, window, ${text});`;
}
