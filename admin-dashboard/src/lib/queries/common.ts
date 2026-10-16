// Shared pieces for the read queries. Nothing here touches the database.

export const PAGE_SIZE = 50;

/** Collects bind parameters and hands back their placeholders ($1, $2, ...). Values never go into the SQL text. */
export class Params {
  readonly values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

/** ISO-8601 UTC text with microseconds, so a keyset cursor loses no precision (a JS Date only keeps milliseconds). */
export const iso = (col: string) => `to_char(${col} at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Escapes % _ and \ so user input is matched literally by ILIKE ... ESCAPE '\'. */
export function likeContains(input: string): string {
  return `%${input.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function cleanText(v: unknown, max = 80): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function cleanChoice<T extends string>(v: unknown, allowed: readonly T[]): T | "" {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : "";
}

export function cleanDate(v: unknown): string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : "";
}

export function cleanUuid(v: unknown): string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v.toLowerCase() : "";
}

export interface Cursor {
  /** ISO timestamp (microseconds) of the last row shown. */
  t: string;
  /** Its id (uuid or number as text). */
  i: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

export function decodeCursor(raw: unknown, idPattern: RegExp): Cursor | null {
  if (typeof raw !== "string" || raw.length > 200) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Cursor>;
    if (typeof c.t !== "string" || typeof c.i !== "string") return null;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(c.t)) return null;
    if (!idPattern.test(c.i)) return null;
    return { t: c.t, i: c.i };
  } catch {
    return null;
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const INT_RE = /^\d{1,19}$/;

export interface Page<T> {
  rows: T[];
  /** Cursor for the next (older) page, or null on the last page. */
  next: string | null;
}

/** Takes the PAGE_SIZE + 1 rows a query fetched and cuts the extra one off, building the next cursor from the last kept row. */
export function paginate<T extends { ts: string; id: string | number }>(fetched: T[]): Page<T> {
  if (fetched.length <= PAGE_SIZE) return { rows: fetched, next: null };
  const rows = fetched.slice(0, PAGE_SIZE);
  const last = rows[rows.length - 1];
  return { rows, next: encodeCursor({ t: last.ts, i: String(last.id) }) };
}
