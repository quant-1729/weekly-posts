import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Chips } from "@/components/tween/Chips";
import { TweenRig } from "@/components/tween/TweenRig";
import { buildBundle, isTweenEnabled, loadTweenContent } from "@/lib/tween/bundle";
import { tweenEnabled } from "@/lib/tween/enabled";
import { parseTweenContent } from "@/lib/tween/validate";

const root = process.cwd();
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");

describe("off switch", () => {
  it("is on by default", () => {
    expect(tweenEnabled({ enabled: true }, {})).toBe(true);
    expect(isTweenEnabled({})).toBe(true);
  });
  it("the content flag turns it off", () => {
    expect(tweenEnabled({ enabled: false }, {})).toBe(false);
  });
  it("TWEEN_ENABLED=0 (also false, off) turns it off; 1 leaves it on", () => {
    for (const v of ["0", "false", "off", "OFF", " 0 "]) {
      expect(tweenEnabled({ enabled: true }, { TWEEN_ENABLED: v }), v).toBe(false);
      expect(isTweenEnabled({ TWEEN_ENABLED: v }), v).toBe(false);
      expect(buildBundle({ TWEEN_ENABLED: v })).toBeNull();
    }
    expect(tweenEnabled({ enabled: true }, { TWEEN_ENABLED: "1" })).toBe(true);
    expect(buildBundle({ TWEEN_ENABLED: "1" })).not.toBeNull();
  });
  it("broken content means no Tween, not a crash", async () => {
    vi.resetModules();
    vi.doMock("@/content/tween.json", () => ({ default: { enabled: true } }));
    const mod = await import("@/lib/tween/bundle");
    expect(mod.isTweenEnabled({})).toBe(false);
    expect(mod.buildBundle({})).toBeNull();
    vi.doUnmock("@/content/tween.json");
    vi.resetModules();
  });
});

describe("GET /api/tween", () => {
  const saved = process.env.TWEEN_ENABLED;
  beforeEach(() => {
    delete process.env.TWEEN_ENABLED;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.TWEEN_ENABLED;
    else process.env.TWEEN_ENABLED = saved;
    vi.doUnmock("@/content/tween.json");
    vi.resetModules();
  });

  it("returns the validated bundle as same-origin JSON", async () => {
    const { GET } = await import("@/app/api/tween/route");
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["tween"]);
    expect(() => parseTweenContent(body.tween)).not.toThrow();
    expect(body.tween).toEqual(loadTweenContent());
    expect(body.tween.start).toBe("root");
  });

  it("answers 404 when TWEEN_ENABLED=0", async () => {
    process.env.TWEEN_ENABLED = "0";
    const { GET } = await import("@/app/api/tween/route");
    expect(GET().status).toBe(404);
  });

  it("answers 404 when the content file says \"enabled\": false", async () => {
    vi.resetModules();
    const real = JSON.parse(read("src", "content", "tween.json"));
    vi.doMock("@/content/tween.json", () => ({ default: { ...real, enabled: false } }));
    const { GET } = await import("@/app/api/tween/route");
    expect(GET().status).toBe(404);
  });

  it("carries no personal data: the bundle is only the written content", async () => {
    const { GET } = await import("@/app/api/tween/route");
    const text = JSON.stringify(await GET().json());
    expect(text).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
  });
});

describe("delivery: signed-in app layout only", () => {
  it("the app layout renders the loader only when Tween is enabled", () => {
    const layout = read("src", "app", "(app)", "layout.tsx");
    expect(layout).toMatch(/isTweenEnabled\(\)/);
    expect(layout).toMatch(/tween \? <TweenLoader \/>/);
  });

  it("no other layout or page mounts Tween (not login, not email-link pages, not the public ready page)", () => {
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (/\.tsx?$/.test(e.name) && /TweenLoader/.test(fs.readFileSync(f, "utf8"))) hits.push(path.relative(root, f).replace(/\\/g, "/"));
      }
    };
    walk(path.join(root, "src"));
    expect(hits.sort()).toEqual(["src/app/(app)/layout.tsx", "src/components/tween/TweenLoader.tsx"]);
  });

  it("the loader fetches /api/tween and lazy-imports the Tween chunk, after load and idle", () => {
    const loader = read("src", "components", "tween", "TweenLoader.tsx");
    expect(loader).toContain('fetch("/api/tween")');
    expect(loader).toContain('import("./Tween")');
    expect(loader).toMatch(/requestIdleCallback/);
    expect(loader).toMatch(/readyState === "complete"/);
    expect(loader).toMatch(/\.catch\(\(\) => undefined\)/); // either failing means no Tween
  });

  it("the dev hook is guarded to non-production builds", () => {
    expect(read("src", "components", "tween", "Tween.tsx")).toContain('const DEV_HOOK = process.env.NODE_ENV !== "production"');
  });

  it("app code signals through tweenSignal and the setup and week flows call it", () => {
    expect(read("src", "components", "week", "week-view.tsx")).toMatch(/tweenSignal\("generating"\)[\s\S]*tweenSignal\("posts_ready"\)[\s\S]*tweenSignal\("generate_failed"\)/);
    const setup = read("src", "app", "(app)", "setup", "setup-wizard.tsx");
    expect(setup).toContain('tweenSignal("setup_started")');
    expect(setup).toContain('tweenSignal("setup_done")');
  });
});

describe("the character and its controls", () => {
  it("renders the rig in the standard navy and cobalt palette, whatever the brand colours are", () => {
    const html = renderToStaticMarkup(createElement(TweenRig, { state: "idle", face: "neutral", facing: "left", pointDir: "left", talking: false, still: false }));
    expect(html).toContain('data-state="idle"');
    expect(html).toContain("#0B1C30"); // navy
    expect(html).toContain("#2B4CFF"); // cobalt scarf
    expect(html).toContain('aria-hidden="true"');
  });

  it("every pose the app uses has CSS, and reduced motion and pause stop all loops", () => {
    const css = read("src", "components", "tween", "rig.css");
    for (const s of ["idle", "talk", "walk", "wave", "point", "think", "celebrate", "shrug", "sleep", "peek"]) expect(css, s).toMatch(new RegExp(`data-state="${s}"`));
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/);
    expect(css).toMatch(/\[data-still="true"\][\s\S]*animation: none !important/);
    // navy on dark backgrounds gets the white halo
    expect(css).toMatch(/drop-shadow\(0 0 1\.5px rgba\(255, 255, 255, 0\.9\)\)/);
  });

  it("the replies are native buttons, hidden until Tween has finished speaking", () => {
    const html = renderToStaticMarkup(createElement(Chips, { chips: [{ label: "One", value: "a" }], ready: false, label: "Choose", onPick: () => undefined }));
    expect(html).toContain("<button");
    expect(html).toContain("visibility:hidden");
  });

  it("Hide, Pause and Don't roam controls are remembered on the device; voice is off by default", () => {
    const tween = read("src", "components", "tween", "Tween.tsx");
    for (const k of ["hidden", "paused", "noRoam", "voice"]) expect(tween).toContain(`KEYS.${k}`);
    expect(tween).toContain('read("local", KEYS.voice) === "1"');
    const content = loadTweenContent();
    expect(content.ui.noRoam).toBe("Don't roam");
    expect(content.ui.hide).toBeTruthy();
    expect(content.ui.pause).toBeTruthy();
  });

  it("the focus-avoidance from the kit is in place so Tween never sits over a focused control", () => {
    const tween = read("src", "components", "tween", "Tween.tsx");
    expect(tween).toContain('document.addEventListener("focusin", onFocus)');
    expect(tween).toContain("covered(t, L.x)");
  });
});
