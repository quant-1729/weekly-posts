/** Shared Tailwind class strings for the mobile forms. */

export const inputClass =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-3 text-base outline-none focus:border-[#E4572E] focus:ring-2 focus:ring-[#E4572E]/30";

export const primaryButton =
  "w-full rounded-lg bg-[#E4572E] px-4 py-3 text-lg font-semibold text-white disabled:opacity-50";

export const secondaryButton =
  "w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-base font-medium text-stone-800 disabled:opacity-50";

export const linkButton = "py-2 text-sm text-stone-600 underline";

export const labelClass = "mb-1 block font-medium";

export const hintClass = "mb-2 text-sm text-stone-500";

export const errorClass = "mt-1 text-sm text-red-700";

/** Amber ring for fields the AI was unsure about (setup review). */
export const unsureClass = "rounded-lg ring-2 ring-amber-400 bg-amber-50 p-2";

export function chipClass(selected: boolean): string {
  return `min-h-12 rounded-lg border px-4 py-2 text-base font-medium ${
    selected ? "border-[#E4572E] bg-[#E4572E]/10 text-[#B93A15]" : "border-stone-300 bg-white text-stone-800"
  }`;
}
