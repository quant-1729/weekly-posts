import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { conditionsOf, type Facts } from "../../lib/mascot/dialogue";
import type { MascotContent } from "../../lib/content-schema";
import { seenIntro } from "./mascot-helpers";

test.beforeEach(async ({ page }) => seenIntro(page));

/**
 * E1 (browser half): walk the dialogue graph of the build under test. Every `point` and `scroll` target must exist as a
 * data-tween-target on the page named by the preceding goto, and every goto must load, for every variant that applies to this build.
 */
function contentFor(baseURL: string): MascotContent {
  const dir = baseURL.includes("3200") ? "tests/fixtures/content-complete" : baseURL.includes("3300") ? "tests/fixtures/content-priced" : "content";
  return JSON.parse(fs.readFileSync(path.resolve(dir, "mascot.json"), "utf8")) as MascotContent;
}

test("every node's goto loads and every target exists on its page", async ({ page, request, baseURL }) => {
  const content = contentFor(baseURL!);
  const bundle = (await (await request.get("/api/mascot")).json()) as { facts: Facts };
  const active = conditionsOf(bundle.facts);
  const missing: string[] = [];
  const checked: string[] = [];
  for (const [id, node] of Object.entries(content.nodes)) {
    const versions = [{ label: id, actions: node.do ?? [] }];
    for (const [cond, v] of Object.entries(node.variants ?? {})) if (active.has(cond as never) && v?.do) versions.push({ label: `${id}[${cond}]`, actions: v.do });
    if (versions.length > 1) versions.shift(); // a variant replaces the base actions
    for (const ver of versions) {
      let route = "";
      for (const a of ver.actions) {
        if ("goto" in a) {
          route = a.goto;
          const res = await page.goto(a.goto);
          expect(res?.status(), `${ver.label} goto ${a.goto}`).toBeLessThan(400);
        }
        const target = "point" in a ? a.point : "scroll" in a ? a.scroll : null;
        if (target) {
          if (!route) throw new Error(`${ver.label}: ${target} has no preceding goto`);
          const n = await page.locator(`[data-tween-target="${target}"]`).count();
          checked.push(`${ver.label}: ${route}#${target}`);
          if (n < 1) missing.push(`${ver.label}: ${route} has no data-tween-target="${target}"`);
        }
      }
    }
  }
  fs.mkdirSync(path.resolve("mascot/eval-results"), { recursive: true });
  fs.writeFileSync(path.resolve("mascot/eval-results", `graph-walk-${new URL(baseURL!).port}.txt`), checked.join("\n") + "\n");
  expect(missing).toEqual([]);
  expect(checked.length).toBeGreaterThan(4);
});
