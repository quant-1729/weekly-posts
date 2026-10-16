"use client";

import { formatClock } from "@/components/use-wav-capture";
import { s } from "@/lib/i18n/strings";

const t = s.create.describe;

const icon = { viewBox: "0 0 24 24", className: "h-5 w-5", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export function MicIcon() {
  return (
    <svg {...icon}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </svg>
  );
}

export function CrossIcon() {
  return (
    <svg {...icon} className="h-4 w-4">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg {...icon} className="h-4 w-4">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function SendIcon() {
  return (
    <svg {...icon}>
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}

/** The round coral-tint microphone button (36 px; 44 px on phones). */
export const micButtonClass = "inline-grid h-9 w-9 shrink-0 place-items-center rounded-full bg-coral-tint text-coral-dark transition hover:bg-[#fbe5dc] disabled:opacity-50 max-md:h-11 max-md:w-11";

const roundIco = "inline-grid h-8 w-8 shrink-0 place-items-center rounded-full max-md:h-11 max-md:w-11";

/** While recording: cancel, a level meter, the timer and "done". Fills its (relative) parent, or sits where `className` puts it. */
export function RecordingBar({
  levels,
  elapsed,
  onCancel,
  onDone,
  className = "absolute inset-2",
}: {
  levels: number[];
  elapsed: number;
  onCancel: () => void;
  onDone: () => void;
  className?: string;
}) {
  return (
    <div data-recording className={`${className} flex items-center gap-2.5 rounded-xl border border-err-bd bg-err-bg px-2.5`}>
      <button type="button" data-mic-cancel aria-label={t.micCancel} title={t.micCancel} className={`${roundIco} bg-white text-err-tx`} onClick={onCancel}>
        <CrossIcon />
      </button>
      <div className="flex h-6 min-w-0 flex-1 items-center justify-center gap-0.75 overflow-hidden" aria-hidden="true">
        {levels.map((l, i) => (
          <span key={i} className="w-0.75 shrink-0 rounded-sm bg-err-tx" style={{ height: `${Math.max(6, Math.round(l * 100))}%` }} />
        ))}
      </div>
      <span role="timer" aria-label={t.recording} className="shrink-0 text-ui tabular-nums text-err-tx">
        {formatClock(elapsed)}
      </span>
      <button type="button" data-mic-done aria-label={t.micDone} title={t.micDone} className={`${roundIco} bg-coral text-white`} onClick={onDone}>
        <CheckIcon />
      </button>
    </div>
  );
}

/** While the recording is turned into words. */
export function ListeningOverlay({ className = "absolute inset-2" }: { className?: string }) {
  return (
    <div role="status" data-listening className={`${className} flex items-center gap-2 rounded-xl bg-well px-3.5 text-[14px] leading-5 text-desc`}>
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-edge border-t-ink" aria-hidden="true" />
      {t.transcribing}
    </div>
  );
}
