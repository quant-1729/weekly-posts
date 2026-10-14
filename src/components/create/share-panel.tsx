"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { hintClass } from "@/components/ui";
import type { DesignFormat } from "@/lib/design/types";
import { s } from "@/lib/i18n/strings";
import { createShareKit, type ShareKit } from "@/lib/share/core";

const t = s.share;
const sizes = s.create.review.share.sizeNames;

const smallButton = "min-h-11 rounded-lg border border-stone-300 bg-white px-4 py-2 text-base font-medium text-stone-800 disabled:opacity-50";
const strongButton = "min-h-11 rounded-lg bg-[#E4572E] px-4 py-2 text-base font-semibold text-white disabled:opacity-50";

function makeKit(): ShareKit | null {
  if (typeof window === "undefined") return null;
  return createShareKit({
    navigator: window.navigator,
    fetch: (url, init) => window.fetch(url, init as RequestInit),
    File: window.File,
    document: window.document as never,
  });
}

// Whether this browser can share a picture file: false on the server and during the first render, so the
// page matches what the server drew and the Download links show until we know.
const noopSubscribe = () => () => undefined;
let canShareCache: boolean | undefined;
let iosCache: boolean | undefined;
const detectCanShare = () => (canShareCache ??= makeKit()?.canShareFiles() ?? false);
const detectIos = () => (iosCache ??= makeKit()?.isIos() ?? false);

const filename = (channel: string, format: DesignFormat) => `${channel.replace(/[^a-z0-9]+/gi, "") || "post"}-${format}.png`;

/**
 * Download each size, Share on phones, and Copy the caption, for one approved post. The same share kit as the
 * v2 week screen (`createShareKit`); the sizes are the ones the post's channel needs.
 */
export function SharePanel({
  postId,
  channel,
  images,
  shareText,
  onLog,
}: {
  postId: string;
  channel: string;
  images: { format: DesignFormat; url: string }[];
  /** Caption, call to action with link, hashtags: what Share and Copy send. */
  shareText: string;
  onLog?: (kind: "share" | "download", format: DesignFormat) => void;
}) {
  const canShare = useSyncExternalStore(noopSubscribe, detectCanShare, () => false);
  const ios = useSyncExternalStore(noopSubscribe, detectIos, () => false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [sharing, setSharing] = useState(false);
  const files = useRef(new Map<string, Promise<File | null>>());

  function fileFor(img: { format: DesignFormat; url: string }): Promise<File | null> {
    let p = files.current.get(img.url);
    if (!p) {
      const kit = makeKit();
      p = kit ? kit.prepare(img.url, filename(channel, img.format)) : Promise.resolve(null);
      files.current.set(img.url, p);
      void p.then((f) => {
        if (!f) files.current.delete(img.url);
      });
    }
    return p;
  }

  async function onShare(img: { format: DesignFormat; url: string }) {
    const kit = makeKit();
    if (!kit) return;
    setMessage(null);
    setSharing(true);
    setMessage({ kind: "ok", text: t.preparing });
    const file = await fileFor(img);
    if (!file) {
      setSharing(false);
      setMessage({ kind: "error", text: t.imageFailed });
      return;
    }
    const out = await kit.share(file, shareText);
    setSharing(false);
    setMessage(null);
    if (out.kind === "shared") {
      if (out.copied) setMessage({ kind: "ok", text: t.pasteHint });
      onLog?.("share", img.format);
    } else if (out.kind === "error") {
      setMessage({ kind: "error", text: out.name === "NotAllowedError" ? t.tapAgain : t.shareFailed });
    } else if (out.kind === "unsupported") {
      setMessage({ kind: "error", text: t.shareFailed });
    }
    // A cancelled share sheet says nothing.
  }

  async function onCopy() {
    const ok = (await makeKit()?.copyText(shareText)) === true;
    setMessage(ok ? { kind: "ok", text: t.copied } : { kind: "error", text: t.copyFailed });
  }

  return (
    <div className="space-y-3" data-share-root data-share-post={postId}>
      {images.length === 0 ? <p className={hintClass}>{t.noImage}</p> : null}
      <div className="flex flex-wrap gap-2">
        {images.map((img, i) =>
          canShare ? (
            <button
              key={img.format}
              type="button"
              className={i === 0 ? strongButton : smallButton}
              disabled={sharing}
              onPointerDown={() => void fileFor(img)}
              onClick={() => void onShare(img)}
            >
              {s.create.review.share.shareSize.replace("{size}", sizes[img.format])}
            </button>
          ) : (
            <a
              key={img.format}
              href={img.url}
              download={filename(channel, img.format)}
              className={`${i === 0 ? strongButton : smallButton} inline-flex items-center`}
              onClick={() => onLog?.("download", img.format)}
            >
              {s.create.review.share.downloadSize.replace("{size}", sizes[img.format])}
            </a>
          ),
        )}
        <button type="button" className={smallButton} onClick={() => void onCopy()}>
          {t.copyCaption}
        </button>
      </div>
      {canShare && ios ? <p className={hintClass}>{t.iosHint}</p> : null}
      {message ? (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-sm font-medium text-red-700" : "text-sm font-medium text-green-800"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
