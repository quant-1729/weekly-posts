import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mascotSchema, type MascotContent } from "@/lib/content-schema";
import { collectStrings } from "@/lib/guard";
import { lintCopy } from "@/lib/lint-honesty";
import { hasMarker, stripMarkers } from "@/lib/placeholders";
import { scriptedBrain } from "@/lib/mascot/brain";
import { conditionsOf, expandLines, nudgeFor, plainLine, resolveNode, tipFor, type Ctx, type Facts } from "@/lib/mascot/dialogue";
import { mascotEnabled } from "@/lib/mascot/enabled";
import { LEAD_STEPS, buildPayload, emptyAnswers, formIdFor, interpretResponse, validateStep } from "@/lib/mascot/lead";
import { canSpeak, emptyBudget, newPageView, spend, type Blockers } from "@/lib/mascot/limits";
import { STATES, faceFor, initialMachine, reduce, viewState, type MachineState, type TweenEvent, type TweenState } from "@/lib/mascot/machine";
import { canRoam, clampX, homeX, overlapArea, panelAlign, planPoint, planScroll, rect, walkDuration } from "@/lib/mascot/motion";
import { reachable, targetsInGraph, validateGraph } from "@/lib/mascot/validate";
import { LEAD_ERROR_MESSAGES } from "@/lib/lead-fields";
import { root } from "./helpers";

const content = JSON.parse(fs.readFileSync(path.join(root, "content", "mascot.json"), "utf8")) as unknown;
const mascot: MascotContent = mascotSchema.parse(content);

// Routes that exist: every page.tsx under app/ without a dynamic segment.
function routes(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name.startsWith("[") || e.name === "api") continue;
        walk(path.join(dir, e.name), `${prefix}/${e.name}`);
      } else if (e.name === "page.tsx") out.push(prefix || "/");
    }
  };
  walk(path.join(root, "app"), "");
  return out;
}

const facts = (over: Partial<Facts> = {}): Facts => ({ priceMode: "hidden", priceLines: [], hasWork: false, hasSlots: true, ...over });
const ctx = (over: Partial<Facts> = {}, tip = "A tip."): Ctx => ({ facts: facts(over), tip });

/* ------------------------------------------------------------------ D3: state machine */
describe("D3: state machine", () => {
  const at = (state: TweenState, patch: Partial<MachineState> = {}): MachineState => ({ ...initialMachine, state, ...patch });
  const run = (m: MachineState, ...events: TweenEvent[]) => events.reduce(reduce, m);

  it("has the ten required states", () => {
    expect([...STATES].sort()).toEqual(["celebrate", "climb", "cover", "idle", "peek", "perch", "point", "present", "reach", "shrug", "sleep", "talk", "think", "walk", "wave"]);
  });

  it("legal transitions from idle", () => {
    expect(run(at("idle"), { type: "WALK", dir: "right" })).toMatchObject({ state: "walk", facing: "right" });
    expect(run(at("idle"), { type: "WAVE" }).state).toBe("wave");
    expect(run(at("idle"), { type: "POINT", dir: "left" })).toMatchObject({ state: "point", pointDir: "left", facing: "left" });
    expect(run(at("idle"), { type: "POINT", dir: "up" })).toMatchObject({ state: "point", pointDir: "up" });
    expect(run(at("idle"), { type: "THINK" }).state).toBe("think");
    expect(run(at("idle"), { type: "CELEBRATE" }).state).toBe("celebrate");
    expect(run(at("idle"), { type: "SHRUG" }).state).toBe("shrug");
    expect(run(at("idle"), { type: "SAY_START" })).toMatchObject({ state: "talk", talking: true });
    expect(run(at("idle"), { type: "SLEEP" }).state).toBe("sleep");
    expect(run(at("idle"), { type: "HIDE" }).state).toBe("peek");
  });

  it("pose events settle back with DONE, to talk while a line is being said", () => {
    for (const s of ["wave", "point", "think", "shrug", "celebrate"] as const) {
      expect(run(at(s), { type: "DONE" }).state).toBe("idle");
      expect(run(at(s, { talking: true }), { type: "DONE" }).state).toBe("talk");
    }
    expect(run(at("walk"), { type: "ARRIVE" }).state).toBe("idle");
  });

  it("talking is layered: Tween can point while speaking, and SAY_END only ends the talk state", () => {
    const m = run(at("idle"), { type: "POINT", dir: "right" }, { type: "SAY_START" });
    expect(m).toMatchObject({ state: "point", talking: true });
    expect(run(m, { type: "SAY_END" })).toMatchObject({ state: "point", talking: false });
    expect(run(at("talk", { talking: true }), { type: "SAY_END" }).state).toBe("idle");
  });

  it("illegal events are ignored (the same object comes back)", () => {
    const walking = at("walk");
    expect(reduce(walking, { type: "WAVE" })).toBe(walking);
    expect(reduce(walking, { type: "POINT", dir: "left" })).toBe(walking);
    expect(reduce(walking, { type: "SLEEP" })).toBe(walking);
    const idle = at("idle");
    expect(reduce(idle, { type: "ARRIVE" })).toBe(idle);
    expect(reduce(idle, { type: "DONE" })).toBe(idle);
    expect(reduce(idle, { type: "SHOW" })).toBe(idle);
    expect(reduce(idle, { type: "SAY_END" })).toBe(idle);
    const asleep = at("sleep");
    expect(reduce(asleep, { type: "WALK", dir: "left" })).toBe(asleep);
    expect(reduce(asleep, { type: "CELEBRATE" })).toBe(asleep);
  });

  it("sleep only starts from a docked, quiet idle", () => {
    expect(reduce(at("idle", { docked: false }), { type: "SLEEP" }).state).toBe("idle");
    expect(reduce(at("idle", { talking: true }), { type: "SLEEP" }).state).toBe("idle");
    expect(reduce(at("wave"), { type: "SLEEP" }).state).toBe("wave");
  });

  it("sleep wakes on input, and on a line to say", () => {
    expect(run(at("sleep"), { type: "INPUT" }).state).toBe("idle");
    expect(run(at("sleep"), { type: "SAY_START" })).toMatchObject({ state: "talk", talking: true });
    expect(run(at("sleep"), { type: "WAVE" }).state).toBe("wave");
    expect(run(at("sleep"), { type: "HIDE" }).state).toBe("peek");
  });

  it("peek (hidden) accepts only SHOW", () => {
    const peek = at("peek");
    for (const e of [{ type: "WAVE" }, { type: "INPUT" }, { type: "SAY_START" }, { type: "WALK", dir: "left" }, { type: "SLEEP" }] as TweenEvent[]) expect(reduce(peek, e)).toBe(peek);
    expect(reduce(peek, { type: "SHOW" }).state).toBe("idle");
  });

  it("reduced motion never walks and stops a walk in progress; the view shows a still pose", () => {
    const reduced = run(at("idle"), { type: "CONTEXT", reduced: true, docked: true });
    expect(reduce(reduced, { type: "WALK", dir: "right" }).state).toBe("idle");
    const walking = at("walk", { talking: false });
    const stopped = reduce(walking, { type: "CONTEXT", reduced: true, docked: false });
    expect(stopped.state).toBe("idle");
    expect(viewState({ ...walking, reduced: true })).toBe("idle");
    expect(viewState(walking)).toBe("walk");
    // other poses are kept as still poses
    expect(reduce(reduced, { type: "CELEBRATE" }).state).toBe("celebrate");
  });

  it("each state has a face", () => {
    expect(faceFor("sleep")).toBe("sleep");
    expect(faceFor("celebrate")).toBe("joy");
    expect(faceFor("think")).toBe("think");
    expect(faceFor("shrug")).toBe("worried");
    expect(faceFor("idle")).toBe("neutral");
  });
});

/* ------------------------------------------------------------------ D6: movement planner */
describe("D6: movement planner", () => {
  it("clamps inside the viewport at every size, even tiny ones", () => {
    for (const vw of [320, 375, 768, 1024, 1440, 1920, 90]) {
      for (const x of [-500, 0, 5, vw / 2, vw, vw + 500]) {
        const c = clampX(x, vw, 80, 12);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c + 80).toBeLessThanOrEqual(Math.max(vw, 80));
      }
    }
    expect(homeX(1440, 84, 20)).toBe(1440 - 84 - 20);
    expect(homeX(320, 79, 12)).toBe(320 - 79 - 12);
  });

  it("roams only on desktop widths with motion allowed", () => {
    expect(canRoam({ width: 1280, reducedMotion: false, paused: false, noRoam: false })).toBe(true);
    expect(canRoam({ width: 767, reducedMotion: false, paused: false, noRoam: false })).toBe(false);
    expect(canRoam({ width: 768, reducedMotion: false, paused: false, noRoam: false })).toBe(true);
    expect(canRoam({ width: 1280, reducedMotion: true, paused: false, noRoam: false })).toBe(false);
    expect(canRoam({ width: 1280, reducedMotion: false, paused: true, noRoam: false })).toBe(false);
    expect(canRoam({ width: 1280, reducedMotion: false, paused: false, noRoam: true })).toBe(false);
  });

  it("walk time follows distance within bounds", () => {
    expect(walkDuration(0, 1)).toBe(380);
    expect(walkDuration(0, 100000)).toBe(1700);
    expect(walkDuration(0, 380)).toBeGreaterThan(walkDuration(0, 190));
  });

  const base = { viewportHeight: 900, headerOffset: 96, stripHeight: 200 };
  it("scroll: leaves a target that is already readable", () => {
    expect(planScroll({ ...base, targetTop: 150, targetBottom: 500 })).toBe(0);
  });
  it("scroll: brings an off-screen target to the header edge (down and up)", () => {
    expect(planScroll({ ...base, targetTop: 2000, targetBottom: 2300 })).toBe(1904);
    expect(planScroll({ ...base, targetTop: -900, targetBottom: -600 })).toBe(-996);
  });
  it("scroll: a target taller than the viewport is aligned to its top, once", () => {
    expect(planScroll({ ...base, targetTop: 600, targetBottom: 4000 })).toBe(504);
    expect(planScroll({ ...base, targetTop: 100, targetBottom: 4000 })).toBe(0);
  });

  const input = (over: Partial<Parameters<typeof planPoint>[0]> = {}): Parameters<typeof planPoint>[0] => ({
    viewport: { width: 1440, height: 900 },
    size: { width: 84, height: 102 },
    bottomOffset: 24,
    margin: 20,
    currentX: 1336,
    target: rect(0, 100, 1440, 600),
    contentLeft: 100,
    contentRight: 1340,
    avoid: [],
    ...over,
  });

  it("point: a wide gutter beside the content is used, never outside the viewport", () => {
    const p = planPoint(input({ avoid: [rect(100, 780, 1240, 90)] }));
    expect(p.clear).toBe(true);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x + 84).toBeLessThanOrEqual(1440);
    expect(p.x + 84 <= 100 || p.x >= 1340).toBe(true);
  });
  it("point: points toward the target side, or up when standing under it", () => {
    expect(planPoint(input({ target: rect(600, 100, 400, 300), avoid: [rect(100, 780, 1240, 90)] })).pointDir).toMatch(/left|right/);
    expect(planPoint(input({ target: rect(0, 100, 1440, 300), contentLeft: 0, contentRight: 1440, avoid: [] })).pointDir).toBe("up");
  });
  it("point: with no free spot it takes the least-covered one and reports not clear", () => {
    const wall = [rect(0, 760, 1440, 140)];
    const p = planPoint(input({ avoid: wall, viewport: { width: 400, height: 900 }, contentLeft: 0, contentRight: 400, target: rect(0, 100, 400, 600) }));
    expect(p.clear).toBe(false);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x + 84).toBeLessThanOrEqual(400);
  });
  it("point: works for targets off-screen, taller than the viewport and tiny viewports", () => {
    expect(planPoint(input({ target: rect(0, 5000, 1440, 400) })).x).toBeGreaterThanOrEqual(0);
    expect(planPoint(input({ target: rect(0, -4000, 1440, 9000) })).x).toBeGreaterThanOrEqual(0);
    const tiny = planPoint(input({ viewport: { width: 320, height: 480 }, target: rect(0, 50, 320, 300), contentLeft: 16, contentRight: 304 }));
    expect(tiny.x).toBeGreaterThanOrEqual(0);
    expect(tiny.x + 84).toBeLessThanOrEqual(320);
    expect(planPoint(input({ target: null })).pointDir).toBe("up");
  });
  it("point: an open panel's footprint is avoided too", () => {
    const text = [rect(900, 560, 420, 200)]; // above the sprite, where the panel would sit
    const p = planPoint(input({ avoid: text, panel: { width: 352, height: 300 }, currentX: 1336 }));
    expect(overlapArea(rect(p.x, 774, 84, 102), text[0]!)).toBe(0);
  });
  it("panel opens toward the side with room", () => {
    expect(panelAlign(20, 352, 1440)).toBe("left");
    expect(panelAlign(1336, 352, 1440)).toBe("right");
  });
});

/* ------------------------------------------------------------------ dialogue runner */
describe("dialogue runner", () => {
  it("variants follow build-time facts", () => {
    expect([...conditionsOf(facts({ hasWork: true }))].sort()).toEqual(["hasWork", "priceHidden"]);
    expect([...conditionsOf(facts({ hasSlots: true }))]).toContain("slots");
    expect([...conditionsOf(facts({ hasSlots: false }))]).toContain("empty");
    expect([...conditionsOf(facts({ priceMode: "from" }))]).toContain("pricesShown");
  });
  it("cost: hidden shows no number; priced shows exactly the lines it is given", () => {
    const hidden = resolveNode(mascot, "cost", ctx())!;
    expect(hidden.lines.join(" ")).not.toMatch(/[0-9$]/);
    const priced = resolveNode(mascot, "cost", ctx({ priceMode: "from", priceLines: ["Pilot: Pilot from $1,234", "Monthly 8: From $2,345 a month"] }))!;
    expect(priced.lines).toContain("Pilot: Pilot from $1,234");
    expect(priced.lines.join(" ").match(/\$[0-9,]+/g)).toEqual(["$1,234", "$2,345"]);
  });
  it("work: published work opens the lightbox; none says so plainly", () => {
    const has = resolveNode(mascot, "work", ctx({ hasWork: true }))!;
    expect(has.actions.some((a) => "lightbox" in a)).toBe(true);
    const none = resolveNode(mascot, "work", ctx({ hasWork: false, hasSlots: true }))!;
    expect(none.actions.some((a) => "lightbox" in a)).toBe(false);
    expect(none.lines.join(" ")).toMatch(/no real work is published/i);
    expect(none.pose).toBe("shrug");
    const empty = resolveNode(mascot, "work", ctx({ hasWork: false, hasSlots: false }))!;
    expect(empty.lines.join(" ")).toMatch(/no real work is published/i);
  });
  it("tokens expand; tips and nudges are route aware", () => {
    expect(expandLines(["a", "{tip}", "{priceLines}"], ctx({ priceLines: ["x", "y"] }, "T"))).toEqual(["a", "T", "x", "y"]);
    expect(expandLines(["{tip}"], ctx({}, ""))).toEqual([]);
    expect(tipFor(mascot, "/plans")).toBe(mascot.tips["/plans"]![0]);
    expect(tipFor(mascot, "/nowhere")).toBe(mascot.tips.default![0]);
    expect(nudgeFor(mascot, "/plans")).toBeTruthy();
    expect(nudgeFor(mascot, "/")).toBeNull();
    expect(resolveNode(mascot, "missing", ctx())).toBeNull();
  });
  it("plain text drops markers for speech and screen readers", () => {
    expect(plainLine("People decide. [CONFIRM: x, PH-17] Tools assist.")).toBe("People decide. Tools assist.");
  });
  it("the scripted brain returns the same shape as a resolved node", async () => {
    const out = await scriptedBrain(mascot).next({ nodeId: "pilot", pathname: "/", ctx: ctx() });
    const r = resolveNode(mascot, "pilot", ctx())!;
    expect(out).toEqual({ lines: r.lines, pose: r.pose, actions: r.actions, choices: r.choices });
  });
});

/* ------------------------------------------------------------------ limits */
describe("E5: limits on unprompted behaviour", () => {
  const free: Blockers = { menuOpen: false, lightboxOpen: false, formActive: false, panelOpen: false };
  it("one per page view, three per session, each kind once", () => {
    let b = emptyBudget;
    expect(canSpeak(b, "greeting", "/", free)).toBe(true);
    b = spend(b, "greeting");
    expect(canSpeak(b, "tip", "/", free)).toBe(false); // same page view
    b = newPageView(b);
    expect(canSpeak(b, "greeting", "/plans", free)).toBe(false); // already greeted
    expect(canSpeak(b, "tip", "/plans", free)).toBe(true);
    b = spend(b, "tip");
    b = newPageView(b);
    expect(canSpeak(b, "tip", "/work", free)).toBe(false);
    expect(canSpeak(b, "nudge", "/work", free)).toBe(true);
    b = spend(b, "nudge");
    b = newPageView(b);
    expect(b.sessionCount).toBe(3);
    expect(canSpeak(b, "nudge", "/plans", free)).toBe(false);
    expect(canSpeak({ ...emptyBudget, sessionCount: 3 }, "greeting", "/", free)).toBe(false);
  });
  it("never on the form page, never while something else is active, never after hide or quiet", () => {
    expect(canSpeak(emptyBudget, "greeting", "/contact", free)).toBe(false);
    expect(canSpeak(emptyBudget, "greeting", "/contact/thanks", free)).toBe(false);
    for (const k of ["menuOpen", "lightboxOpen", "formActive", "panelOpen"] as const) expect(canSpeak(emptyBudget, "greeting", "/", { ...free, [k]: true })).toBe(false);
    expect(canSpeak({ ...emptyBudget, hidden: true }, "greeting", "/", free)).toBe(false);
    expect(canSpeak({ ...emptyBudget, quiet: true }, "greeting", "/", free)).toBe(false);
  });
});

/* ------------------------------------------------------------------ lead flow logic */
describe("F2: chat lead flow uses the form's rules and copy", () => {
  const msg = LEAD_ERROR_MESSAGES;
  it("rejects with the form's exact error copy", () => {
    expect(validateStep("name", emptyAnswers)).toBe(msg.name);
    expect(validateStep("email", { ...emptyAnswers, email: "nope" })).toBe(msg.email);
    expect(validateStep("website", { ...emptyAnswers, website: "" })).toBe(msg.website);
    expect(validateStep("make", emptyAnswers)).toBe(msg.make);
    expect(validateStep("role", emptyAnswers)).toBe(msg.role);
    expect(validateStep("consent", emptyAnswers)).toBe(msg.consent);
  });
  it("accepts good answers", () => {
    expect(validateStep("name", { ...emptyAnswers, name: "Sam" })).toBeNull();
    expect(validateStep("email", { ...emptyAnswers, email: "sam@fixture.test" })).toBeNull();
    expect(validateStep("website", { ...emptyAnswers, website: "fixture.test" })).toBeNull();
    expect(validateStep("make", { ...emptyAnswers, make: "Product explainer" })).toBeNull();
    expect(validateStep("role", { ...emptyAnswers, role: "Other" })).toBeNull();
    expect(validateStep("consent", { ...emptyAnswers, consent: true })).toBeNull();
    expect(LEAD_STEPS).toEqual(["name", "email", "website", "make", "role", "consent"]);
  });
  it("payload carries the form's fields plus honeypot and time-trap", () => {
    const body = buildPayload({ name: " Sam ", email: "sam@fixture.test", website: "fixture.test", make: "Product explainer", role: "Other", consent: true }, { startedAt: 123, hp: "", formId: "home", extra: { landing_path: "/" } });
    expect(body).toMatchObject({ name: "Sam", email: "sam@fixture.test", make: ["Product explainer"], role: "Other", consent: true, hp: "", startedAt: 123, formId: "home", landing_path: "/" });
  });
  it("routes map to form ids", () => {
    expect(formIdFor("/")).toBe("home");
    expect(formIdFor("/for/agencies")).toBe("agencies");
    expect(formIdFor("/for/startups")).toBe("startups");
    expect(formIdFor("/plans")).toBe("contact");
  });
  it("interprets the endpoint's answers", () => {
    expect(interpretResponse({ ok: true, status: 200, json: { ok: true } }, "g")).toEqual({ kind: "ok" });
    expect(interpretResponse({ ok: false, status: 400, json: { errors: { email: "Bad email" } } }, "g")).toEqual({ kind: "field", step: "email", message: "Bad email" });
    expect(interpretResponse({ ok: false, status: 500, json: { errors: { form: "Oops" } } }, "g")).toEqual({ kind: "failed", message: "Oops" });
    expect(interpretResponse({ ok: false, status: 502, json: null }, "generic")).toEqual({ kind: "failed", message: "generic" });
  });
});

/* ------------------------------------------------------------------ A1, A2, A4, E1: the content */
describe("content/mascot.json", () => {
  const strings = collectStrings(content).filter((s) => !/(^|\.)(start|next|goto|scroll|point|lightbox|pose)(\[|$|\.)/.test(s.path) && !/^nodes\.[a-z-]+$/.test(s.path));
  const copy = strings.filter((s) => !/\.(next|goto|scroll|point|lightbox)$/.test(s.path));

  it("validates against the schema", () => {
    expect(mascotSchema.safeParse(content).success).toBe(true);
  });

  it("A1: every string passes the banned-phrase and fabrication lint (prices and numeric claims included)", () => {
    for (const s of copy) expect(lintCopy(s.value), `${s.path}: ${s.value}`).toEqual([]);
  });

  it("A2: no digits or currency symbols in any line (prices and plan names arrive only from plans.json at run time)", () => {
    for (const s of copy) expect(stripMarkers(s.value), `${s.path}`).not.toMatch(/[0-9$€£₹]/);
  });

  it("A2: the only unknowns are existing placeholder markers", () => {
    for (const s of copy) if (hasMarker(s.value)) expect(s.value).toMatch(/\[(CONFIRM|PLACEHOLDER): [^\]]*PH-\d\d\]/);
  });

  it("A4: Tween never claims to be human or an AI assistant, and says nothing about AI use", () => {
    for (const s of copy) {
      expect(s.value, s.path).not.toMatch(/\bI am (a )?(human|person|real person|assistant|chatbot|bot)\b/i);
      expect(s.value, s.path).not.toMatch(/\bAI\b|artificial intelligence|\bGPT\b|language model/i);
    }
    expect(JSON.stringify(mascot)).toContain("the Tweencrew mascot");
  });

  it("E1: the graph validates: no dangling next, nothing unreachable, max four choices, lines within 140 characters, real routes", () => {
    expect(validateGraph(mascot, { routes: routes() })).toEqual([]);
  });

  it("E1: every node is reachable from the start node", () => {
    expect(reachable(mascot).size).toBe(Object.keys(mascot.nodes).length);
  });

  it("E1: all seven entry points exist", () => {
    const reach = (from: string, to: string): boolean => {
      const seen = new Set<string>();
      const go = (id: string): boolean => {
        if (id === to) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        return (mascot.nodes[id]?.choices ?? []).some((c) => go(c.next));
      };
      return go(from);
    };
    for (const id of ["pilot", "work", "cost", "agency", "startup", "plan", "browse"]) expect(reach(mascot.start, id), id).toBe(true);
  });

  it("E1: every point/scroll target is named, and the nodes that point also navigate to a known route", () => {
    for (const t of targetsInGraph(mascot)) expect(t.target).toMatch(/^[a-z0-9-]+$/);
    expect(routes()).toContain("/plans");
  });

  it("no node links to a page that is not a route", () => {
    const known = routes();
    for (const [id, n] of Object.entries(mascot.nodes)) for (const a of n.do ?? []) if ("goto" in a) expect(known, id).toContain(a.goto);
  });

  it("every ui and lead label is non-empty copy (A5: components hold no strings)", () => {
    for (const [k, v] of Object.entries({ ...mascot.ui, ...mascot.lead })) if (typeof v === "string") expect(v.trim().length, k).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ H4: off switch */
describe("H4: site-wide off switch", () => {
  it("is on by default", () => expect(mascotEnabled({ enabled: true }, {})).toBe(true));
  it("content flag turns it off", () => expect(mascotEnabled({ enabled: false }, {})).toBe(false));
  it("environment variable turns it off at build time", () => {
    for (const v of ["0", "false", "off"]) expect(mascotEnabled({ enabled: true }, { TWEEN_ENABLED: v })).toBe(false);
    expect(mascotEnabled({ enabled: true }, { TWEEN_ENABLED: "1" })).toBe(true);
  });
  it("the layout renders the loader only when enabled, and the API answers 404 when off", () => {
    const layout = fs.readFileSync(path.join(root, "app", "layout.tsx"), "utf8");
    expect(layout).toMatch(/mascotEnabled\(getMascot\(\)\) && <TweenLoader/);
    expect(fs.readFileSync(path.join(root, "app", "api", "mascot", "route.ts"), "utf8")).toMatch(/status: 404/);
  });
});

describe("G6 / A5: the prototype is gone and components hold no copy", () => {
  it("nothing imports components/TweenPet", () => {
    expect(fs.existsSync(path.join(root, "components", "TweenPet.tsx"))).toBe(false);
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (["node_modules", ".next", ".git"].some((x) => e.name.startsWith(x))) continue;
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (/\.(tsx?|mjs)$/.test(e.name) && /TweenPet/.test(fs.readFileSync(f, "utf8")) && !f.endsWith("mascot.test.ts")) hits.push(f);
      }
    };
    for (const d of ["app", "components", "lib", "tests"]) walk(path.join(root, d));
    expect(hits).toEqual([]);
  });

  it("A5: no JSX text literals or aria strings in components/mascot (all copy comes from content/mascot.json)", () => {
    const dir = path.join(root, "components", "mascot");
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".tsx"))) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      // text between tags that contains letters and is not an expression
      const jsxText = [...src.matchAll(/<[A-Za-z][\w.]*(?:\s[^<>]*)?>\s*([^<>{}]*[A-Za-z][^<>{}]*)\s*<\//g)].map((m) => m[1]!.trim()).filter((t) => t && !/=>|&&/.test(t));
      expect(jsxText, `${f} JSX text`).toEqual([]);
      expect([...src.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]), `${f} aria-label`).toEqual([]);
    }
  });
});

/* ------------------------------------------------------------------ F1 / F3: the chat payload against the real route handler */
import { afterEach, beforeEach } from "vitest";
import { POST } from "@/app/api/lead/route";
import { resetRateLimits } from "@/lib/rate-limit";
import { tmpDir } from "./helpers";

describe("F1/F3: the chat flow's payload through the real /api/lead handler (default time-trap)", () => {
  let dir: string;
  const saved = { ...process.env };
  beforeEach(() => {
    dir = tmpDir("tween-lead-");
    Object.assign(process.env, { LEAD_DATA_DIR: dir, LEAD_STORE: "file", EMAIL_TRANSPORT: "outbox", EMAIL_INTERNAL_TO: "studio@example.com", LEAD_SKIP_MX: "1", LEAD_RATE_LIMIT_MAX: "50", SITE_MODE: "preview", NEXT_PUBLIC_SITE_URL: "https://site.test" });
    resetRateLimits();
  });
  afterEach(() => {
    process.env = { ...saved };
  });
  let n = 0;
  const answers = { name: "Sam Tester", email: "sam@example.com", website: "example.com", make: "Product explainer", role: "Marketing, growth or content", consent: true };
  const post = (body: unknown) => POST(new Request("http://localhost/api/lead", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.1.0.${++n}` }, body: JSON.stringify(body) }));
  const leads = () => (fs.existsSync(path.join(dir, "leads.jsonl")) ? fs.readFileSync(path.join(dir, "leads.jsonl"), "utf8").trim().split("\n").filter(Boolean) : []);

  it("a complete chat request is accepted and stored with the form's fields", async () => {
    const res = await post(buildPayload(answers, { startedAt: Date.now() - 20_000, hp: "", formId: "home", extra: {} }));
    expect((await res.json()).ok).toBe(true);
    const stored = JSON.parse(leads()[0]!);
    expect(stored).toMatchObject({ name: "Sam Tester", email: "sam@example.com", make: ["Product explainer"], role: "Marketing, growth or content" });
  });
  it("a bot-like instant submit and a filled honeypot get a generic success and create no record", async () => {
    const fast = await post(buildPayload(answers, { startedAt: Date.now() - 300, hp: "", formId: "home", extra: {} }));
    expect((await fast.json()).ok).toBe(true);
    const bot = await post(buildPayload(answers, { startedAt: Date.now() - 20_000, hp: "x", formId: "home", extra: {} }));
    expect((await bot.json()).ok).toBe(true);
    expect(leads()).toHaveLength(0);
  });
  it("missing consent and a bad email are rejected with the form's error copy", async () => {
    const res = await post({ ...buildPayload({ ...answers, email: "nope" }, { startedAt: Date.now() - 20_000, hp: "", formId: "home", extra: {} }) });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.errors.email).toBe(LEAD_ERROR_MESSAGES.email);
    const noConsent = await post({ ...buildPayload(answers, { startedAt: Date.now() - 20_000, hp: "", formId: "home", extra: {} }), consent: false });
    expect((await noConsent.json()).errors.consent).toBe(LEAD_ERROR_MESSAGES.consent);
  });
});

/* ------------------------------------------------------------------ A1 / A3: the guards cover content/mascot.json */
import { runGuard } from "@/lib/guard";
import { cloneContent, readJson, writeJson, completeDir, ensureFixtureContent } from "./helpers";

describe("A1/A3: the honesty lint and the production guard cover content/mascot.json", () => {
  const withEdit = (edit: (m: MascotContent) => void) => {
    const dir = cloneContent();
    const file = path.join(dir, "mascot.json");
    const m = readJson<MascotContent>(file);
    edit(m);
    writeJson(file, m);
    return dir;
  };
  it("a marker in Tween's copy is tolerated in preview and refused in production", () => {
    const dir = withEdit((m) => {
      m.nodes.pilot!.say[0] = "A pilot is quick. [PLACEHOLDER: pilot length, PH-13]";
    });
    const preview = runGuard({ root, contentDir: dir, strict: false });
    expect(preview.issues).toEqual([]);
    expect(preview.placeholders.some((p) => p.file.endsWith("mascot.json"))).toBe(true);
    const strict = runGuard({ root, contentDir: dir, strict: true });
    expect(strict.issues.some((i) => i.rule === "placeholder" && i.file.endsWith("mascot.json"))).toBe(true);
  });
  it("a banned phrase, a price or a numeric claim in Tween's copy blocks both modes", () => {
    for (const bad of ["We deliver seamless results.", "Pilots start at $500.", "Our clients see 40% more views."]) {
      const dir = withEdit((m) => {
        m.nodes.pilot!.say[0] = bad;
      });
      for (const strict of [false, true]) expect(runGuard({ root, contentDir: dir, strict }).issues.some((i) => i.file.endsWith("mascot.json") && i.rule !== "placeholder"), `${bad} strict=${strict}`).toBe(true);
    }
  });
  it("the complete fixture (copied from content/mascot.json) passes strict mode", () => {
    ensureFixtureContent();
    expect(fs.existsSync(path.join(completeDir, "mascot.json"))).toBe(true);
    expect(runGuard({ root, contentDir: completeDir, strict: true }).issues).toEqual([]);
  });
});
