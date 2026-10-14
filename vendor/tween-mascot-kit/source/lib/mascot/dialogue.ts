/**
 * The scripted dialogue runner: pure functions over the content graph in content/mascot.json (mascot.md 5).
 * No DOM, no network. A later AI brain would produce the same `Resolved` shape (see brain.ts).
 */
import type { MascotAction, MascotCondition, MascotContent } from "@/lib/content-schema";
import { stripMarkers } from "@/lib/placeholders";

export type PriceMode = "hidden" | "pilot-only" | "from";

/** Build-time facts about the site that choose between variants of a line. Never contains anything a visitor could not already see. */
export type Facts = {
  priceMode: PriceMode;
  /** The exact price lines the Plans page shows (empty while prices are hidden). */
  priceLines: string[];
  hasWork: boolean;
  /** Preview builds show placeholder work slots on the home page. */
  hasSlots: boolean;
};

export type Ctx = { facts: Facts; tip: string };

export type Choice = { label: string; next: string };
export type Resolved = { id: string; lines: string[]; pose: string | undefined; actions: MascotAction[]; choices: Choice[] };

export function conditionsOf(f: Facts): Set<MascotCondition> {
  const out = new Set<MascotCondition>();
  if (f.hasWork) out.add("hasWork");
  else out.add(f.hasSlots ? "slots" : "empty");
  out.add(f.priceMode === "hidden" ? "priceHidden" : "pricesShown");
  return out;
}

/** Lines that are tokens expand to zero or more bubbles; every other line is one bubble. */
export function expandLines(lines: string[], ctx: Ctx): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line === "{priceLines}") out.push(...ctx.facts.priceLines);
    else if (line === "{tip}") {
      if (ctx.tip) out.push(ctx.tip);
    } else out.push(line);
  }
  return out;
}

export function resolveNode(content: MascotContent, id: string, ctx: Ctx): Resolved | null {
  const node = content.nodes[id];
  if (!node) return null;
  let say = node.say;
  let pose = node.pose as string | undefined;
  let actions: MascotAction[] = node.do ?? [];
  const active = conditionsOf(ctx.facts);
  for (const [cond, v] of Object.entries(node.variants ?? {}) as [MascotCondition, NonNullable<NonNullable<typeof node.variants>[MascotCondition]>][]) {
    if (!active.has(cond)) continue;
    if (v.say) say = v.say;
    if (v.pose) pose = v.pose;
    if (v.do) actions = v.do;
  }
  return { id, lines: expandLines(say, ctx), pose, actions, choices: node.choices ?? [] };
}

/** Route-aware tip (the first one for the route, else the default). */
export function tipFor(content: MascotContent, pathname: string): string {
  return (content.tips[pathname] ?? content.tips.default ?? [])[0] ?? "";
}

export function nudgeFor(content: MascotContent, pathname: string): string | null {
  return content.nudges[pathname] ?? null;
}

/** Plain text of a line for speech and screen readers: placeholder markers collapse to nothing. */
export function plainLine(line: string): string {
  return stripMarkers(line).replace(/\s{2,}/g, " ").trim();
}

/** The action of a given kind in a list, if any. */
export function findAction<K extends "goto" | "scroll" | "point" | "lightbox" | "leadFlow" | "quiet">(actions: MascotAction[], key: K): Extract<MascotAction, Record<K, unknown>> | undefined {
  return actions.find((a): a is Extract<MascotAction, Record<K, unknown>> => key in a);
}
