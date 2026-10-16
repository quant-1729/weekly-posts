/**
 * Shared Tailwind class strings for the whole app: the "fish-style" theme (docs/design/11-theme-fish-style.md).
 * Tokens live in src/app/globals.css (@theme): bg-ink, bg-cream, text-desc, border-line-input, rounded-card...
 *
 * Buttons are pills, 36 px high on desktop and 44 px on phones (tap target). Primary is near-black; coral is only for
 * selected states, the focus ring (global) and progress. Keyboard focus is the global 2 px coral ring.
 */

const buttonBase =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-full px-4 py-2 text-center text-ui transition disabled:cursor-not-allowed max-md:min-h-11";

/** The one main action on a screen. Near-black pill. */
export const primaryButton = `${buttonBase} bg-ink text-white hover:bg-ink-2 active:bg-ink-3 disabled:bg-faint`;

/** Primary, full width (login, auth cards, setup footers). */
export const primaryButtonFull = `${primaryButton} w-full`;

/** A quieter action next to or instead of the primary one. Warm translucent fill. */
export const secondaryButton = `${buttonBase} bg-fill-secondary text-title hover:bg-fill-secondary-hover disabled:bg-fill-active disabled:text-faint`;

/** Bordered, transparent. Back, Cancel, Refresh. */
export const outlineButton = `${buttonBase} text-sub inset-ring-1 inset-ring-line-input hover:bg-fill-active disabled:text-faint disabled:inset-ring-line-light`;

/** No border or fill until hover. Skip, Edit, Undo, Dismiss. */
export const ghostButton = `${buttonBase} text-sub hover:bg-fill-active disabled:text-faint`;

/** Destructive, outlined in the error tint. */
export const dangerButton = `${buttonBase} text-err-tx inset-ring-1 inset-ring-err-bd hover:bg-err-bg disabled:opacity-50`;

/** Compact variants for rows of actions inside cards (30 px on desktop, 44 px on phones). */
const smallBase =
  "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-full px-3 py-1 text-center text-[13px] font-medium leading-5 transition disabled:cursor-not-allowed max-md:min-h-11";
/** Small primary action in a card (Approve, Post now, Schedule). */
export const strongButton = `${smallBase} bg-ink text-white hover:bg-ink-2 active:bg-ink-3 disabled:bg-faint`;
/** Small outlined action in a card. */
export const smallButton = `${smallBase} text-sub inset-ring-1 inset-ring-line-input hover:bg-fill-active disabled:text-faint disabled:inset-ring-line-light`;
/** Small quiet action in a card (Skip, Edit, Take out of the queue). */
export const quietButton = `${smallBase} text-sub hover:bg-fill-active disabled:text-faint`;

/** An underlined text link that looks like a link: Remove, Edit, Use a different email. */
export const linkButton = "inline-flex min-h-6 items-center text-ui text-sub underline underline-offset-4 hover:text-title max-md:min-h-11";

/** White field, 16 px corners, warm border; focus darkens the border (the coral keyboard ring is global). */
export const inputClass =
  "block w-full rounded-2xl border border-line-input bg-white px-3.5 py-2.5 text-[14px] leading-5 text-ink placeholder:text-helper hover:border-line-input-hover focus:border-ink disabled:cursor-not-allowed disabled:bg-well disabled:text-helper max-md:min-h-11";

/** Field label: 14/500, title colour. */
export const labelClass = "mb-1.5 block text-ui text-title";

/** Helper text under a field or card title. */
export const hintClass = "mb-2 text-[13px] leading-[18px] text-desc";

export const errorClass = "mt-1 text-[13px] leading-[18px] text-err-tx";

/** Amber ring for fields the AI was unsure about (setup review). */
export const unsureClass = "rounded-2xl bg-warn-bg p-2 ring-2 ring-warn-bd";

/** A card: white, 16 px corners, hairline border, soft shadow. */
export const cardClass = "rounded-card border border-line bg-white p-4 shadow-card";

/** A well: a quiet panel inside a card or on the cream page. */
export const wellClass = "rounded-lg border border-divider bg-cream p-3";

/** A picked card (post type, QR mode, palettes) keeps the coral tint. */
export function pickCardClass(selected: boolean): string {
  return `flex min-h-12 min-w-0 cursor-pointer items-start gap-3 rounded-2xl border p-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-coral ${
    selected ? "border-coral bg-coral-tint ring-1 ring-coral" : "border-line-input bg-white hover:border-line-input-hover"
  }`;
}

/** A toggle pill: selected is the near-black pill. */
export function chipClass(selected: boolean): string {
  return `inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border px-4 py-1.5 text-ui transition max-md:min-h-11 ${
    selected ? "border-ink bg-ink text-white" : "border-line-input bg-white text-sub hover:bg-hover"
  }`;
}

/** Segmented control: a pill track with a white active segment. */
export const segTrack = "inline-flex rounded-full border border-line-light bg-fill-active p-0.5";
export function segButton(selected: boolean): string {
  return `inline-flex min-h-[30px] items-center justify-center rounded-full px-3.5 text-ui transition disabled:cursor-not-allowed disabled:opacity-60 max-md:min-h-11 ${
    selected ? "bg-white text-title shadow-tab" : "text-desc hover:text-title"
  }`;
}

/** A toggle chip with a second, smaller line (contact blocks on the post: label + the exact text). */
export function chipTwoClass(selected: boolean): string {
  return `inline-flex min-h-9 min-w-0 max-w-full flex-col items-start rounded-3xl border px-4 py-2 text-left text-ui transition max-md:min-h-11 ${
    selected ? "border-ink bg-ink text-white" : "border-line-input bg-white text-sub hover:bg-hover"
  }`;
}

/** Status badge (11/500 pill). */
export const badgeClass = "inline-flex items-center gap-1 rounded-full bg-well px-2 py-0.5 text-badge text-sub";
export const badgeTone = {
  neutral: "bg-well text-sub",
  ok: "bg-ok-bg text-ok-tx",
  warn: "bg-warn-bg text-warn-deep",
  err: "bg-err-bg text-err-tx",
  info: "bg-info-bg text-info-tx",
  coral: "bg-coral-tint text-coral-dark",
} as const;
export type BadgeTone = keyof typeof badgeTone;
export const badge = (tone: BadgeTone = "neutral"): string => `inline-flex items-center gap-1 whitespace-normal rounded-full px-2 py-0.5 text-badge ${badgeTone[tone]}`;

/** Status alert boxes: ok / warn / err / info / grey. */
export const alertTone = {
  ok: "border-ok-bd bg-ok-bg text-sub",
  warn: "border-warn-bd bg-warn-bg text-sub",
  err: "border-err-bd bg-err-bg text-sub",
  info: "border-info-bd bg-info-bg text-sub",
  grey: "border-transparent bg-well text-sub",
} as const;
export type AlertTone = keyof typeof alertTone;
export const alertClass = (tone: AlertTone = "grey"): string => `rounded-[14px] border px-3.5 py-3 text-[14px] leading-5 ${alertTone[tone]}`;

/** Card headings. */
export const cardTitle = "text-card-title text-title";
export const sectionTitle = "text-section text-title";

/** A round icon-only button (Edit pencil, Share). 36 px on desktop, 44 px on phones. Always give it an aria-label. */
export const iconButton =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-sub transition hover:bg-fill-active hover:text-title disabled:cursor-not-allowed disabled:text-faint max-md:size-11";
/** The same with a hairline border. */
export const iconButtonOutline = `${iconButton} inset-ring-1 inset-ring-line-input`;

/** A floating panel (menu, calendar): white, 16 px corners, hairline border, soft shadow. */
export const popoverClass = "z-30 rounded-2xl border border-line-input bg-white p-1 shadow-card";
