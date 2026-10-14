/** Safe storage for Tween's non-personal UI state. Storage can throw or be blocked; Tween then simply forgets. */
export type Area = "local" | "session";

const memory: Record<Area, Map<string, string>> = { local: new Map(), session: new Map() };

function store(area: Area): Storage | null {
  try {
    return area === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function read(area: Area, key: string): string | null {
  try {
    const v = store(area)?.getItem(key);
    if (v !== undefined && v !== null) return v;
  } catch {
    /* fall through to memory */
  }
  return memory[area].get(key) ?? null;
}

export function write(area: Area, key: string, value: string): void {
  memory[area].set(key, value);
  try {
    store(area)?.setItem(key, value);
  } catch {
    /* blocked: the in-memory copy still serves this page view */
  }
}

export function remove(area: Area, key: string): void {
  memory[area].delete(key);
  try {
    store(area)?.removeItem(key);
  } catch {
    /* ignore */
  }
}

export const KEYS = {
  hidden: "tween-hidden",
  paused: "tween-paused",
  noRoam: "tween-noroam",
  voice: "tween-voice",
  intro: "tween-intro",
  transcript: "tween-transcript",
  budget: "tween-budget",
} as const;

export function readJson<T>(area: Area, key: string, fallback: T): T {
  const raw = read(area, key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
