import { expect, test } from "@playwright/test";
import { root, seenIntro, toggle } from "./mascot-helpers";

/**
 * The first-visit intro on Home (components/mascot/Intro.tsx): Tween walks in, pulls a letter from its scarf, tosses it
 * onto the hero, climbs onto the header and sits on the wordmark. Plus the eye-cover on email fields.
 */
const intro = '[data-tween="intro"]';
const letter = '[data-tween="letter"] .tw-letter-btn';

test.describe("intro", () => {
  test("first visit to Home: the letter lands in the hero and Tween sits on the header", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(intro)).toBeVisible({ timeout: 20_000 });
    await expect(toggle(page)).toHaveCount(0);
    // the letter lands inside the first section, and scrolls with it
    await expect(page.locator(letter)).toBeVisible({ timeout: 15_000 });
    expect(await page.locator('[data-tween="letter"]').evaluate((el) => el.parentElement === document.querySelector("#main section"))).toBe(true);
    // Tween climbs up and sits beside the wordmark, inside the 72px header
    await expect(page.locator(`${intro}[data-perched="true"]`)).toBeVisible({ timeout: 20_000 });
    const box = await page.locator(intro).boundingBox();
    const mark = await page.locator("header [data-nav='home']").boundingBox();
    const header = await page.locator("header").first().boundingBox();
    expect(box && mark && header).toBeTruthy();
    // sits in the header band (the preview banner pushes the header down; the legs may dangle a little below it)
    expect(box!.y).toBeGreaterThanOrEqual(header!.y - 4);
    expect(box!.y + box!.height).toBeLessThan(header!.y + header!.height + 24);
    expect(Math.abs(box!.x + box!.width / 2 - (mark!.x + mark!.width))).toBeLessThan(40);
    // Escape sends Tween back to its corner, without opening the chat
    await page.keyboard.press("Escape");
    await expect(toggle(page)).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(intro)).toHaveCount(0);
    await expect(page.locator('[data-tween="panel"]')).toHaveCount(0);
    // the letter stays on the page after the intro
    await expect(page.locator(letter)).toBeVisible();
  });

  test("clicking Tween on the header opens the chat", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(`${intro}[data-perched="true"]`)).toBeVisible({ timeout: 35_000 });
    await page.locator(`${intro} button`).click();
    await expect(page.locator('[data-tween="panel"]')).toBeVisible({ timeout: 5_000 });
  });

  test("a click during the walk-in skips straight to the end", async ({ page }) => {
    await page.goto("/");
    // Tween starts just past the right edge; click as soon as it has walked into view
    await expect(page.locator(intro)).toBeInViewport({ timeout: 20_000 });
    await page.locator(`${intro} button`).click({ force: true });
    await expect(toggle(page)).toBeVisible({ timeout: 3_000 });
    await expect(page.locator(intro)).toHaveCount(0);
    await expect(page.locator(letter)).toBeVisible();
  });

  test("the letter opens a note with a link to Contact, and Escape closes it", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(letter)).toBeVisible({ timeout: 25_000 });
    await page.keyboard.press("Escape");
    await page.locator(letter).click();
    const note = page.locator("#tween-letter-note");
    await expect(note).toBeVisible();
    await expect(page.locator(letter)).toHaveAttribute("aria-expanded", "true");
    await expect(note.locator("a")).toHaveAttribute("href", "/contact");
    await page.keyboard.press("Escape");
    await expect(note).toHaveCount(0);
    await expect(page.locator(letter)).toBeFocused();
  });

  test("plays once per session: a second Home view gets the docked Tween", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(intro)).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(toggle(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(intro)).toHaveCount(0);
  });

  test("never with reduced motion, and never on other pages", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(toggle(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(intro)).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/plans");
    await expect(toggle(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(intro)).toHaveCount(0);
  });
});

test.describe("cover", () => {
  test.beforeEach(async ({ page }) => seenIntro(page));

  test("Tween covers its eyes while an email field has focus", async ({ page }) => {
    await page.goto("/plans");
    await expect(toggle(page)).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => {
      const i = document.createElement("input");
      i.type = "email";
      i.id = "probe-email";
      i.setAttribute("aria-label", "Email");
      document.querySelector("h1")?.after(i);
    });
    await page.locator("#probe-email").focus();
    await expect(root(page)).toHaveAttribute("data-state", "cover");
    await page.locator("#probe-email").blur();
    await expect(root(page)).not.toHaveAttribute("data-state", "cover");
  });
});
