/**
 * Server side: the validated bundle /api/tween serves, and the on/off decision the app layout makes.
 * The copy is src/content/tween.json; nothing here is personal data and nothing calls a model.
 */
import raw from "@/content/tween.json";
import { tweenEnabled } from "./enabled";
import type { TweenBundle, TweenContent } from "./types";
import { parseTweenContent, validateGraph } from "./validate";

let cached: TweenContent | null = null;

/** The parsed and checked content. Throws if the file is malformed or the dialogue graph is broken. */
export function loadTweenContent(): TweenContent {
  if (cached) return cached;
  const content = parseTweenContent(raw);
  const issues = validateGraph(content);
  if (issues.length) throw new Error(`src/content/tween.json: ${issues.map((i) => `${i.rule} at ${i.where}`).join("; ")}`);
  cached = content;
  return content;
}

/** True when Tween should be on the page: content flag on and TWEEN_ENABLED not 0/false/off. Never throws: broken content means off. */
export function isTweenEnabled(env: Record<string, string | undefined> = process.env): boolean {
  try {
    return tweenEnabled(loadTweenContent(), env);
  } catch {
    return false;
  }
}

/** The bundle for /api/tween, or null when Tween is off. */
export function buildBundle(env: Record<string, string | undefined> = process.env): TweenBundle | null {
  if (!isTweenEnabled(env)) return null;
  return { tween: loadTweenContent() };
}
