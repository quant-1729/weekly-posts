/** Structural checks on the dialogue graph, shared by the unit test and anything that wants to lint mascot.json. */
import type { MascotAction, MascotContent } from "@/lib/content-schema";
import { stripMarkers } from "@/lib/placeholders";

export const MAX_LINE_CHARS = 140;
export const MAX_CHOICES = 4;

export type Issue = { rule: string; where: string; message: string };

const allActions = (content: MascotContent): { id: string; actions: MascotAction[] }[] =>
  Object.entries(content.nodes).flatMap(([id, n]) => [
    { id, actions: n.do ?? [] },
    ...Object.entries(n.variants ?? {}).map(([cond, v]) => ({ id: `${id}[${cond}]`, actions: v?.do ?? [] })),
  ]);

export function reachable(content: MascotContent): Set<string> {
  const seen = new Set<string>();
  const stack = [content.start];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id) || !content.nodes[id]) continue;
    seen.add(id);
    for (const c of content.nodes[id]!.choices ?? []) stack.push(c.next);
  }
  return seen;
}

export function validateGraph(content: MascotContent, opts: { routes: string[] }): Issue[] {
  const issues: Issue[] = [];
  const add = (rule: string, where: string, message: string) => issues.push({ rule, where, message });
  if (!content.nodes[content.start]) add("start", content.start, "start node does not exist");

  for (const [id, n] of Object.entries(content.nodes)) {
    for (const c of n.choices ?? []) if (!content.nodes[c.next]) add("dangling-next", id, `choice "${c.label}" points at missing node "${c.next}"`);
    if ((n.choices?.length ?? 0) > MAX_CHOICES) add("too-many-choices", id, `${n.choices?.length} choices`);
    const lines = [...n.say, ...Object.values(n.variants ?? {}).flatMap((v) => v?.say ?? [])];
    for (const line of lines) {
      if (line.startsWith("{") && line.endsWith("}")) continue; // a token line expands at run time
      if (stripMarkers(line).length > MAX_LINE_CHARS) add("line-too-long", id, `${stripMarkers(line).length} chars: ${line.slice(0, 40)}...`);
    }
  }
  const seen = reachable(content);
  for (const id of Object.keys(content.nodes)) if (!seen.has(id)) add("unreachable", id, "node cannot be reached from the start node");

  for (const { id, actions } of allActions(content)) {
    for (const a of actions) if ("goto" in a && !opts.routes.includes(a.goto)) add("unknown-route", id, `goto "${a.goto}" is not a route`);
  }
  for (const route of Object.keys(content.tips)) if (route !== "default" && !opts.routes.includes(route)) add("unknown-route", `tips.${route}`, "tip route is not a route");
  for (const route of Object.keys(content.nudges)) if (!opts.routes.includes(route)) add("unknown-route", `nudges.${route}`, "nudge route is not a route");
  return issues;
}

/** Every `point` and `scroll` target in the graph, with the route it is expected on (the preceding goto, or null = current page). */
export function targetsInGraph(content: MascotContent): { node: string; route: string | null; target: string }[] {
  const out: { node: string; route: string | null; target: string }[] = [];
  for (const { id, actions } of allActions(content)) {
    let route: string | null = null;
    for (const a of actions) {
      if ("goto" in a) route = a.goto;
      if ("point" in a) out.push({ node: id, route, target: a.point });
      if ("scroll" in a) out.push({ node: id, route, target: a.scroll });
    }
  }
  return out;
}
