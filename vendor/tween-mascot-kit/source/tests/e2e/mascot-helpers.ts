import { expect, type Page } from "@playwright/test";

export const toggle = (page: Page) => page.locator('[data-tween="toggle"]');
export const panel = (page: Page) => page.locator('[data-tween="panel"]');
export const chip = (page: Page, id: string) => page.locator(`[data-tween-chip="${id}"]`);
export const root = (page: Page) => page.locator('[data-tween="root"]');

/**
 * The first-visit intro on Home (components/mascot/Intro.tsx) has its own spec, mascot-intro.both.spec.ts. Every other
 * spec starts as a visitor who has already seen it this session, so the docked Tween is there from the start.
 */
export async function seenIntro(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("tween-intro", "1");
    } catch {
      /* storage blocked: the intro plays and openTween skips it */
    }
  });
}

/** Tween loads after idle; wait for it, then open the panel with a click. If the intro is playing, Escape skips it. */
export async function openTween(page: Page): Promise<void> {
  await page.locator('[data-tween="toggle"], [data-tween="intro"]').first().waitFor({ timeout: 20_000 });
  if (await page.locator('[data-tween="intro"]').count()) await page.keyboard.press("Escape");
  await toggle(page).waitFor({ timeout: 20_000 });
  await toggle(page).click();
  await expect(panel(page)).toBeVisible();
}

/** Click a chip and wait for the answer to finish (the next chip set, or a given chip, appears). */
export async function pick(page: Page, id: string, waitFor?: string): Promise<void> {
  await chip(page, id).click();
  if (waitFor) await expect(chip(page, waitFor)).toBeVisible({ timeout: 25_000 });
}

export async function skipTyping(page: Page): Promise<void> {
  const skip = page.locator('[data-tween="skip"]');
  if (await skip.count()) await skip.first().click().catch(() => undefined);
}

/** Every distinct value `data-state` takes on Tween's root while `fn` runs. */
export async function recordStates(page: Page, fn: () => Promise<void>): Promise<string[]> {
  await page.evaluate(() => {
    const w = window as unknown as { __twStates: Set<string> };
    w.__twStates = new Set();
    const el = document.querySelector('[data-tween="root"]');
    if (el) w.__twStates.add(el.getAttribute("data-state") ?? "");
    new MutationObserver(() => {
      const r = document.querySelector('[data-tween="root"]');
      if (r) w.__twStates.add(r.getAttribute("data-state") ?? "");
    }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ["data-state"] });
  });
  await fn();
  return page.evaluate(() => [...(window as unknown as { __twStates: Set<string> }).__twStates]);
}

export const PAGES_FOR_A11Y = ["/", "/work", "/plans"];
