import Link from "next/link";
import type { ReactNode } from "react";

export const btnPrimary =
  "inline-flex h-9 items-center justify-center rounded-full bg-ink px-4 text-sm font-medium text-white hover:bg-ink-2 cursor-pointer";
export const btnSecondary =
  "inline-flex h-9 items-center justify-center rounded-full bg-fill-secondary px-4 text-sm font-medium text-title hover:bg-fill-secondary-hover cursor-pointer";
export const inputCls =
  "h-9 rounded-full border border-line-input bg-white px-4 text-sm text-ink placeholder:text-helper focus:border-ink focus:outline-none";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-card border border-line bg-white p-4 shadow-card ${className}`}>{children}</section>
  );
}

export function PageTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <header className="mb-4">
      <h1 className="text-xl font-medium text-title">{title}</h1>
      {hint ? <p className="mt-1 text-xs text-desc">{hint}</p> : null}
    </header>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="rounded-card border border-line bg-white p-4 shadow-card">
      <div className="text-xs font-medium text-desc">{label}</div>
      <div className="mt-1 text-2xl font-medium tabular-nums text-title">{value}</div>
      {sub ? <div className="mt-1 text-xs text-desc">{sub}</div> : null}
    </div>
  );
}

const TONES = {
  ok: "bg-ok-bg text-ok-tx",
  warn: "bg-warn-bg text-warn-tx",
  err: "bg-err-bg text-err-tx",
  neutral: "bg-well text-sub",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${TONES[tone]}`}>{children}</span>;
}

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-divider text-xs font-medium text-desc">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {empty ? <p className="px-3 py-6 text-center text-sm text-desc">{empty}</p> : null}
    </div>
  );
}

export const td = "whitespace-nowrap border-b border-divider px-3 py-2 align-top";

/** A horizontal bar drawn as SVG, so no inline style attribute is needed under the strict CSP. */
export function Bar({ pct, label }: { pct: number; label: string }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <svg role="img" aria-label={label} width="100%" height="8" className="block">
      <rect x="0" y="0" width="100%" height="8" rx="4" fill="#f6f0ec" />
      <rect x="0" y="0" width={`${w}%`} height="8" rx="4" fill="#e4572e" />
    </svg>
  );
}

export function href(path: string, params: Record<string, string | undefined | false>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

export function Pager({ path, params, next }: { path: string; params: Record<string, string | undefined | false>; next: string | null }) {
  return (
    <div className="mt-3 flex items-center gap-2">
      {params.cursor ? (
        <Link className={btnSecondary} href={href(path, { ...params, cursor: undefined })}>
          Back to newest
        </Link>
      ) : null}
      {next ? (
        <Link className={btnSecondary} href={href(path, { ...params, cursor: next })}>
          Older
        </Link>
      ) : (
        <span className="text-xs text-desc">End of list</span>
      )}
    </div>
  );
}

export function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}
