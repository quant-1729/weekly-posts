"use client";

import Link from "next/link";
import { useState } from "react";
import {
  moveItemAction,
  postNowItemAction,
  postNowReadyAction,
  saveQueueSettingsAction,
  scheduleReadyAction,
  skipItemAction,
  slotOptionsAction,
  unscheduleItemAction,
  type QueueActionResult,
} from "@/app/(app)/week/queue-actions";
import { errorClass, hintClass, inputClass, primaryButton, secondaryButton } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";
import { DEFAULT_TIME } from "@/lib/queue/types";
import type { QueueSettings } from "@/lib/queue/types";
import type { QueueCard, QueueView, ReadyCard } from "@/lib/queue/view";

const t = s.queue;

const smallButton = "min-h-11 rounded-lg border border-stone-300 bg-white px-4 py-2 text-base font-medium text-stone-800 disabled:opacity-50";
const strongButton = "min-h-11 rounded-lg bg-[#E4572E] px-4 py-2 text-base font-semibold text-white disabled:opacity-50";

const STATUS_CLASS: Record<string, string> = {
  scheduled: "bg-stone-100 text-stone-800",
  publishing: "bg-blue-100 text-blue-800",
  published: "bg-green-100 text-green-800",
  delivered: "bg-green-100 text-green-800",
  missed: "bg-amber-100 text-amber-900",
  failed: "bg-red-100 text-red-800",
  expired: "bg-stone-200 text-stone-700",
};

type Message = { kind: "ok" | "error"; text: string };
type Options = { key: string; list: { at: string; label: string }[]; picked: string };

interface Shared {
  run: (name: string, fn: () => Promise<QueueActionResult>) => Promise<void>;
  busy: string | null;
  options: Options | null;
  setOptions: (o: Options | null) => void;
  openOptions: (key: string, postId: string) => Promise<void>;
}

/** The Queue (PRD v3 S-1 to S-6): what is coming, what needs the owner, what is ready to schedule, and the settings. */
export function QueueScreen({ initial }: { initial: QueueView }) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [options, setOptions] = useState<Options | null>(null);

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
    <div className="space-y-6" data-queue>
      {message ? (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? errorClass : "text-sm font-medium text-green-800"} data-queue-message>
          {message.text}
        </p>
      ) : null}
      {paused ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900" data-queue-paused>
          {t.upcoming.pausedNote}
        </p>
      ) : null}

      {view.attention.length > 0 ? (
        <section className="space-y-3" aria-label={t.sections.attention} data-queue-attention>
          <div>
            <h2 className="text-lg font-bold">{t.sections.attention}</h2>
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
        <h2 className="text-lg font-bold">{t.sections.upcoming}</h2>
        {view.upcoming.length === 0 ? (
          <div className="space-y-2 rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-stone-700">{t.upcoming.empty}</p>
            <Link href="/create" className={`${secondaryButton} inline-block text-center`}>
              {t.upcoming.createFirst}
            </Link>
          </div>
        ) : (
          view.upcoming.map((day) => (
            <div key={day.date} className="space-y-2" data-day={day.date}>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">{day.label}</h3>
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
          <h2 className="text-lg font-bold">{t.sections.ready}</h2>
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
          <h2 className="text-lg font-bold">{t.sections.recent}</h2>
          <ul className="grid gap-3 lg:grid-cols-2">
            {view.recent.map((c) => (
              <ItemCard key={c.id} card={c} shared={shared} />
            ))}
          </ul>
        </section>
      ) : null}

      <SettingsCard view={view} busy={busy} run={run} />
    </div>
  );
}

function Thumb({ url, alt }: { url: string | null; alt: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={alt} className="size-20 shrink-0 rounded-lg bg-stone-100 object-cover md:size-24" />
  ) : (
    <div className="flex size-20 shrink-0 items-center justify-center rounded-lg bg-stone-100 p-1 text-center text-xs text-stone-500 md:size-24">{t.noImage}</div>
  );
}

function SlotPicker({ id, shared, onPick, label }: { id: string; shared: Shared; onPick: (at: string) => void; label: string }) {
  const { options, setOptions, busy } = shared;
  if (!options || options.key !== id) return null;
  return (
    <div className="space-y-2 rounded-lg bg-stone-50 p-2" data-slot-picker>
      <label className="block text-sm font-medium">
        {label}
        <select className={`${inputClass} mt-1`} value={options.picked} onChange={(e) => setOptions({ ...options, picked: e.target.value })}>
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
        <button type="button" className={smallButton} disabled={busy !== null} onClick={() => setOptions(null)}>
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
    <li className="space-y-3 rounded-xl border border-stone-200 bg-white p-3 md:p-4" data-item-id={card.id} data-status={card.status} data-mode={card.mode} data-channel={card.channel}>
      <div className="flex gap-3">
        <Thumb url={card.imageUrl} alt={`${card.channelLabel}: ${card.headline}`} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{card.channelLabel}</h3>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[card.status] ?? STATUS_CLASS.scheduled}`} data-status-badge>
              {card.statusLabel}
            </span>
          </div>
          <p className="text-sm text-stone-700" data-when>
            {card.when}
          </p>
          {card.headline ? <p className="truncate text-sm text-stone-600">{card.headline}</p> : null}
          <p className="text-xs font-medium text-stone-600" data-mode-badge>
            {card.modeLabel}
          </p>
        </div>
      </div>
      {card.reason ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{card.reason}</p> : null}
      {sent && card.permalink ? (
        <a href={card.permalink} className="text-sm underline" target="_blank" rel="noreferrer">
          {fill(t.recent.view, { channel: card.channelLabel })}
        </a>
      ) : null}
      {card.status === "delivered" && card.reviewHref ? (
        <Link href={card.reviewHref} className="text-sm underline">
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
        <Link href={card.reviewHref} className="inline-block text-sm underline">
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
    <li className="space-y-3 rounded-xl border border-stone-200 bg-white p-3 md:p-4" data-ready-post-id={card.postId} data-channel={card.channel}>
      <div className="flex gap-3">
        <Thumb url={card.imageUrl} alt={`${card.channelLabel}: ${card.headline}`} />
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="font-semibold">{card.channelLabel}</h3>
          {card.headline ? <p className="truncate text-sm text-stone-600">{card.headline}</p> : null}
        </div>
      </div>
      {card.ended ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t.attention.reasons.expired}</p> : null}
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
        <Link href={`/create/${card.briefId}/review`} className={`${smallButton} inline-flex items-center`}>
          {t.actions.review}
        </Link>
      </div>
      <SlotPicker id={`ready:${card.postId}`} shared={shared} label={fill(t.actions.choose, { channel: card.channelLabel })} onPick={(at) => void run("schedule", () => scheduleReadyAction(card.postId, at))} />
    </li>
  );
}

/** The settings as a string that does not depend on the order of keys, and treats a missing time as the default. */
function settingsKey(v: QueueSettings): string {
  const times = Object.entries(v.times).filter(([, t]) => t !== DEFAULT_TIME).sort(([a], [b]) => a.localeCompare(b));
  const auto = Object.entries(v.autoApprove).filter(([, on]) => on).map(([c]) => c).sort();
  return JSON.stringify([v.postsPerWeek, [...v.days].sort((a, b) => a - b), times, auto, v.deliverEmail, v.paused]);
}

function SettingsCard({ view, busy, run }: { view: QueueView; busy: string | null; run: Shared["run"] }) {
  const [draft, setDraft] = useState<QueueSettings>(view.settings);
  const st = t.settings;
  const toggleDay = (d: number) => setDraft({ ...draft, days: draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d].sort((a, b) => a - b) });
  const dirty = settingsKey(draft) !== settingsKey(view.settings);
  return (
    <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-4" aria-label={t.sections.settings} data-queue-settings>
      <div>
        <h2 className="text-lg font-bold">{t.sections.settings}</h2>
        <p className={hintClass}>{fill(st.intro, { zone: view.timezone })}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block font-medium">
          {st.postsPerWeek}
          <select className={`${inputClass} mt-1`} value={draft.postsPerWeek} onChange={(e) => setDraft({ ...draft, postsPerWeek: Number(e.target.value) })} data-setting="postsPerWeek">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className="font-medium">{st.days}</legend>
          <p className={hintClass}>{st.daysHint}</p>
          <div className="flex flex-wrap gap-2">
            {st.weekdays.map((name, i) => (
              <button
                key={name}
                type="button"
                aria-pressed={draft.days.includes(i + 1)}
                onClick={() => toggleDay(i + 1)}
                className={`min-h-11 rounded-lg border px-3 py-2 text-base font-medium ${draft.days.includes(i + 1) ? "border-[#E4572E] bg-[#E4572E]/10 text-[#B93A15]" : "border-stone-300 bg-white text-stone-800"}`}
              >
                {name}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="space-y-2">
        <h3 className="font-medium">{st.times}</h3>
        <ul className="grid gap-3 md:grid-cols-2">
          {view.channels.map((c) => (
            <li key={c.channel} className="space-y-2 rounded-xl border border-stone-200 p-3" data-channel-setting={c.channel}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{c.label}</span>
                <span className="text-xs text-stone-600">{c.provider ? (c.connected ? st.connected : st.notConnected) : t.modes.deliver}</span>
              </div>
              <label className="block text-sm font-medium">
                {fill(st.timeFor, { channel: c.label })}
                <input
                  type="time"
                  className={`${inputClass} mt-1`}
                  value={draft.times[c.channel] ?? DEFAULT_TIME}
                  onChange={(e) => setDraft({ ...draft, times: { ...draft.times, [c.channel]: e.target.value } })}
                />
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-5"
                  checked={draft.autoApprove[c.channel] === true}
                  onChange={(e) => setDraft({ ...draft, autoApprove: { ...draft.autoApprove, [c.channel]: e.target.checked } })}
                  data-auto-approve={c.channel}
                />
                <span>{st.autoApprove}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{st.autoApproveWarning}</p>
      </div>

      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1 size-5" checked={draft.deliverEmail} onChange={(e) => setDraft({ ...draft, deliverEmail: e.target.checked })} />
        <span>
          <span className="font-medium">{st.deliverEmail}</span>
          <span className="block text-sm text-stone-600">{st.deliverEmailHint}</span>
        </span>
      </label>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1 size-5" checked={draft.paused} onChange={(e) => setDraft({ ...draft, paused: e.target.checked })} data-setting="paused" />
        <span>
          <span className="font-medium">{st.pause}</span>
          <span className="block text-sm text-stone-600">{st.pauseHint}</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={primaryButton} disabled={busy !== null || !dirty || draft.days.length === 0} onClick={() => void run("settings", () => saveQueueSettingsAction(draft))}>
          {busy === "settings" ? st.saving : st.save}
        </button>
        <Link href="/connections" className="text-sm underline">
          {st.manageConnections}
        </Link>
      </div>
    </section>
  );
}
