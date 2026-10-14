/**
 * The scripted dialogue runner: pure functions over the content graph in src/content/tween.json.
 * No DOM, no network, no AI: every word Tween says is written content.
 */
import type { TweenAction, TweenContent } from "./types";

export type Ctx = { tip: string };

export type Choice = { label: string; next: string };
export type Resolved = { id: string; lines: string[]; pose: string | undefined; actions: TweenAction[]; choices: Choice[] };

/** The token line `{tip}` expands to the page's tip (or to nothing); every other line is one bubble. */
export function expandLines(lines: string[], ctx: Ctx): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line === "{tip}") {
      if (ctx.tip) out.push(ctx.tip);
    } else out.push(line);
  }
  return out;
}

export function resolveNode(content: TweenContent, id: string, ctx: Ctx): Resolved | null {
  const node = content.nodes[id];
  if (!node) return null;
  return { id, lines: expandLines(node.say, ctx), pose: node.pose, actions: node.do ?? [], choices: node.choices ?? [] };
}

/** Route-aware tip (the first one for the route, else the default). */
export function tipFor(content: TweenContent, pathname: string): string {
  return (content.tips[pathname] ?? content.tips.default ?? [])[0] ?? "";
}

export function nudgeFor(content: TweenContent, pathname: string): string | null {
  return content.nudges[pathname] ?? null;
}

/** Plain text of a line for speech: collapse stray whitespace. */
export function plainLine(line: string): string {
  return line.replace(/\s{2,}/g, " ").trim();
}

/** The action of a given kind in a list, if any. */
export function findAction<K extends "goto" | "scroll" | "point" | "quiet">(actions: TweenAction[], key: K): Extract<TweenAction, Record<K, unknown>> | undefined {
  return actions.find((a): a is Extract<TweenAction, Record<K, unknown>> => key in a);
}
