const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2026-11-09" -> "9 Nov" (with `year`: "9 Nov 2026"). Fixed English month names, so output does not depend on the server's locale. */
export function formatDayMonth(iso: string, year = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const label = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]}`;
  return year ? `${label} ${m[1]}` : label;
}

export function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
