import { expect, test } from "@playwright/test";
import { chip, openTween, panel, pick, seenIntro } from "./mascot-helpers";

test.beforeEach(async ({ page }) => seenIntro(page));

/** E3: with priceDisplay "from" Tween shows exactly the numbers in plans.json and no others. */
const EXPECTED = new Set(["$1,234", "$2,345", "$3,456", "$4,567"]);

test("What does it cost? shows exactly the configured prices", async ({ page }) => {
  await page.goto("/");
  await openTween(page);
  await expect(chip(page, "cost")).toBeVisible({ timeout: 25_000 });
  await pick(page, "cost", "plan");
  await expect(page).toHaveURL(/\/plans$/);
  const t = await panel(page).innerText();
  const found = new Set(Array.from(t.matchAll(/\$[0-9][0-9,]*/g)).map((m) => m[0]));
  expect(found).toEqual(EXPECTED);
  expect(t).toContain("Pilot from $1,234");
  expect(t).toContain("From $2,345 a month");
  expect(t).not.toMatch(/most popular/i);
  // the same figures are on the page Tween points at
  const onPage = await page.locator("main").innerText();
  for (const p of EXPECTED) expect(onPage).toContain(p);
});
