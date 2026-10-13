import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EmailKind, SendEmailInput } from "./types";

/**
 * Mock email: every email is a JSON file in .data/outbox/{timestamp}-{kind}.json
 * (the .data folder is git-ignored). The dev page /dev/outbox lists them.
 */

export interface OutboxEntry {
  /** File name without .json. Also the id returned by the mock sender. */
  id: string;
  createdAt: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  kind: EmailKind;
  brandId: string | null;
  userId: string | null;
  headers: Record<string, string>;
}

let dirOverride: string | null = null;

/** Tests only: write to this folder instead of .data/outbox. */
export function setOutboxDirForTests(dir: string | null): void {
  dirOverride = dir;
}

export function outboxDir(): string {
  return dirOverride ?? path.join(process.cwd(), ".data", "outbox");
}

export async function writeOutbox(input: SendEmailInput, now: Date = new Date()): Promise<OutboxEntry> {
  const dir = outboxDir();
  await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
  // 2026-10-13T09-30-00-123Z: sortable and valid in Windows file names.
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const base = `${stamp}-${input.kind}`;
  for (let n = 0; ; n++) {
    const id = n === 0 ? base : `${base}-${n + 1}`;
    const entry: OutboxEntry = {
      id,
      createdAt: now.toISOString(),
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      kind: input.kind,
      brandId: input.brandId ?? null,
      userId: input.userId ?? null,
      headers: input.headers ?? {},
    };
    try {
      // "wx": never overwrite an email written in the same millisecond.
      await writeFile(path.join(/*turbopackIgnore: true*/ dir, `${id}.json`), JSON.stringify(entry, null, 2), {
        encoding: "utf8",
        flag: "wx",
      });
      return entry;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
}

/** Newest first. Unreadable files are skipped. */
export async function listOutbox(limit = 50): Promise<OutboxEntry[]> {
  const dir = outboxDir();
  let names: string[];
  try {
    names = await readdir(/*turbopackIgnore: true*/ dir);
  } catch {
    return [];
  }
  // Newest first: by timestamp, then by the -2, -3 suffix used when several land in one millisecond.
  const order = (name: string): [string, number] => [
    name.slice(0, 24),
    Number(/-(\d+)\.json$/.exec(name)?.[1] ?? 1),
  ];
  const files = names
    .filter((n) => n.endsWith(".json"))
    .sort((a, b) => {
      const [sa, na] = order(a);
      const [sb, nb] = order(b);
      return sa === sb ? nb - na : sa < sb ? 1 : -1;
    })
    .slice(0, limit);
  const entries: OutboxEntry[] = [];
  for (const f of files) {
    try {
      entries.push(JSON.parse(await readFile(path.join(/*turbopackIgnore: true*/ dir, f), "utf8")) as OutboxEntry);
    } catch {
      // skip a half-written or hand-edited file
    }
  }
  return entries;
}

/** http(s) links in the plain-text version, so the dev page can offer clickable ones. */
export function linksIn(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s"'<>]+/g) ?? [])];
}
