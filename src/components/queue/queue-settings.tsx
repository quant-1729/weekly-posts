"use client";

import Link from "next/link";
import { useState } from "react";
import { saveQueueSettingsAction, type QueueActionResult } from "@/app/(app)/week/queue-actions";
import { alertClass, badge, cardClass, chipClass, errorClass, hintClass, inputClass, labelClass, linkButton, primaryButton, wellClass } from "@/components/ui";
import { fill, s } from "@/lib/i18n/strings";
import { DEFAULT_TIME } from "@/lib/queue/types";
import type { QueueSettings } from "@/lib/queue/types";
import type { QueueView } from "@/lib/queue/view";

const t = s.queue;

type Run = (name: string, fn: () => Promise<QueueActionResult>) => Promise<void>;

/** The queue settings (child page of the Queue, /week/settings): how often, which days, what time, auto-approve, email, pause. */
export function QueueSettingsScreen({ initial }: { initial: QueueView }) {
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const run: Run = async (name, fn) => {
    setBusy(name);
    setMessage(null);
    const r = await fn();
    if (r.view) setView(r.view);
    if (r.message) setMessage({ kind: r.ok ? "ok" : "error", text: r.message });
    setBusy(null);
  };

  return (
    <div className="space-y-6" data-queue-settings-screen>
      {message ? (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? errorClass : "text-[13px] font-medium leading-[18px] text-ok-tx"} data-queue-message>
          {message.text}
        </p>
      ) : null}
      {view.settings.paused ? (
        <p className={alertClass("warn")} data-queue-paused>
          {t.upcoming.pausedNote}
        </p>
      ) : null}
      <SettingsCard view={view} busy={busy} run={run} />
    </div>
  );
}

/** The settings as a string that does not depend on the order of keys, and treats a missing time as the default. */
function settingsKey(v: QueueSettings): string {
  const times = Object.entries(v.times).filter(([, t]) => t !== DEFAULT_TIME).sort(([a], [b]) => a.localeCompare(b));
  const auto = Object.entries(v.autoApprove).filter(([, on]) => on).map(([c]) => c).sort();
  return JSON.stringify([v.postsPerWeek, [...v.days].sort((a, b) => a - b), times, auto, v.deliverEmail, v.paused]);
}

function SettingsCard({ view, busy, run }: { view: QueueView; busy: string | null; run: Run }) {
  const [draft, setDraft] = useState<QueueSettings>(view.settings);
  const st = t.settings;
  const toggleDay = (d: number) => setDraft({ ...draft, days: draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d].sort((a, b) => a - b) });
  const dirty = settingsKey(draft) !== settingsKey(view.settings);
  return (
    <section className={`space-y-5 ${cardClass} md:p-6`} aria-label={t.sections.settings} data-queue-settings>
      <div>
        <h2 className="text-card-title text-title">{t.sections.settings}</h2>
        <p className={hintClass}>{fill(st.intro, { zone: view.timezone })}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className={`block ${labelClass}`}>
          {st.postsPerWeek}
          <select className={`${inputClass} mt-1.5 font-normal`} value={draft.postsPerWeek} onChange={(e) => setDraft({ ...draft, postsPerWeek: Number(e.target.value) })} data-setting="postsPerWeek">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className={labelClass}>{st.days}</legend>
          <p className={hintClass}>{st.daysHint}</p>
          <div className="flex flex-wrap gap-2">
            {st.weekdays.map((name, i) => (
              <button
                key={name}
                type="button"
                aria-pressed={draft.days.includes(i + 1)}
                onClick={() => toggleDay(i + 1)}
                className={chipClass(draft.days.includes(i + 1))}
              >
                {name}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="space-y-2">
        <h3 className={labelClass}>{st.times}</h3>
        <ul className="grid gap-3 md:grid-cols-2">
          {view.channels.map((c) => (
            <li key={c.channel} className={`space-y-2 ${wellClass} !bg-white`} data-channel-setting={c.channel}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-ui text-title">{c.label}</span>
                <span className={badge(c.provider && c.connected ? "ok" : "neutral")}>{c.provider ? (c.connected ? st.connected : st.notConnected) : t.modes.deliver}</span>
              </div>
              <label className={labelClass}>
                {fill(st.timeFor, { channel: c.label })}
                <input
                  type="time"
                  className={`${inputClass} mt-1.5 font-normal`}
                  value={draft.times[c.channel] ?? DEFAULT_TIME}
                  onChange={(e) => setDraft({ ...draft, times: { ...draft.times, [c.channel]: e.target.value } })}
                />
              </label>
              <label className="flex items-start gap-2.5 text-[14px] leading-5">
                <input
                  type="checkbox"
                  checked={draft.autoApprove[c.channel] === true}
                  onChange={(e) => setDraft({ ...draft, autoApprove: { ...draft.autoApprove, [c.channel]: e.target.checked } })}
                  data-auto-approve={c.channel}
                />
                <span>{st.autoApprove}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className={alertClass("warn")}>{st.autoApproveWarning}</p>
      </div>

      <label className="flex items-start gap-3 text-[14px] leading-5">
        <input type="checkbox" role="switch" className="switch mt-0.5" checked={draft.deliverEmail} onChange={(e) => setDraft({ ...draft, deliverEmail: e.target.checked })} />
        <span>
          <span className="block text-title">{st.deliverEmail}</span>
          <span className="mt-0.5 block text-note text-desc">{st.deliverEmailHint}</span>
        </span>
      </label>
      <label className="flex items-start gap-3 text-[14px] leading-5">
        <input type="checkbox" role="switch" className="switch mt-0.5" checked={draft.paused} onChange={(e) => setDraft({ ...draft, paused: e.target.checked })} data-setting="paused" />
        <span>
          <span className="block text-title">{st.pause}</span>
          <span className="mt-0.5 block text-note text-desc">{st.pauseHint}</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" className={primaryButton} disabled={busy !== null || !dirty || draft.days.length === 0} onClick={() => void run("settings", () => saveQueueSettingsAction(draft))}>
          {busy === "settings" ? st.saving : st.save}
        </button>
        <Link href="/connections" className={linkButton}>
          {st.manageConnections}
        </Link>
      </div>
    </section>
  );
}
