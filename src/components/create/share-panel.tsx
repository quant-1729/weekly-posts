"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { hintClass, iconButtonOutline, popoverClass } from "@/components/ui";
import { useDismiss } from "@/components/ui/use-dismiss";
import type { DesignFormat } from "@/lib/design/types";
import { s } from "@/lib/i18n/strings";
import { createShareKit, type ShareKit } from "@/lib/share/core";

const t = s.share;
const sizes = s.create.review.share.sizeNames;
const share = s.create.review.share;

const itemClass = "flex min-h-9 w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-ui text-sub hover:bg-fill-active focus-visible:bg-fill-active max-md:min-h-11 disabled:text-faint";


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
 * One small Share icon button; it opens a menu with Share on phone (where the browser can share a picture file),
 * Download for each size and Copy caption, for one approved post. The same share kit as the v2 week screen
 * (`createShareKit`); the sizes are the ones the post's channel needs. `defaultOpen` is for tests.
 */
export function SharePanel({
  postId,
  channel,
  images,
  slides = [],
  shareText,
  onLog,
  defaultOpen = false,
}: {
  postId: string;
  channel: string;
  images: { format: DesignFormat; url: string }[];
  /** A carousel's slides in order: Share and Download then work on all of them at once. */
  slides?: string[];
  /** Caption, call to action with link, hashtags: what Share and Copy send. */
  shareText: string;
  onLog?: (kind: "share" | "download", format: DesignFormat) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback((reason: "escape" | "outside" | "pick" = "pick") => {
    setOpen(false);
    if (reason === "escape") trigger.current?.focus();
  }, []);
  useDismiss(open, root, close);
  useEffect(() => {
    if (open && !defaultOpen) menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [open, defaultOpen]);

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Tab") close();
  }

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

  const slideFile = (url: string, i: number): Promise<File | null> => {
    let p = files.current.get(url);
    if (!p) {
      const kit = makeKit();
      p = kit ? kit.prepare(url, `${channel.replace(/[^a-z0-9]+/gi, "") || "post"}-slide-${i + 1}.png`) : Promise.resolve(null);
      files.current.set(url, p);
      void p.then((f) => {
        if (!f) files.current.delete(url);
      });
    }
    return p;
  };

  /** Shares every slide as files in one share sheet (where the browser can share files). */
  async function onShareAll() {
    const kit = makeKit();
    if (!kit) return;
    setMessage({ kind: "ok", text: t.preparing });
    setSharing(true);
    const list = await Promise.all(slides.map(slideFile));
    if (list.some((f) => !f)) {
      setSharing(false);
      setMessage({ kind: "error", text: t.imageFailed });
      return;
    }
    const out = await kit.share(list as File[], shareText);
    setSharing(false);
    setMessage(null);
    if (out.kind === "shared") {
      if (out.copied) setMessage({ kind: "ok", text: t.pasteHint });
      onLog?.("share", images[0]?.format ?? "portrait");
    } else if (out.kind === "error") {
      setMessage({ kind: "error", text: out.name === "NotAllowedError" ? t.tapAgain : t.shareFailed });
    } else if (out.kind === "unsupported") {
      setMessage({ kind: "error", text: t.shareFailed });
    }
  }

  /** Downloads the slides one after the other (each is its own file). */
  function onDownloadAll() {
    onLog?.("download", images[0]?.format ?? "portrait");
    slides.forEach((url, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = url;
        a.download = `${channel.replace(/[^a-z0-9]+/gi, "") || "post"}-slide-${i + 1}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 250);
    });
  }

  const carousel = slides.length > 1;

  async function onCopy() {
    const ok = (await makeKit()?.copyText(shareText)) === true;
    setMessage(ok ? { kind: "ok", text: t.copied } : { kind: "error", text: t.copyFailed });
  }

  return (
    <div className="space-y-2" data-share-root data-share-post={postId}>
      {images.length === 0 ? <p className={hintClass}>{t.noImage}</p> : null}
      <div ref={root} className="relative inline-block">
        <button
          ref={trigger}
          type="button"
          className={iconButtonOutline}
          aria-label={share.button}
          aria-haspopup="menu"
          aria-expanded={open}
          data-share-trigger
          onClick={() => setOpen(!open)}
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 15V3" />
            <path d="M8 7l4-4 4 4" />
            <path d="M5 12v6a2 2 0 002 2h10a2 2 0 002-2v-6" />
          </svg>
        </button>
        <div
          ref={menu}
          role="menu"
          aria-label={share.menuLabel}
          hidden={!open}
          data-share-menu
          onKeyDown={onMenuKey}
          className={`${popoverClass} absolute left-0 top-full mt-1 w-60 max-w-[calc(100vw-2rem)]`}
        >
          {carousel && canShare ? (
            <button
              type="button"
              role="menuitem"
              className={itemClass}
              disabled={sharing}
              data-share-all
              onPointerDown={() => void Promise.all(slides.map(slideFile))}
              onClick={() => {
                close();
                void onShareAll();
              }}
            >
              {share.shareAll.replace("{n}", String(slides.length))}
            </button>
          ) : null}
          {carousel ? (
            <button
              type="button"
              role="menuitem"
              className={itemClass}
              data-download-all
              onClick={() => {
                onDownloadAll();
                setTimeout(close, 0);
              }}
            >
              {share.downloadAll.replace("{n}", String(slides.length))}
            </button>
          ) : null}
          {!carousel && canShare
            ? images.map((img) => (
                <button
                  key={`share-${img.format}`}
                  type="button"
                  role="menuitem"
                  className={itemClass}
                  disabled={sharing}
                  onPointerDown={() => void fileFor(img)}
                  onClick={() => {
                    close();
                    void onShare(img);
                  }}
                >
                  {images.length > 1 ? share.shareSize.replace("{size}", sizes[img.format]) : share.onPhone}
                </button>
              ))
            : null}
          {(carousel ? [] : images).map((img) => (
            <a
              key={`download-${img.format}`}
              role="menuitem"
              href={img.url}
              download={filename(channel, img.format)}
              className={itemClass}
              onClick={() => {
                onLog?.("download", img.format);
                setTimeout(close, 0); // after the browser has started the download
              }}
            >
              {share.downloadSize.replace("{size}", sizes[img.format])}
            </a>
          ))}
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              close();
              void onCopy();
            }}
          >
            {t.copyCaption}
          </button>
        </div>
      </div>
      {canShare && ios ? <p className={hintClass}>{t.iosHint}</p> : null}
      {message ? (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-[13px] font-medium leading-[18px] text-err-tx" : "text-[13px] font-medium leading-[18px] text-ok-tx"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
