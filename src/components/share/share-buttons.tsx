"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { hintClass } from "@/components/ui";
import type { V2Channel } from "@/lib/ai/prompts/v2-weekly";
import { s } from "@/lib/i18n/strings";
import { createShareKit, type ShareKit } from "@/lib/share/core";
import { STORY_FORMAT, defaultShareFormat, shareFilename, type ShareFormat } from "@/lib/share/formats";

const t = s.share;

const smallButton =
  "min-h-11 rounded-lg border border-stone-300 bg-white px-4 py-2 text-base font-medium text-stone-800 disabled:opacity-50";
const strongButton = "min-h-11 rounded-lg bg-[#E4572E] px-4 py-2 text-base font-semibold text-white disabled:opacity-50";

const FORMAT_ORDER: ShareFormat[] = ["square", "vertical", "landscape"];

function makeKit(): ShareKit | null {
  if (typeof window === "undefined") return null;
  return createShareKit({
    navigator: window.navigator,
    fetch: (url, init) => window.fetch(url, init as RequestInit),
    File: window.File,
    document: window.document as never,
  });
}

// Whether this browser can share a picture file. False on the server and during the first render,
// so the page matches what the server drew and the Download links show until we know.
const noopSubscribe = () => () => undefined;
let canShareCache: boolean | undefined;
let iosCache: boolean | undefined;
const detectCanShare = () => (canShareCache ??= makeKit()?.canShareFiles() ?? false);
const detectIos = () => (iosCache ??= makeKit()?.isIos() ?? false);

/**
 * Share, Download, Copy caption and Mark as posted for one approved post (Req 17, 18).
 *
 * Phones that can share a picture get Share (and "Share as story or status" with the tall image,
 * the way to WhatsApp status). Everything else gets Download links, one per picture size. Copy
 * caption is always there. Feature detection only; the iPhone hint is the one user-agent check.
 */
export function ShareButtons({
  postId,
  channel,
  images,
  shareText,
  busy,
  onLog,
  onMarkPosted,
}: {
  postId: string;
  channel: V2Channel;
  /** Full-size pictures by format. */
  images: Partial<Record<ShareFormat, string>>;
  /** Caption, call to action with link, hashtags: what Share and Copy send. */
  shareText: string;
  busy: boolean;
  /** Called after a Share or Download (not Copy), to record it. */
  onLog: (kind: "share" | "download", format: ShareFormat, story: boolean) => void;
  onMarkPosted: () => void;
}) {
  const canShare = useSyncExternalStore(noopSubscribe, detectCanShare, () => false);
  const ios = useSyncExternalStore(noopSubscribe, detectIos, () => false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [asked, setAsked] = useState(false);
  const [sharing, setSharing] = useState(false);
  const files = useRef(new Map<string, Promise<File | null>>());
  const ready = useRef(new Set<string>());

  const main = defaultShareFormat(channel);
  const formats = FORMAT_ORDER.filter((f) => images[f]);

  // One File per picture, fetched once (the first tap or hover warms it, so the share sheet opens
  // while the tap still counts as a tap).
  function fileFor(format: ShareFormat): Promise<File | null> {
    const url = images[format];
    if (!url) return Promise.resolve(null);
    let p = files.current.get(url);
    if (!p) {
      const kit = makeKit();
      p = kit ? kit.prepare(url, shareFilename(channel, format)) : Promise.resolve(null);
      files.current.set(url, p);
      void p.then((f) => {
        if (!f) files.current.delete(url);
      });
    }
    return p;
  }

  async function onShare(format: ShareFormat, story: boolean) {
    const kit = makeKit();
    if (!kit) return;
    setMessage(null);
    const url = images[format] ?? "";
    const wasReady = ready.current.has(url);
    setSharing(true);
    if (!wasReady) setMessage({ kind: "ok", text: t.preparing });
    const file = await fileFor(format);
    if (!file) {
      setSharing(false);
      setMessage({ kind: "error", text: t.imageFailed });
      return;
    }
    ready.current.add(url);
    const out = await kit.share(file, shareText);
    setSharing(false);
    setMessage(null);
    if (out.kind === "shared") {
      if (out.copied) setMessage({ kind: "ok", text: t.pasteHint });
      onLog("share", format, story);
      setAsked(true);
    } else if (out.kind === "error") {
      setMessage({ kind: "error", text: out.name === "NotAllowedError" && !wasReady ? t.tapAgain : t.shareFailed });
    } else if (out.kind === "unsupported") {
      setMessage({ kind: "error", text: t.shareFailed });
    }
    // A cancelled share sheet (AbortError) says nothing.
  }

  async function onCopy() {
    const ok = (await makeKit()?.copyText(shareText)) === true;
    setMessage(ok ? { kind: "ok", text: t.copied } : { kind: "error", text: t.copyFailed });
  }

  return (
    <div className="space-y-3" data-share-root data-share-post={postId}>
      {canShare && formats.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {images[main] ? (
              <button type="button" className={strongButton} disabled={busy || sharing} onPointerDown={() => void fileFor(main)} onClick={() => void onShare(main, false)}>
                {t.share}
              </button>
            ) : null}
            {images[STORY_FORMAT] && main !== STORY_FORMAT ? (
              <button type="button" className={smallButton} disabled={busy || sharing} onPointerDown={() => void fileFor(STORY_FORMAT)} onClick={() => void onShare(STORY_FORMAT, true)}>
                {t.shareStory}
              </button>
            ) : null}
          </div>
          {ios ? <p className={hintClass}>{t.iosHint}</p> : null}
        </div>
      ) : null}

      {!canShare ? (
        formats.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {formats.map((f) => (
              <a
                key={f}
                href={images[f]}
                download={shareFilename(channel, f)}
                className={f === main ? strongButton + " inline-flex items-center" : smallButton + " inline-flex items-center"}
                onClick={() => {
                  onLog("download", f, false);
                  setAsked(true);
                }}
              >
                {t.downloadFormat[f]}
              </a>
            ))}
          </div>
        ) : (
          <p className={hintClass}>{t.noImage}</p>
        )
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="button" className={smallButton} onClick={() => void onCopy()}>
          {t.copyCaption}
        </button>
      </div>

      {message ? (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-sm font-medium text-red-700" : "text-sm font-medium text-green-800"}>
          {message.text}
        </p>
      ) : null}

      <div className="space-y-2 border-t border-stone-200 pt-3">
        {asked ? <p className="text-sm font-semibold text-stone-800">{t.didYouPost}</p> : null}
        <button type="button" className={asked ? strongButton : smallButton} disabled={busy} onClick={onMarkPosted}>
          {t.markPosted}
        </button>
      </div>
    </div>
  );
}
