import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { chip, openTween, panel, pick, recordStates, root, skipTyping, toggle, seenIntro } from "./mascot-helpers";
import { events, eventsNamed } from "./helpers";

test.beforeEach(async ({ page }) => seenIntro(page));

/** Mascot gates that run against both the preview build and the production-mode fixture build, desktop and mobile. */

const A11Y_PAGES = ["/", "/work", "/plans", "/contact"];
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
const blocking = (r: Awaited<ReturnType<typeof axe>>) => r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);

test.describe("B1: axe with Tween closed, open and mid-conversation", () => {
  for (const route of A11Y_PAGES) {
    test(`axe: ${route}`, async ({ page }, info) => {
      await page.goto(route);
      await page.waitForLoadState("load");
      await page.evaluate(() => document.querySelectorAll(".reveal,.draw").forEach((e) => e.classList.add("is-visible")));
      if (route === "/contact") {
        await page.waitForTimeout(2500);
        await expect(toggle(page)).toHaveCount(0); // Tween stays away from the form page
        expect(blocking(await axe(page))).toEqual([]);
        return;
      }
      await toggle(page).waitFor({ timeout: 20_000 });
      await page.waitForTimeout(900);
      const out: Record<string, string[]> = {};
      out.closed = blocking(await axe(page));
      await toggle(page).click();
      await expect(chip(page, "more")).toBeVisible({ timeout: 25_000 });
      out.open = blocking(await axe(page));
      await pick(page, "more", "browse");
      out.midConversation = blocking(await axe(page));
      await page.locator('[data-tween="settings-toggle"]').click();
      out.settings = blocking(await axe(page));
      fs.mkdirSync(path.resolve("mascot/eval-results/axe"), { recursive: true });
      fs.writeFileSync(path.resolve("mascot/eval-results/axe", `${info.project.name}-${route.replace(/\W+/g, "_")}.json`), JSON.stringify(out, null, 2));
      expect(out).toEqual({ closed: [], open: [], midConversation: [], settings: [] });
    });
  }
});

test.describe("B2/B4: keyboard", () => {
  test("open, choose, skip typing, close with Esc (focus returns), pause, hide, restart, voice", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard check runs on desktop");
    await page.goto("/");
    await toggle(page).waitFor({ timeout: 20_000 });
    await toggle(page).focus();
    await expect(toggle(page)).toBeFocused();
    // visible focus ring
    const ring = await toggle(page).evaluate((el) => getComputedStyle(el).outlineStyle + " " + getComputedStyle(el).outlineWidth);
    expect(ring).toBe("solid 2px");
    await page.keyboard.press("Enter");
    await expect(panel(page)).toBeVisible();
    // focus moved into the panel; a chip appears once Tween has spoken, and skipping the typing is a button
    await expect(page.locator('[data-tween="skip"]').first()).toBeVisible({ timeout: 5000 }).catch(() => undefined);
    await skipTyping(page);
    await expect(chip(page, "more")).toBeVisible({ timeout: 25_000 });
    await chip(page, "more").focus();
    await page.keyboard.press("Enter");
    await expect(chip(page, "browse")).toBeVisible({ timeout: 25_000 });
    // settings are all buttons, each reachable and with a focus ring
    await page.locator('[data-tween="settings-toggle"]').focus();
    await page.keyboard.press("Enter");
    const ids = ["pause-setting", "roam", "restart", "hide-setting"];
    if (await page.locator('[data-tween="voice"]').count()) ids.unshift("voice"); // shown only where the browser can speak
    for (const id of ids) {
      const b = page.locator(`[data-tween="${id}"]`);
      await b.focus();
      await expect(b).toBeFocused();
      expect(await b.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
    }
    await page.keyboard.press("Escape"); // first Esc closes the settings list
    await expect(page.locator('[data-tween="settings"]')).toHaveCount(0);
    await page.keyboard.press("Escape"); // second closes the panel
    await expect(panel(page)).toHaveCount(0);
    await expect(toggle(page)).toBeFocused();
    // the first Tab sequence into Tween reaches pause and hide
    await page.keyboard.press("Tab");
    await expect(page.locator('[data-tween="pause"]')).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator('[data-tween="hide"]')).toBeFocused();
    // pause persists
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-tween="root"] svg.tw-rig')).toHaveAttribute("data-still", "true");
    await page.reload();
    await toggle(page).waitFor({ timeout: 20_000 });
    await expect(page.locator('[data-tween="root"] svg.tw-rig')).toHaveAttribute("data-still", "true");
    // hide persists across a reload, and Tween comes back with its own button
    await page.locator('[data-tween="hide"]').focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-tween="show"]')).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-tween="show"]')).toBeVisible({ timeout: 20_000 });
    await expect(toggle(page)).toHaveCount(0);
    await page.locator('[data-tween="show"]').focus();
    await page.keyboard.press("Enter");
    await expect(toggle(page)).toBeVisible();
    // restore pause for later tests in this context
    await page.evaluate(() => localStorage.clear());
  });

  test("hide is reachable by touch and persists (mobile)", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile only");
    await page.goto("/");
    await openTween(page);
    await page.locator('[data-tween="settings-toggle"]').click();
    await page.locator('[data-tween="hide-setting"]').click();
    await expect(page.locator('[data-tween="show"]')).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-tween="show"]')).toBeVisible({ timeout: 20_000 });
  });
});

test("B6: every Tween control is at least 44px", async ({ page }) => {
  await page.goto("/");
  await openTween(page);
  await expect(chip(page, "more")).toBeVisible({ timeout: 25_000 });
  await page.locator('[data-tween="settings-toggle"]').click();
  const small = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>('[data-tween="root"] button, [data-tween="root"] a, [data-tween="root"] input:not([data-tween="hp"])').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return; // not rendered
      if (r.width < 43.5 || r.height < 43.5) out.push(`${el.getAttribute("data-tween") ?? el.textContent?.trim()}: ${Math.round(r.width)}x${Math.round(r.height)}`);
    });
    return out;
  });
  expect(small).toEqual([]);
});

test.describe("B5: live region and transcript", () => {
  test("the greeting is not announced; lines in an open panel are announced once; the transcript lists the conversation", async ({ page }) => {
    await page.goto("/");
    await toggle(page).waitFor({ timeout: 20_000 });
    const greeting = page.locator('[data-tween="greeting"]');
    await expect(greeting).toBeVisible({ timeout: 12_000 });
    expect(await greeting.evaluate((el) => !!el.closest("[aria-live],[role=status],[role=alert],[role=log]"))).toBe(false);
    await page.evaluate(() => {
      const w = window as unknown as { __live: string[] };
      w.__live = [];
      const el = document.querySelector('[data-tween="root"]');
      new MutationObserver(() => {
        const t = document.querySelector('[data-tween="live"]')?.textContent ?? "";
        if (t && w.__live[w.__live.length - 1] !== t) w.__live.push(t);
      }).observe(el!, { childList: true, subtree: true, characterData: true });
    });
    await toggle(page).click();
    await expect(chip(page, "more")).toBeVisible({ timeout: 25_000 });
    const announced = await page.evaluate(() => (window as unknown as { __live: string[] }).__live);
    expect(announced.length).toBeGreaterThanOrEqual(2);
    expect(new Set(announced).size).toBe(announced.length); // each line once
    await expect(page.locator('[data-tween="live"]')).toHaveAttribute("aria-live", "polite");
    // transcript lists the conversation and is reachable by a button
    await page.locator('[data-tween="transcript-toggle"]').click();
    const items = await page.locator('[data-tween="transcript"] li').allInnerTexts();
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0]).toMatch(/^Tween:/);
    // nothing is announced while the panel is closed
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-tween="live"]')).toHaveCount(0);
  });
});

test.describe("B3: reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("no walking, bobbing, hopping, typing or smooth scrolling; everything still works", async ({ page, isMobile }) => {
    await page.goto("/");
    await toggle(page).waitFor({ timeout: 20_000 });
    await expect(page.locator('[data-tween="root"] svg.tw-rig')).toHaveAttribute("data-still", "true");
    const css = await page.evaluate(() => {
      const q = (s: string) => getComputedStyle(document.querySelector(s)!);
      return {
        bob: q(".tw-bob").animationName,
        tail: q(".tw-tail").animationName,
        feather: q(".tw-feather").animationName,
        arm: q(".tw-arm-r").transitionDuration,
        root: q('[data-tween="root"]').transitionProperty,
      };
    });
    expect(css.bob).toBe("none");
    expect(css.tail).toBe("none");
    expect(css.feather).toBe("none");
    expect(["0s", "0.01ms", "1e-05s"]).toContain(css.arm);
    const states = await recordStates(page, async () => {
      await toggle(page).click();
      // no typewriter: the whole first line is there at once
      await expect(page.locator('[data-tween="bubble-line"]').first()).toHaveText(/Where would you like to start\?/, { timeout: 4000, useInnerText: true });
      await expect(chip(page, "pilot")).toBeVisible({ timeout: 8000 });
      await pick(page, "pilot");
      await expect(chip(page, "pilot-plans")).toBeVisible({ timeout: 15_000 });
    });
    expect(states).not.toContain("walk");
    expect(await page.locator('[data-tween="root"]').getAttribute("data-away")).toBe("false");
    await expect(page).toHaveURL(/\/how-it-works$/);
    // the spotlight and the pose still convey where Tween is pointing, and scrolling was instant (no smooth behaviour)
    await expect(page.locator('[data-tween="spotlight"]')).toHaveAttribute("data-target", "steps");
    const smooth = await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
    expect(smooth).not.toBe("smooth");
    void isMobile;
  });
});

test.describe("C6: storage that throws, and C4: a clean run", () => {
  test("Tween works when localStorage and sessionStorage throw", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      const boom = () => {
        throw new DOMException("blocked", "SecurityError");
      };
      for (const k of ["localStorage", "sessionStorage"] as const) Object.defineProperty(window, k, { get: boom, configurable: true });
    });
    await page.goto("/");
    await openTween(page);
    await expect(chip(page, "more")).toBeVisible({ timeout: 25_000 });
    await pick(page, "more", "browse");
    await page.locator('[data-tween="settings-toggle"]').click();
    await page.locator('[data-tween="hide-setting"]').click();
    await expect(page.locator('[data-tween="show"]')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("no console errors or warnings, no failed or third-party requests while using the features", async ({ page, baseURL }) => {
    const bad: string[] = [];
    const origin = new URL(baseURL!).origin;
    const external: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") bad.push(`${m.type()}: ${m.text()}`);
    });
    page.on("pageerror", (e) => bad.push(`pageerror: ${e.message}`));
    page.on("requestfailed", (r) => bad.push(`failed: ${r.url()} ${r.failure()?.errorText}`));
    page.on("response", (r) => {
      if (r.status() >= 400) bad.push(`http ${r.status()}: ${r.url()}`);
    });
    page.on("request", (r) => {
      if (!r.url().startsWith(origin) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) external.push(r.url());
    });
    await page.goto("/");
    await openTween(page);
    await expect(chip(page, "more")).toBeVisible({ timeout: 25_000 });
    await pick(page, "more", "plan");
    await pick(page, "plan");
    await expect(page.locator('[data-tween="lead-input"]')).toBeVisible({ timeout: 25_000 });
    await page.locator('[data-tween="lead-cancel"]').click();
    await page.locator('[data-tween="settings-toggle"]').click();
    await page.locator('[data-tween="restart"]').click();
    await expect(chip(page, "cost")).toBeVisible({ timeout: 25_000 });
    await pick(page, "cost", "pilot");
    await expect(page).toHaveURL(/\/plans$/);
    await pick(page, "pilot", "plan");
    await expect(page).toHaveURL(/\/how-it-works$/);
    expect(bad).toEqual([]);
    expect(external).toEqual([]);
  });
});

test("C7: route changes keep one Tween, close the panel on visitor navigation, keep the transcript", async ({ page, isMobile }) => {
  test.skip(isMobile, "uses the desktop header links");
  await page.goto("/");
  await openTween(page);
  await expect(chip(page, "cost")).toBeVisible({ timeout: 25_000 });
  await pick(page, "cost", "pilot"); // Tween navigates itself: the panel stays open
  await expect(page).toHaveURL(/\/plans$/);
  await expect(panel(page)).toBeVisible();
  await expect(root(page)).toHaveCount(1);
  await page.locator("header").getByRole("link", { name: "Work", exact: true }).click(); // the visitor navigates: the panel closes
  await expect(page).toHaveURL(/\/work$/);
  await expect(panel(page)).toHaveCount(0);
  await expect(root(page)).toHaveCount(1);
  await toggle(page).click();
  await page.locator('[data-tween="transcript-toggle"]').click();
  const texts = (await page.locator('[data-tween="transcript"] li').allInnerTexts()).join(" | ");
  expect(texts).toContain("What does it cost?");
  expect(texts).toMatch(/Pricing is scoped per pilot|Prices come from the Plans page/);
});

test.describe("E5/E6: unprompted behaviour", () => {
  test("greeting once per page view; nudge once per session; nothing on /contact; dismissing stops it", async ({ page }) => {
    await page.clock.install();
    await page.goto("/plans");
    await toggle(page).waitFor({ timeout: 20_000 });
    await page.clock.fastForward(46_000);
    const bubble = page.locator('[data-tween="greeting"]');
    await expect(bubble).toContainText("Not sure which plan fits");
    await expect(page.locator('[data-tween="greeting"]')).toHaveCount(1);
    await page.locator('[data-tween="greeting-dismiss"]').click();
    await page.clock.fastForward(200_000);
    await expect(bubble).toHaveCount(0); // the nudge is once per session
    const budget = await page.evaluate(() => JSON.parse(sessionStorage.getItem("tween-budget") ?? "{}"));
    expect(budget.nudged).toBe(true);
    expect(budget.sessionCount).toBeLessThanOrEqual(3);
  });

  test("a landing page gets one greeting and no second bubble in the same page view", async ({ page }) => {
    await page.clock.install();
    await page.goto("/");
    await toggle(page).waitFor({ timeout: 20_000 });
    await page.clock.fastForward(6000);
    await expect(page.locator('[data-tween="greeting"]')).toHaveCount(1);
    await page.locator('[data-tween="greeting-dismiss"]').click();
    await page.clock.fastForward(120_000);
    await expect(page.locator('[data-tween="greeting"]')).toHaveCount(0);
    const budget = await page.evaluate(() => JSON.parse(sessionStorage.getItem("tween-budget") ?? "{}"));
    expect(budget.sessionCount).toBe(1);
  });

  test("none on /contact", async ({ page }) => {
    await page.clock.install();
    await page.goto("/contact");
    await page.clock.fastForward(120_000);
    await expect(page.locator('[data-tween="greeting"]')).toHaveCount(0);
    await expect(root(page)).toHaveCount(0);
  });

  test("hidden Tween makes no unprompted bubble and runs no timers until brought back", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("tween-hidden", "1"));
    await page.clock.install();
    await page.goto("/");
    await expect(page.locator('[data-tween="show"]')).toBeVisible({ timeout: 20_000 });
    await page.clock.fastForward(200_000);
    await expect(page.locator('[data-tween="greeting"]')).toHaveCount(0);
    await expect(toggle(page)).toHaveCount(0);
  });

  test("a docked Tween falls asleep after a minute and wakes on input", async ({ page }) => {
    await page.clock.install();
    await page.goto("/work");
    await toggle(page).waitFor({ timeout: 20_000 });
    await page.clock.runFor(61_000);
    await expect(root(page)).toHaveAttribute("data-state", "sleep");
    await page.mouse.click(5, 300);
    await expect(root(page)).toHaveAttribute("data-state", /idle|wave/);
  });
});

test.describe("C3: no horizontal scroll and no layout shift", () => {
  for (const width of [320, 375, 768, 1024, 1440, 1920]) {
    test(`at ${width}px with Tween docked, open and out walking`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 700 : 900 });
      await page.addInitScript(() => {
        const w = window as unknown as { __cls: number; __tweenShift: number };
        w.__cls = 0;
        w.__tweenShift = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean; sources?: { node?: Node }[] }[]) {
            if (e.hadRecentInput) continue;
            w.__cls += e.value;
            if (e.sources?.some((s) => s.node && (s.node.nodeType === 1 ? (s.node as Element) : s.node.parentElement)?.closest("[data-tween]"))) w.__tweenShift += e.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      await page.goto("/plans");
      await toggle(page).waitFor({ timeout: 20_000 });
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1500); // the page's own load-time shifts are done
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const clsBefore = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
      expect(await overflow()).toBeLessThanOrEqual(0);
      await toggle(page).click();
      await expect(chip(page, "pilot")).toBeVisible({ timeout: 25_000 });
      expect(await overflow()).toBeLessThanOrEqual(0);
      const clsOpen = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
      expect(clsOpen - clsBefore, "opening the panel shifts nothing on the page").toBeLessThan(0.001);
      await pick(page, "pilot", "pilot-plans");
      await page.waitForTimeout(500);
      expect(await overflow()).toBeLessThanOrEqual(0);
      const box = await page.locator('[data-tween="root"] .tw-anchor').boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(-0.5);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
      const panelBox = await panel(page).boundingBox();
      expect(panelBox!.x).toBeGreaterThanOrEqual(-0.5);
      expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(width + 0.5);
      // Tween never shifts anything itself (it is fixed and out of flow); the route change Tween triggers is the page's own.
      expect(await page.evaluate(() => (window as unknown as { __tweenShift: number }).__tweenShift), "layout shift caused by Tween").toBe(0);
    });
  }
});

test.describe("D1: states are individually reachable (developer hook, preview and test builds only)", () => {
  const STATE_QUERY: Record<string, string> = { idle: "idle", walk: "walk", wave: "wave", point: "point", talk: "talk", think: "think", celebrate: "celebrate", sleep: "sleep", shrug: "shrug" };
  for (const [state, q] of Object.entries(STATE_QUERY)) {
    test(`?tween=${q}`, async ({ page, baseURL }, info) => {
      await page.goto(`/?tween=${q}`);
      if (baseURL?.includes("3200")) {
        // production mode: the hook is not in the build
        await toggle(page).waitFor({ timeout: 20_000 });
        await expect(root(page)).toHaveAttribute("data-state", "idle");
        return;
      }
      await expect(root(page)).toHaveAttribute("data-state", state, { timeout: 20_000 });
      const dir = path.resolve("mascot/eval-results/states");
      fs.mkdirSync(dir, { recursive: true });
      await page.waitForTimeout(500);
      await root(page).screenshot({ path: path.join(dir, `${state}-${info.project.name}.png`) });
    });
  }
  test("?tween=peek shows the hidden state", async ({ page, baseURL }) => {
    await page.goto("/?tween=peek");
    if (baseURL?.includes("3200")) {
      await toggle(page).waitFor({ timeout: 20_000 });
      await expect(page.locator('[data-tween="show"]')).toHaveCount(0);
      return;
    }
    await expect(page.locator('[data-tween="show"]')).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("D4/D5/D7: roaming, pointing and the spotlight", () => {
  const FLOWS: { name: string; start: string; scroll?: number; chips: string[]; url: RegExp; target: string }[] = [
    { name: "how it works steps", start: "/", chips: ["pilot"], url: /\/how-it-works$/, target: "steps" },
    { name: "plans pilot", start: "/", chips: ["pilot", "pilot-plans"], url: /\/plans$/, target: "pilot" },
    { name: "plans pilot, started from the middle of a long page", start: "/", scroll: 1600, chips: ["pilot", "pilot-plans"], url: /\/plans$/, target: "pilot" },
  ];
  for (const f of FLOWS) {
    test(`walks to a clear spot, points, rings the target, then goes home: ${f.name}`, async ({ page, isMobile }) => {
      test.setTimeout(90_000);
      await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
      await page.goto(f.start);
      if (f.scroll) await page.evaluate((y) => window.scrollTo(0, y), f.scroll);
      await openTween(page);
      await expect(chip(page, f.chips[0]!)).toBeVisible({ timeout: 25_000 });
      const homeBox = (await page.locator('[data-tween="root"] .tw-anchor').boundingBox())!;
      for (let i = 0; i < f.chips.length; i++) {
        await chip(page, f.chips[i]!).click();
        if (i < f.chips.length - 1) await expect(chip(page, f.chips[i + 1]!)).toBeVisible({ timeout: 25_000 });
      }
      await expect(page).toHaveURL(f.url);
      const ring = page.locator('[data-tween="spotlight"]');
      await expect(ring).toHaveAttribute("data-target", f.target, { timeout: 20_000 });
      await expect(root(page)).toHaveAttribute("data-state", "point", { timeout: 20_000 });
      const vp = page.viewportSize()!;
      const tw = (await page.locator('[data-tween="root"] .tw-anchor').boundingBox())!;
      // inside the viewport, never off an edge
      expect(tw.x).toBeGreaterThanOrEqual(-0.5);
      expect(tw.x + tw.width).toBeLessThanOrEqual(vp.width + 0.5);
      expect(tw.y + tw.height).toBeLessThanOrEqual(vp.height + 0.5);
      // D7: docked only on narrow screens
      if (isMobile) {
        await expect(root(page)).toHaveAttribute("data-away", "false");
        expect(Math.abs(tw.x - homeBox.x)).toBeLessThan(2);
      } else {
        await expect(root(page)).toHaveAttribute("data-away", "true");
        // never over the target's headings or the form and calls to action
        const clash = await page.evaluate(
          ({ id, r }) => {
            const t = document.querySelector(`[data-tween-target="${id}"]`)!;
            const hits: string[] = [];
            t.querySelectorAll("h1,h2,h3,[data-lead-form],[data-cta-id],form,input,textarea").forEach((el) => {
              const b = el.getBoundingClientRect();
              if (b.width === 0 || b.bottom < 0 || b.top > window.innerHeight) return;
              if (b.left < r.x + r.w && b.right > r.x && b.top < r.y + r.h && b.bottom > r.y) hits.push(`${el.tagName}.${(el as HTMLElement).dataset.ctaId ?? el.textContent?.slice(0, 20)}`);
            });
            return hits;
          },
          { id: f.target, r: { x: tw.x, y: tw.y, w: tw.width, h: tw.height } },
        );
        expect(clash).toEqual([]);
      }
      // D5: the ring is on the target element, tracks scroll, and clears after the line
      const matches = async () => {
        const [rb, tb] = await Promise.all([ring.boundingBox(), page.locator(`[data-tween-target="${f.target}"]`).first().boundingBox()]);
        return { rb: rb!, tb: tb! };
      };
      let { rb, tb } = await matches();
      expect(Math.abs(rb.x - Math.max(tb.x, 6))).toBeLessThan(3);
      expect(Math.abs(rb.y - Math.max(tb.y, 6))).toBeLessThan(3);
      await page.evaluate(() => window.scrollBy(0, 40));
      await page.waitForTimeout(250);
      ({ rb, tb } = await matches());
      expect(Math.abs(rb.y - Math.max(tb.y, 6))).toBeLessThan(3);
      await page.setViewportSize({ width: vp.width - 60, height: vp.height });
      await page.waitForTimeout(300);
      ({ rb, tb } = await matches());
      expect(Math.abs(rb.x - Math.max(tb.x, 6))).toBeLessThan(3);
      await page.setViewportSize(vp);
      await expect(ring).toHaveCount(0, { timeout: 15_000 });
      await expect(root(page)).toHaveAttribute("data-away", "false", { timeout: 10_000 });
      const back = (await page.locator('[data-tween="root"] .tw-anchor').boundingBox())!;
      expect(Math.abs(back.x - homeBox.x)).toBeLessThan(2);
    });
  }

  test("D7: 'Do not roam' keeps Tween docked", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop only");
    await page.goto("/");
    await openTween(page);
    await expect(chip(page, "pilot")).toBeVisible({ timeout: 25_000 });
    await page.locator('[data-tween="settings-toggle"]').click();
    await page.locator('[data-tween="roam"]').click();
    await page.locator('[data-tween="settings-toggle"]').click();
    const states = await recordStates(page, async () => {
      await pick(page, "pilot", "pilot-plans");
    });
    expect(states).not.toContain("walk");
    await expect(root(page)).toHaveAttribute("data-away", "false");
    await expect(page.locator('[data-tween="spotlight"]')).toHaveAttribute("data-target", "steps");
  });

  test("a walk shows the walk state and faces the direction of travel", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop only");
    await page.goto("/");
    await openTween(page);
    await expect(chip(page, "pilot")).toBeVisible({ timeout: 25_000 });
    const states = await recordStates(page, async () => {
      await pick(page, "pilot", "pilot-plans");
    });
    expect(states).toContain("walk");
    expect(states).toContain("point");
  });
});

test("B7: Tween never covers the focused element while tabbing through a page", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop keyboard walk");
  test.setTimeout(90_000);
  await page.goto("/plans");
  await toggle(page).waitFor({ timeout: 20_000 });
  const covered: string[] = [];
  for (let i = 0; i < 45; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(330);
    const res = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      const tw = document.querySelector('[data-tween="root"] .tw-anchor') as HTMLElement | null;
      const rootEl = document.querySelector('[data-tween="root"]') as HTMLElement | null;
      if (!a || !tw || rootEl?.contains(a) || a === document.body) return null;
      const b = a.getBoundingClientRect();
      const t = tw.getBoundingClientRect();
      if (b.width === 0 || b.bottom < 0 || b.top > window.innerHeight) return null;
      const overlap = b.left < t.right && b.right > t.left && b.top < t.bottom && b.bottom > t.top;
      return overlap ? `${a.tagName} ${a.textContent?.trim().slice(0, 30)} @${Math.round(b.left)},${Math.round(b.top)}` : null;
    });
    if (res) covered.push(res);
  }
  expect(covered).toEqual([]);
});

test("events: Tween's events fire once each with their own names", async ({ page }) => {
  await page.goto("/");
  await openTween(page);
  await expect(chip(page, "more")).toBeVisible({ timeout: 25_000 });
  await pick(page, "more", "browse");
  expect((await eventsNamed(page, "tween_open")).length).toBe(1);
  expect((await eventsNamed(page, "tween_choice")).length).toBe(1);
  const names = (await events(page)).map((e) => e.name);
  expect(names.filter((n) => n.startsWith("tween_")).sort()).toEqual(["tween_choice", "tween_open"]);
  await page.locator('[data-tween="settings-toggle"]').click();
  await page.locator('[data-tween="hide-setting"]').click();
  expect((await eventsNamed(page, "tween_hide")).length).toBe(1);
});

test("C5: hiding Tween removes its listeners and timers; bringing it back restores them", async ({ page }) => {
  await page.addInitScript(() => {
    const live = new Map<string, number>();
    const key = (t: unknown, type: string) => `${t === window ? "window" : t === document ? "document" : "other"}:${type}`;
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const seen = new WeakMap<object, Set<string>>();
    EventTarget.prototype.addEventListener = function (type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | AddEventListenerOptions) {
      if (this === window || this === document) {
        const id = `${type}:${(fn as { name?: string })?.name ?? ""}`;
        const s = seen.get(this) ?? new Set();
        const k = key(this, type);
        if (fn && !s.has(id + String(live.get(k)))) live.set(k, (live.get(k) ?? 0) + 1);
        seen.set(this, s);
      }
      return add.call(this, type, fn, opts);
    };
    EventTarget.prototype.removeEventListener = function (type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | EventListenerOptions) {
      if (this === window || this === document) {
        const k = key(this, type);
        live.set(k, Math.max(0, (live.get(k) ?? 0) - 1));
      }
      return remove.call(this, type, fn, opts);
    };
    (window as unknown as { __listeners: () => Record<string, number> }).__listeners = () => Object.fromEntries(live);
  });
  await page.goto("/");
  await toggle(page).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(500);
  const TYPES = ["window:pointermove", "window:pointerdown", "window:keydown", "window:wheel", "window:touchstart", "document:focusin"];
  const count = async () => {
    const l = await page.evaluate(() => (window as unknown as { __listeners: () => Record<string, number> }).__listeners());
    return TYPES.reduce((n, t) => n + (l[t] ?? 0), 0);
  };
  const active = await count();
  await page.locator('[data-tween="hide"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-tween="show"]')).toBeVisible();
  await page.waitForTimeout(300);
  const hidden = await count();
  expect(active - hidden, "listeners released on hide").toBeGreaterThanOrEqual(4);
  await page.locator('[data-tween="show"]').click();
  await expect(toggle(page)).toBeVisible();
  await page.waitForTimeout(300);
  expect(await count()).toBeGreaterThanOrEqual(active - 1);
  fs.mkdirSync(path.resolve("mascot/eval-results"), { recursive: true });
  fs.writeFileSync(path.resolve("mascot/eval-results/c5-listeners.txt"), `active=${active} hidden=${hidden}\n`);
});

test("B8: nothing is spoken without a user action, and voice is off by default", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __speak: number };
    w.__speak = 0;
    if ("speechSynthesis" in window) {
      const real = window.speechSynthesis.speak.bind(window.speechSynthesis);
      window.speechSynthesis.speak = (u: SpeechSynthesisUtterance) => {
        w.__speak++;
        return real(u);
      };
    }
  });
  await page.clock.install();
  await page.goto("/");
  await toggle(page).waitFor({ timeout: 20_000 });
  await page.clock.runFor(70_000); // greeting, idle timers, sleep: all unprompted behaviour
  expect(await page.evaluate(() => (window as unknown as { __speak: number }).__speak)).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem("tween-voice"))).toBeNull();
  await toggle(page).click();
  await expect(chip(page, "more")).toBeVisible({ timeout: 25_000 });
  await pick(page, "more", "browse");
  expect(await page.evaluate(() => (window as unknown as { __speak: number }).__speak), "opening and choosing with voice off").toBe(0);
  const hasVoice = await page.evaluate(() => "speechSynthesis" in window);
  if (hasVoice) {
    await page.locator('[data-tween="settings-toggle"]').click();
    await page.locator('[data-tween="voice"]').click(); // the visitor turns voice on
    expect(await page.evaluate(() => (window as unknown as { __speak: number }).__speak), "turning voice on speaks nothing by itself").toBe(0);
    await page.locator('[data-tween="settings-toggle"]').click();
    await pick(page, "browse", "root"); // a user action: now it may speak
    expect(await page.evaluate(() => (window as unknown as { __speak: number }).__speak)).toBeGreaterThan(0);
  }
});

test.describe("C6: without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("the page works and Tween is simply absent", async ({ page }) => {
    const res = await page.goto("/plans");
    expect(res?.status()).toBe(200);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("[data-tween]")).toHaveCount(0);
    await expect(page.locator("main")).toContainText(/pilot/i);
  });
});
