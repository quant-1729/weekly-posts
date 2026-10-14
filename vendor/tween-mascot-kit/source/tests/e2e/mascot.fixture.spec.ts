import { expect, test } from "@playwright/test";
import { chip, openTween, panel, pick, toggle, seenIntro } from "./mascot-helpers";

test.beforeEach(async ({ page }) => seenIntro(page));

/** On the production-mode fixture build (:3200): real published work exists, prices are hidden, the developer hook is absent. */

test("E4: Show me work opens a real published item in the lightbox", async ({ page }) => {
  await page.goto("/");
  await openTween(page);
  await expect(chip(page, "work")).toBeVisible({ timeout: 25_000 });
  await pick(page, "work");
  await expect(page).toHaveURL(/\/work$/);
  await expect(page.locator("dialog[data-lightbox]")).toHaveAttribute("open", "", { timeout: 15_000 });
  // Tween steps aside while the lightbox is open
  await expect(page.locator('[data-tween="root"]')).toHaveAttribute("data-blocked", "true");
  await page.locator("[data-lightbox-close]").click();
  await expect(page.locator('[data-tween="root"]')).toHaveAttribute("data-blocked", "false");
  await expect(chip(page, "plan")).toBeVisible({ timeout: 15_000 });
  expect(await panel(page).innerText()).toMatch(/published piece/);
});

test("E3: hidden prices show no number on the fixture either", async ({ page }) => {
  await page.goto("/");
  await openTween(page);
  await expect(chip(page, "cost")).toBeVisible({ timeout: 25_000 });
  await pick(page, "cost", "plan");
  const t = await panel(page).innerText();
  expect(t).toMatch(/scoped per pilot/);
  expect(t).not.toMatch(/[$0-9]/);
});

test("the production build has no developer hook and no placeholder tags in Tween", async ({ page }) => {
  await page.goto("/?tween=celebrate");
  await toggle(page).waitFor({ timeout: 20_000 });
  await expect(page.locator('[data-tween="root"]')).toHaveAttribute("data-state", "idle");
  await toggle(page).click();
  await expect(chip(page, "more")).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('[data-tween="panel"] .placeholder-tag')).toHaveCount(0);
});
