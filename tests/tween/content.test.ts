import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import raw from "@/content/tween.json";
import { loadTweenContent } from "@/lib/tween/bundle";
import type { TweenContent } from "@/lib/tween/types";
import { MAX_CHOICES, MAX_LINE_CHARS, allLines, lintCopy, parseTweenContent, reachable, targetsInGraph, tweenSchema, validateGraph } from "@/lib/tween/validate";

const root = process.cwd();
const content: TweenContent = loadTweenContent();

/** App routes: every page.tsx under src/app/(app), without dynamic segments (route groups do not appear in the URL). */
function appRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith("[")) continue;
      walk(path.join(dir, e.name), `${prefix}/${e.name}`);
    }
    if (fs.existsSync(path.join(dir, "page.tsx"))) out.push(prefix || "/");
  };
  walk(path.join(root, "src", "app", "(app)"), "");
  return out;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(f, out);
    else if (/\.tsx?$/.test(e.name)) out.push(f);
  }
  return out;
}

const clone = (): TweenContent => JSON.parse(JSON.stringify(content)) as TweenContent;

describe("src/content/tween.json", () => {
  it("validates against the schema, with the on switch present", () => {
    expect(tweenSchema.safeParse(raw).success).toBe(true);
    expect(content.enabled).toBe(true);
  });

  it("rejects malformed content", () => {
    expect(() => parseTweenContent({ ...raw, nodes: { ...raw.nodes, bad: { say: [] } } })).toThrow();
    expect(() => parseTweenContent({ ...raw, events: { ...raw.events, approved: { pose: "dance" } } })).toThrow();
    expect(() => parseTweenContent({ ...raw, extra: 1 })).toThrow();
  });

  it("the graph is sound: no dangling next, nothing unreachable, at most four choices, every line within 140 characters, real routes", () => {
    expect(validateGraph(content, { routes: appRoutes() })).toEqual([]);
    expect(reachable(content).size).toBe(Object.keys(content.nodes).length);
    expect(MAX_CHOICES).toBe(4);
    expect(MAX_LINE_CHARS).toBe(140);
    for (const { where, line } of allLines(content)) if (line !== "{tip}") expect(line.length, where).toBeLessThanOrEqual(140);
  });

  it("the validator catches a dangling choice, an orphan node, a fifth choice, a long line and a goto that is not a route", () => {
    const rules = (c: TweenContent) => validateGraph(c, { routes: appRoutes() }).map((i) => i.rule);
    const dangling = clone();
    dangling.nodes.more!.choices!.push({ label: "x", next: "nowhere" });
    expect(rules(dangling)).toContain("dangling-next");
    const orphan = clone();
    orphan.nodes.orphan = { say: ["Hello."] };
    expect(rules(orphan)).toContain("unreachable");
    const five = clone();
    five.nodes.root!.choices = Array.from({ length: 5 }, (_, i) => ({ label: `Option ${i}`, next: "more" }));
    expect(rules(five)).toContain("too-many-choices");
    const long = clone();
    long.nodes.how!.say[0] = "x".repeat(141);
    expect(rules(long)).toContain("line-too-long");
    const badRoute = clone();
    badRoute.nodes.brand!.do = [{ goto: "/nowhere" }];
    expect(rules(badRoute)).toContain("unknown-route");
    const badTip = clone();
    badTip.tips["/nowhere"] = ["Hi."];
    expect(rules(badTip)).toContain("unknown-route");
  });

  it("every goto, tip and nudge route is a real signed-in app route", () => {
    const routes = appRoutes();
    for (const r of ["/week", "/setup", "/brand", "/results", "/history"]) expect(routes).toContain(r);
    for (const n of Object.values(content.nodes)) for (const a of n.do ?? []) if ("goto" in a) expect(routes).toContain(a.goto);
    for (const r of Object.keys(content.tips)) if (r !== "default") expect(routes).toContain(r);
    for (const r of Object.keys(content.nudges)) expect(routes).toContain(r);
  });

  it("has route tips for /week, /setup, /brand, /results and /history", () => {
    for (const r of ["/week", "/setup", "/brand", "/results", "/history"]) expect(content.tips[r]?.length, r).toBeGreaterThan(0);
    expect(content.tips.default?.length).toBeGreaterThan(0);
  });

  it("every point/scroll target exists as data-tween-target in the app", () => {
    const sources = sourceFiles(path.join(root, "src")).map((f) => fs.readFileSync(f, "utf8"));
    const targets = targetsInGraph(content);
    expect(targets.map((t) => t.target).sort()).toEqual(["facts", "generate", "posts"]);
    for (const t of targets) {
      const literal = sources.some((s) => s.includes(`data-tween-target="${t.target}"`));
      // the brand page's sections carry their id as the target (components/brand/section.tsx)
      const section = sources.some((s) => s.includes("data-tween-target={id}")) && sources.some((s) => new RegExp(`<BrandSection\\s+id="${t.target}"`).test(s));
      expect(literal || section, `${t.node} -> ${t.target}`).toBe(true);
    }
    // and each is on the page its node navigates to
    const week = fs.readFileSync(path.join(root, "src", "components", "week", "week-view.tsx"), "utf8");
    expect(week).toContain('data-tween-target="generate"');
    expect(week).toContain('data-tween-target="posts"');
    expect(targets.filter((t) => ["generate", "posts"].includes(t.target)).every((t) => t.route === "/week")).toBe(true);
    expect(targets.find((t) => t.target === "facts")?.route).toBe("/brand");
  });

  describe("copy rules: plain, short, friendly; no prices, promises, claims, dates or numbers", () => {
    const copy = [
      ...allLines(content),
      ...Object.entries(content.ui).map(([k, line]) => ({ where: `ui.${k}`, line })),
      { where: "name", line: content.name },
    ].filter((l) => l.line !== "{tip}");

    it("no digits, prices, result promises, dates or claims about the business in any line", () => {
      for (const { where, line } of copy) expect(lintCopy(line), `${where}: ${line}`).toEqual([]);
    });

    it("the lint itself catches what it should", () => {
      expect(lintCopy("Posts from 5 a week")).toContain("number");
      expect(lintCopy("Plans start at $9")).toEqual(expect.arrayContaining(["number", "price"]));
      expect(lintCopy("Get more customers")).toContain("promise");
      expect(lintCopy("Go viral this week")).toContain("promise");
      expect(lintCopy("We guarantee results")).toContain("promise");
      expect(lintCopy("Post it on Monday")).toContain("date");
      expect(lintCopy("I am a real person")).toContain("human");
      expect(lintCopy("Written by AI")).toContain("ai");
      expect(lintCopy("Approve, edit or skip each post.")).toEqual([]);
    });

    it("says what the app really does: weekly email, approve/edit/skip, nothing posted without the owner, Please check, Share or Download", () => {
      const all = copy.map((l) => l.line).join(" ").toLowerCase();
      for (const needle of ["email", "approve", "edit", "skip", "nothing is posted without you", "please check", "share or download", "brand details"]) expect(all, needle).toContain(needle);
    });

    it("Tween never claims to be a person", () => {
      expect(copy.map((l) => l.line).join(" ")).not.toMatch(/\bI am (a )?(human|person)\b/i);
    });
  });

  describe("app events", () => {
    it("has copy for every event the app sends, with the lines the brief asks for", () => {
      expect(content.events.generating).toEqual({ pose: "think", say: "Writing your posts. This takes about a minute." });
      expect(content.events.posts_ready).toEqual({ pose: "celebrate", say: "Your posts are ready. Look for anything marked 'Please check'." });
      expect(content.events.generate_failed.pose).toBe("shrug");
      expect(content.events.generate_failed.say?.length).toBeGreaterThan(0);
      expect(content.events.approved).toEqual({ pose: "celebrate" });
      expect(content.events.all_approved).toEqual({ pose: "celebrate", say: "That's the week done." });
      expect(content.events.setup_started.pose).toBe("wave");
      expect(content.events.setup_started.say?.length).toBeGreaterThan(0);
      expect(content.events.setup_done.pose).toBe("celebrate");
    });
  });
});

describe("components hold no copy", () => {
  it("no JSX text literals or aria strings in components/tween (all words come from src/content/tween.json)", () => {
    const dir = path.join(root, "src", "components", "tween");
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".tsx"))) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      const jsxText = [...src.matchAll(/<[A-Za-z][\w.]*(?:\s[^<>]*)?>\s*([^<>{}]*[A-Za-z][^<>{}]*)\s*<\//g)].map((m) => m[1]!.trim()).filter((t) => t && !/=>|&&/.test(t));
      expect(jsxText, `${f} JSX text`).toEqual([]);
      expect([...src.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]), `${f} aria-label`).toEqual([]);
    }
  });

  it("nothing in src/components/tween or src/lib/tween imports from the vendor kit, a model client, or the lead flow", () => {
    for (const dir of ["components/tween", "lib/tween"]) {
      for (const f of sourceFiles(path.join(root, "src", dir))) {
        const src = fs.readFileSync(f, "utf8");
        expect(src, f).not.toMatch(/from ["'][^"']*vendor/);
        expect(src, f).not.toMatch(/@\/lib\/ai|@google\/genai|\/api\/lead/);
      }
    }
  });

  it("only the validator imports zod, so the lazy chunk stays small", () => {
    for (const f of sourceFiles(path.join(root, "src", "lib", "tween")).concat(sourceFiles(path.join(root, "src", "components", "tween")))) {
      if (path.basename(f) === "validate.ts") continue;
      expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/from ["']zod["']/);
    }
  });
});
