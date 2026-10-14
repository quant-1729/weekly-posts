/**
 * Server-side checks on Tween's written content (never imported by the client chunk, which would drag zod in):
 * the schema, the dialogue graph, and a copy lint. Used by bundle.ts at request time and by tests/tween.
 */
import { z } from "zod";
import { TWEEN_POSES, type TweenAction, type TweenContent } from "./types";

export const MAX_LINE_CHARS = 140;
export const MAX_CHOICES = 4;

const text = z.string().trim().min(1);

const action = z.union([
  z.strictObject({ goto: z.string().regex(/^\/[a-z0-9/-]*$/) }),
  z.strictObject({ scroll: z.string().regex(/^[a-z0-9-]+$/) }),
  z.strictObject({ point: z.string().regex(/^[a-z0-9-]+$/) }),
  z.strictObject({ quiet: z.literal(true) }),
]);

const node = z.strictObject({
  say: z.array(text).min(1),
  pose: z.enum(TWEEN_POSES).optional(),
  do: z.array(action).optional(),
  choices: z.array(z.strictObject({ label: text, next: z.string().min(1) })).optional(),
});

const eventCopy = z.strictObject({ pose: z.enum(["think", "celebrate", "wave", "shrug"]), say: text.optional() });

const ui = z.strictObject({
  openLabel: text,
  closeLabel: text,
  panelLabel: text,
  hide: text,
  show: text,
  pause: text,
  resume: text,
  voiceOn: text,
  voiceOff: text,
  restart: text,
  noRoam: text,
  roam: text,
  settings: text,
  settingsLabel: text,
  quickLabel: text,
  transcriptShow: text,
  transcriptHide: text,
  transcriptLabel: text,
  speakerTween: text,
  speakerYou: text,
  skip: text,
  dismiss: text,
  choicesLabel: text,
  thinking: text,
  closeButton: text,
});

export const tweenSchema = z.strictObject({
  enabled: z.boolean(),
  name: text,
  greeting: text,
  start: text,
  nodes: z.record(z.string(), node),
  tips: z.record(z.string(), z.array(text).min(1)),
  nudges: z.record(z.string(), text),
  events: z.strictObject({
    generating: eventCopy,
    posts_ready: eventCopy,
    generate_failed: eventCopy,
    approved: eventCopy,
    all_approved: eventCopy,
    setup_started: eventCopy,
    setup_done: eventCopy,
  }),
  ui,
});

/** Parses content against the schema. Throws a ZodError that names the bad path. */
export function parseTweenContent(raw: unknown): TweenContent {
  return tweenSchema.parse(raw) as TweenContent;
}

export type Issue = { rule: string; where: string; message: string };

/** Every line of copy Tween can say, with where it lives (for the length and wording rules). */
export function allLines(content: TweenContent): { where: string; line: string }[] {
  const out: { where: string; line: string }[] = [{ where: "greeting", line: content.greeting }];
  for (const [id, n] of Object.entries(content.nodes)) {
    n.say.forEach((line, i) => out.push({ where: `nodes.${id}.say[${i}]`, line }));
    (n.choices ?? []).forEach((c, i) => out.push({ where: `nodes.${id}.choices[${i}]`, line: c.label }));
  }
  for (const [route, tips] of Object.entries(content.tips)) tips.forEach((line, i) => out.push({ where: `tips.${route}[${i}]`, line }));
  for (const [route, line] of Object.entries(content.nudges)) out.push({ where: `nudges.${route}`, line });
  for (const [ev, c] of Object.entries(content.events)) if (c.say) out.push({ where: `events.${ev}.say`, line: c.say });
  return out;
}

export function reachable(content: TweenContent): Set<string> {
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

/**
 * Structure of the dialogue graph: the start node exists, no `next` dangles, nothing is unreachable, at most four
 * choices per node, every line within 140 characters. With `routes`, every `goto`, tip route and nudge route must be a
 * real app route.
 */
export function validateGraph(content: TweenContent, opts: { routes?: string[] } = {}): Issue[] {
  const issues: Issue[] = [];
  const add = (rule: string, where: string, message: string) => issues.push({ rule, where, message });
  if (!content.nodes[content.start]) add("start", content.start, "start node does not exist");

  for (const [id, n] of Object.entries(content.nodes)) {
    for (const c of n.choices ?? []) if (!content.nodes[c.next]) add("dangling-next", id, `choice "${c.label}" points at missing node "${c.next}"`);
    if ((n.choices?.length ?? 0) > MAX_CHOICES) add("too-many-choices", id, `${n.choices?.length} choices`);
  }
  for (const { where, line } of allLines(content)) {
    if (line === "{tip}") continue; // a token line expands at run time
    if (line.length > MAX_LINE_CHARS) add("line-too-long", where, `${line.length} chars: ${line.slice(0, 40)}...`);
  }
  const seen = reachable(content);
  for (const id of Object.keys(content.nodes)) if (!seen.has(id)) add("unreachable", id, "node cannot be reached from the start node");

  const routes = opts.routes;
  if (routes) {
    for (const [id, n] of Object.entries(content.nodes)) {
      for (const a of n.do ?? []) if ("goto" in a && !routes.includes(a.goto)) add("unknown-route", id, `goto "${a.goto}" is not a route`);
    }
    for (const route of Object.keys(content.tips)) if (route !== "default" && !routes.includes(route)) add("unknown-route", `tips.${route}`, "tip route is not a route");
    for (const route of Object.keys(content.nudges)) if (!routes.includes(route)) add("unknown-route", `nudges.${route}`, "nudge route is not a route");
  }
  return issues;
}

/** Every `point` and `scroll` target in the graph, with the route it is expected on (the preceding goto, or null = current page). */
export function targetsInGraph(content: TweenContent): { node: string; route: string | null; target: string }[] {
  const out: { node: string; route: string | null; target: string }[] = [];
  for (const [id, n] of Object.entries(content.nodes)) {
    let route: string | null = null;
    for (const a of (n.do ?? []) as TweenAction[]) {
      if ("goto" in a) route = a.goto;
      if ("point" in a) out.push({ node: id, route, target: a.point });
      if ("scroll" in a) out.push({ node: id, route, target: a.scroll });
    }
  }
  return out;
}

/* ---------------------------------------------------------------- copy lint */

const MONTHS = "january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
const DAYS = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";

/** Words Tween's copy must not use, with the rule each belongs to. */
const BANNED: { rule: string; re: RegExp }[] = [
  { rule: "number", re: /[0-9]/ },
  { rule: "price", re: /[$€£₹¥%]|\b(price|prices|pricing|cost|costs|cheap|discount|offer|offers|sale|deal|deals|free|fee|fees|usd|dollars?|rupees?|euros?|pounds?)\b/i },
  {
    rule: "promise",
    re: /\b(guarantee[sd]?|promise[sd]?|viral|boost(s|ed)?|skyrocket\w*|more (customers|clients|sales|followers|likes|views|reach|engagement|business)|increase[sd]?|grow(s|th|ing)?|revenue|profit\w*|roi|proven|never fail\w*|best|number one|instantly|results?)\b/i,
  },
  { rule: "date", re: new RegExp(`\\b(${MONTHS}|${DAYS}|today|tomorrow|tonight|yesterday|tonight)\\b`, "i") },
  { rule: "human", re: /\bI am (a )?(human|person|real person|assistant|chatbot|bot)\b|\bI'm (a )?(human|person|real person|assistant|chatbot|bot)\b/i },
  { rule: "ai", re: /\bAI\b|artificial intelligence|\bGPT\b|language model/i },
];

/** The rules a line of Tween copy breaks (empty = clean). */
export function lintCopy(line: string): string[] {
  return BANNED.filter((b) => b.re.test(line)).map((b) => b.rule);
}
