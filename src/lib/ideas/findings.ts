// What the gatherers return and the small text helpers they share (R-2 to R-5). Pure.

import type { Finding, TrendKind } from "./types";

/** A finding with what the merge and the score need: its kind, and the velocity from our own snapshots (null without history). */
export interface GatheredFinding extends Finding {
  kind: TrendKind;
  velocity: number | null;
}

/** A finding after merge and score, with the id the cards prompt uses. */
export interface ScoredFinding extends GatheredFinding {
  id: string;
  score: number;
}

const STOP = new Set(
  "a an and are as at be but by for from has have how if in into is it its of on or our so than that the their then there these they this to was we were what when where which who why will with you your about after all also any can more most new not now out over too up very".split(" "),
);

/** Lower-case words of a text, without stop words and with a trailing plural "s" removed. Deterministic. */
export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u)) {
    if (!raw) continue;
    let w = raw;
    if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
    if (w.length < 2 || STOP.has(w)) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

/** One line of plain text, at most `max` characters (cut at a word where it can). */
export function oneLine(text: string, max: number): string {
  const t = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if ([...t].length <= max) return t;
  const cut = [...t].slice(0, max).join("");
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:\-–—]+$/, "").trim();
}

/** The host of a URL without "www.", or "" when it is not a URL. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** True for an http(s) URL (the only kind a source link may be). */
export function isWebUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".") && !u.username && !u.password;
  } catch {
    return false;
  }
}
