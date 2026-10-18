"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  moveItemAction,
  postNowItemAction,
  postNowReadyAction,
  refreshQueueAction,
  scheduleReadyAction,
  skipItemAction,
  slotOptionsAction,
  unscheduleItemAction,
  type QueueActionResult,
} from "@/app/(app)/week/queue-actions";
import { alertClass, badge, cardClass, errorClass, hintClass, iconButtonOutline, inputClass, labelClass, linkButton, quietButton, secondaryButton, smallButton, strongButton, wellClass, type BadgeTone } from "@/components/ui";
import { LiveDot } from "@/components/live/live-dot";
import { useLiveDoc, useLiveKind } from "@/components/live/use-live";
import { fill, s } from "@/lib/i18n/strings";
import type { QueueStatus } from "@/lib/queue/types";
import type { QueueCard, QueueView, ReadyCard } from "@/lib/queue/view";

const t = s.queue;


const STATUS_TONE: Record<string, BadgeTone> = {
  scheduled: "info",
  publishing: "info",
  published: "ok",
  delivered: "ok",
  missed: "warn",
  failed: "err",
  expired: "neutral",
};

/** After a live signal, wait this long (so a burst of changes is one refresh) before asking the server for the page's data. */
const LIVE_REFRESH_MS = 400;

/** Shows a new status on one card straight away (the full refresh follows). Everything else stays as it is. */
export function patchStatus(view: QueueView, itemId: string, status: QueueStatus): QueueView {
  let changed = false;
  const patch = (c: QueueCard): QueueCard => {
    if (c.id !== itemId || c.status === status) return c;
    changed = true;
    return { ...c, status, statusLabel: t.statuses[status] };
  };
  const next = {
    ...view,
    attention: view.attention.map(patch),
    upcoming: view.upcoming.map((d) => ({ ...d, items: d.items.map(patch) })),
    recent: view.recent.map(patch),
  };
  return changed ? next : view;
}

type Message = { kind: "ok" | "error"; text: string };
type Options = { key: string; list: { at: string; label: string }[]; picked: string };

interface Shared {
  run: (name: string, fn: () => Promise<QueueActionResult>) => Promise<void>;
  busy: string | null;
  options: Options | null;
  setOptions: (o: Options | null) => void;
  openOptions: (key: string, postId: string) => Promise<void>;
}

/** The Queue (PRD v3 S-1 to S-6): what is coming, what needs the owner, and what is ready to schedule. The settings are on /week/settings. */
export function QueueScreen({ initial, brandId }: { initial: QueueView; brandId?: string | null }) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [options, setOptions] = useState<Options | null>(null);

  // Live status (docs/14-firebase-plan.md): other devices and the hourly sweep ring a bell; this screen shows the new badge
  // at once and then re-reads the page's data. When live is off nothing below does anything and the page works as before.
  const { live, docs } = useLiveKind(brandId, "queue");
  const { live: touchLive, doc: touch } = useLiveDoc(brandId, "queue_touch");
  const busyRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenItems = useRef<Map<string, number> | null>(null);
  const seenTouch = useRef<number | null>(null);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  function scheduleRefresh() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (busyRef.current !== null) return; // an action of this screen is running; its answer carries the new view
      void refreshQueueAction().then((r) => {
        if (r.ok && r.view && busyRef.current === null) setView(r.view);
      });
    }, LIVE_REFRESH_MS);
  }

  useEffect(() => {
    if (!live) {
      seenItems.current = null;
      return;
    }
    if (seenItems.current === null) {
      // First answer: what is there already is not news, but one refresh closes the gap since the page was drawn.
      seenItems.current = new Map(docs.map((d) => [d.id, d.seq]));
      scheduleRefresh();
      return;
    }
    const seen = seenItems.current;
    let news = false;
    for (const d of docs) {
      if (d.seq <= (seen.get(d.id) ?? 0)) continue; // an older or repeated write is ignored
      seen.set(d.id, d.seq);
      news = true;
      setView((v) => patchStatus(v, d.itemId, d.status));
    }
    if (news) scheduleRefresh();
  }, [live, docs]);

  useEffect(() => {
    if (!touchLive) {
      seenTouch.current = null;
      return;
    }
    const seq = touch?.seq ?? 0;
    if (seenTouch.current === null) {
      seenTouch.current = seq;
      return;
    }
    if (seq > seenTouch.current) {
      seenTouch.current = seq;
      scheduleRefresh();
    }
  }, [touchLive, touch]);

  async function run(name: string, fn: () => Promise<QueueActionResult>) {
    setBusy(name);
    setMessage(null);
    const r = await fn();
    if (r.view) setView(r.view);
    if (r.message) setMessage({ kind: r.ok ? "ok" : "error", text: r.message });
    setOptions(null);
    setBusy(null);
  }

  async function openOptions(key: string, postId: string) {
    setBusy(`opts:${key}`);
    setMessage(null);
    const r = await slotOptionsAction(postId);
    setBusy(null);
    if (!r.ok) return setMessage({ kind: "error", text: r.message });
    if (r.options.length === 0) return setMessage({ kind: "error", text: t.actions.noSlots });
    setOptions({ key, list: r.options, picked: r.options[0].at });
  }

  const shared: Shared = { run, busy, options, setOptions, openOptions };
  const paused = view.settings.paused;

  return (
    <div className="space-y-8" data-queue>
      {message ? (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? errorClass : "text-[13px] font-medium leading-[18px] text-ok-tx"} data-queue-message>
          {message.text}
        </p>
      ) : null}
      {paused ? (
        <div className={`${alertClass("warn")} space-y-1`} data-queue-paused>
          <p>{t.upcoming.pausedNote}</p>
          <Link href="/week/settings" className={linkButton} data-queue-paused-link>
            {t.upcoming.pausedLink}
          </Link>
        </div>
      ) : null}

      {view.attention.length > 0 ? (
        <section className="space-y-3" aria-label={t.sections.attention} data-queue-attention>
          <div>
            <h2 className="text-section text-title">{t.sections.attention}</h2>
            <p className={hintClass}>{t.attention.intro}</p>
          </div>
          <ul className="grid gap-3 lg:grid-cols-2">
            {view.attention.map((c) => (
              <ItemCard key={c.id} card={c} shared={shared} />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3" aria-label={t.sections.upcoming} data-queue-upcoming>
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-section text-title">{t.sections.upcoming}</h2>
            <LiveDot live={live} />
          </div>
          <Link href="/week/settings" className={iconButtonOutline} aria-label={t.settingsPage.open} title={t.settingsPage.open} data-queue-settings-link>
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
          </Link>
        </div>
        {view.upcoming.length === 0 ? (
          <div className={`space-y-3 ${cardClass}`}>
            <p className="text-[14px] leading-5 text-desc">{t.upcoming.empty}</p>
            <Link href="/create" data-create-button className={secondaryButton}>
              {t.upcoming.createFirst}
            </Link>
          </div>
        ) : (
          view.upcoming.map((day) => (
            <div key={day.date} className="space-y-2" data-day={day.date}>
              <h3 className="mt-5 text-note uppercase tracking-[0.06em] text-desc">{day.label}</h3>
              <ul className="grid gap-3 lg:grid-cols-2">
                {day.items.map((c) => (
                  <ItemCard key={c.id} card={c} shared={shared} />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section className="space-y-3" aria-label={t.sections.ready} data-queue-ready>
        <div>
          <h2 className="text-section text-title">{t.sections.ready}</h2>
          <p className={hintClass}>{view.ready.length > 0 ? t.ready.intro : t.ready.empty}</p>
        </div>
        {view.ready.length > 0 ? (
          <ul className="grid gap-3 lg:grid-cols-2">
            {view.ready.map((r, i) => (
              <ReadyItem key={r.postId} card={r} first={i === 0} shared={shared} />
            ))}
          </ul>
        ) : null}
      </section>

      {view.recent.length > 0 ? (
        <section className="space-y-3" aria-label={t.sections.recent} data-queue-recent>
          <h2 className="text-section text-title">{t.sections.recent}</h2>
          <ul className="grid gap-3 lg:grid-cols-2">
            {view.recent.map((c) => (
              <ItemCard key={c.id} card={c} shared={shared} />
            ))}
          </ul>
        </section>
      ) : null}

    </div>
  );
}

function Thumb({ url, alt }: { url: string | null; alt: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={alt} className="size-20 shrink-0 rounded-xl bg-well object-cover ring-1 ring-black/5 max-md:size-16" />
  ) : (
    <div className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-well p-1 text-center text-note text-helper max-md:size-16">{t.noImage}</div>
  );
}

function SlotPicker({ id, shared, onPick, label }: { id: string; shared: Shared; onPick: (at: string) => void; label: string }) {
  const { options, setOptions, busy } = shared;
  if (!options || options.key !== id) return null;
  return (
    <div className={`space-y-2 ${wellClass}`} data-slot-picker>
      <label className={labelClass}>
        {label}
        <select className={`${inputClass} mt-1.5 font-normal`} value={options.picked} onChange={(e) => setOptions({ ...options, picked: e.target.value })}>
          {options.list.map((o) => (
            <option key={o.at} value={o.at}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={strongButton} disabled={busy !== null} onClick={() => onPick(options.picked)}>
          {t.actions.confirmMove}
        </button>
        <button type="button" className={quietButton} disabled={busy !== null} onClick={() => setOptions(null)}>
          {t.actions.cancel}
        </button>
      </div>
    </div>
  );
}

function ItemCard({ card, shared }: { card: QueueCard; shared: Shared }) {
  const { run, busy } = shared;
  const sent = card.status === "published" || card.status === "delivered";
  const working = busy !== null;
  return (
    <li className={`min-w-0 space-y-3 ${cardClass}`} data-item-id={card.id} data-status={card.status} data-mode={card.mode} data-channel={card.channel}>
      <div className="flex gap-3">
        <Thumb url={card.imageUrl} alt={`${card.channelLabel}: ${card.headline}`} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-ui text-title">{card.channelLabel}</h3>
            <span className={`${badge(STATUS_TONE[card.status] ?? "info")}${card.status === "publishing" ? " animate-pulse" : ""}`} data-status-badge>
              {card.statusLabel}
            </span>
          </div>
          <p className="text-[13px] leading-[18px] text-desc" data-when>
            {card.when}
          </p>
          {card.headline ? <p className="truncate text-ui text-ink">{card.headline}</p> : null}
          <p className="text-note text-desc" data-mode-badge>
            {card.modeLabel}
          </p>
        </div>
      </div>
      {card.reason ? <p className={alertClass("warn")}>{card.reason}</p> : null}
      {sent && card.permalink ? (
        <a href={card.permalink} className={linkButton} target="_blank" rel="noreferrer">
          {fill(t.recent.view, { channel: card.channelLabel })}
        </a>
      ) : null}
      {card.status === "delivered" && card.reviewHref ? (
        <Link href={card.reviewHref} className={linkButton}>
          {t.recent.share}
        </Link>
      ) : null}
      {card.actionable ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={smallButton} disabled={working} onClick={() => void shared.openOptions(card.id, card.postId)}>
              {t.actions.move}
            </button>
            <button type="button" className={strongButton} disabled={working} onClick={() => void run("now", () => postNowItemAction(card.id))}>
              {busy === "now" ? t.actions.working : t.actions.postNow}
            </button>
            <button type="button" className={smallButton} disabled={working} onClick={() => void run("skip", () => skipItemAction(card.id))}>
              {t.actions.skip}
            </button>
            <button type="button" className={smallButton} disabled={working} onClick={() => void run("unschedule", () => unscheduleItemAction(card.id))}>
              {t.actions.unschedule}
            </button>
          </div>
          <SlotPicker id={card.id} shared={shared} label={fill(t.actions.choose, { channel: card.channelLabel })} onPick={(at) => void run("move", () => moveItemAction(card.id, at))} />
        </div>
      ) : null}
      {card.status === "expired" ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={smallButton} disabled={working} onClick={() => void run("skip", () => skipItemAction(card.id))}>
            {t.actions.skip}
          </button>
          <button type="button" className={smallButton} disabled={working} onClick={() => void run("unschedule", () => unscheduleItemAction(card.id))}>
            {t.actions.unschedule}
          </button>
        </div>
      ) : null}
      {card.reviewHref && (card.status === "failed" || card.status === "missed") ? (
        <Link href={card.reviewHref} className={linkButton}>
          {t.actions.share}
        </Link>
      ) : null}
    </li>
  );
}

function ReadyItem({ card, first, shared }: { card: ReadyCard; first: boolean; shared: Shared }) {
  const { run, busy } = shared;
  const working = busy !== null;
  return (
    <li className={`min-w-0 space-y-3 ${cardClass}`} data-ready-post-id={card.postId} data-channel={card.channel}>
      <div className="flex gap-3">
        <Thumb url={card.imageUrl} alt={`${card.channelLabel}: ${card.headline}`} />
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-ui text-title">{card.channelLabel}</h3>
          {card.headline ? <p className="truncate text-ui text-ink">{card.headline}</p> : null}
        </div>
      </div>
      {card.ended ? <p className={alertClass("warn")}>{t.attention.reasons.expired}</p> : null}
      <div className="flex flex-wrap gap-2">
        {!card.ended ? (
          <button
            type="button"
            className={strongButton}
            data-tween-target={first ? "schedule" : undefined}
            disabled={working}
            onClick={() => void run("schedule", () => scheduleReadyAction(card.postId))}
          >
            {busy === "schedule" ? t.actions.working : t.ready.schedule}
          </button>
        ) : null}
        {!card.ended ? (
          <button type="button" className={smallButton} disabled={working} onClick={() => void shared.openOptions(`ready:${card.postId}`, card.postId)}>
            {t.actions.pickTime}
          </button>
        ) : null}
        {!card.ended ? (
          <button type="button" className={smallButton} disabled={working} onClick={() => void run("now", () => postNowReadyAction(card.postId))}>
            {busy === "now" ? t.actions.working : t.ready.postNow}
          </button>
        ) : null}
        <Link href={`/create/${card.briefId}/review`} className={quietButton}>
          {t.actions.review}
        </Link>
      </div>
      <SlotPicker id={`ready:${card.postId}`} shared={shared} label={fill(t.actions.choose, { channel: card.channelLabel })} onPick={(at) => void run("schedule", () => scheduleReadyAction(card.postId, at))} />
    </li>
  );
}
