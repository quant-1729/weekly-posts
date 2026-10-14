import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { events, eventsNamed } from "./helpers";
import { chip, openTween, panel, pick, root, toggle, seenIntro } from "./mascot-helpers";

test.beforeEach(async ({ page }) => seenIntro(page));

/** Mascot gates that need the preview build: the seven entry points, honest work answers, and the chat lead flow against the real file store. */

const leadsFile = path.resolve(".data-e2e", "leads.jsonl");
const leadCount = () => (fs.existsSync(leadsFile) ? fs.readFileSync(leadsFile, "utf8").trim().split("\n").filter(Boolean).length : 0);
const lastLead = () => JSON.parse(fs.readFileSync(leadsFile, "utf8").trim().split("\n").pop()!) as Record<string, unknown>;
const text = (page: Page) => panel(page).innerText();

async function start(page: Page, route = "/") {
  await page.goto(route);
  await openTween(page);
  await expect(chip(page, "more")).toBeVisible({ timeout: 25_000 });
}

test.describe("E2: each entry point lands somewhere correct and true", () => {
  test("What does a pilot involve? goes to How it works and points at the steps", async ({ page }) => {
    await start(page);
    await pick(page, "pilot", "pilot-plans");
    await expect(page).toHaveURL(/\/how-it-works$/);
    await expect(page.locator('[data-tween="spotlight"]')).toHaveAttribute("data-target", "steps");
    await expect(page.locator('[data-tween-target="steps"]')).toBeVisible();
    expect(await text(page)).toContain("fixed-price");
    await pick(page, "pilot-plans", "cost");
    await expect(page).toHaveURL(/\/plans$/);
    await expect(page.locator('[data-tween="spotlight"]')).toHaveAttribute("data-target", "pilot");
  });

  test("Show me work points at the placeholder slots and says plainly that nothing is published", async ({ page }) => {
    await start(page);
    await pick(page, "work", "plan");
    await expect(page.locator('[data-tween="spotlight"]')).toHaveAttribute("data-target", "work");
    await expect(page.locator("[data-work-slot]").first()).toBeVisible();
    const t = await text(page);
    expect(t).toMatch(/No real work is published yet/);
    expect(t).toMatch(/placeholders for pieces we plan to make/);
    await expect(page.locator("dialog[data-lightbox][open]")).toHaveCount(0);
  });

  test("What does it cost? with hidden prices shows no number and points at Plans", async ({ page }) => {
    await start(page);
    await pick(page, "cost", "plan");
    await expect(page).toHaveURL(/\/plans$/);
    const t = await text(page);
    expect(t).toMatch(/scoped per pilot/);
    expect(t).not.toMatch(/[$0-9]/);
    await expect(page.locator('[data-tween="spotlight"]')).toHaveAttribute("data-target", "pilot");
  });

  test("an agency and a startup are routed to their pages", async ({ page }) => {
    await start(page);
    await pick(page, "more", "who");
    await pick(page, "who", "agency");
    await pick(page, "agency", "plan");
    await expect(page).toHaveURL(/\/for\/agencies$/);
    await expect(page.locator('[data-tween="spotlight"]')).toHaveAttribute("data-target", "how-white-label-works");
    await page.locator('[data-tween="settings-toggle"]').click();
    await page.locator('[data-tween="restart"]').click();
    await expect(chip(page, "more")).toBeVisible({ timeout: 25_000 });
    await pick(page, "more", "who");
    await pick(page, "who", "startup");
    await pick(page, "startup", "plan");
    await expect(page).toHaveURL(/\/for\/startups$/);
    await expect(page.locator('[data-tween="spotlight"]')).toHaveAttribute("data-target", "pilot");
  });

  test("Plan a pilot starts the chat lead flow", async ({ page }) => {
    await start(page);
    await pick(page, "more", "plan");
    await pick(page, "plan");
    await expect(page.locator('[data-tween="lead-input"]')).toBeVisible({ timeout: 25_000 });
    await expect(page.locator('[data-tween="open-form"]')).toBeVisible();
  });

  test("Just browsing: a short line, then quiet afterwards", async ({ page }) => {
    await page.clock.install();
    await start(page);
    await pick(page, "more", "browse");
    await pick(page, "browse", "root");
    expect(await text(page)).toMatch(/I will stay quiet/);
    await page.keyboard.press("Escape");
    await page.goto("/plans");
    await toggle(page).waitFor({ timeout: 20_000 });
    await page.clock.fastForward(120_000);
    await expect(page.locator('[data-tween="greeting"]')).toHaveCount(0);
  });
});

test.describe("lead flow", () => {
  async function toLead(page: Page, route = "/") {
    await start(page, route);
    await pick(page, "more", "plan");
    await pick(page, "plan");
    await expect(page.locator('[data-tween="lead-input"]')).toBeVisible({ timeout: 25_000 });
  }
  const input = (page: Page) => page.locator('[data-tween="lead-input"]');
  async function answerAll(page: Page) {
    await page.waitForTimeout(3100); // clear of the form's time-trap, as a person would be
    await input(page).fill("Sam Tester");
    await page.locator('[data-tween="lead-next"]').click();
    await input(page).fill("sam@fixture.test");
    await page.locator('[data-tween="lead-next"]').click();
    await input(page).fill("fixture.test");
    await page.locator('[data-tween="lead-next"]').click();
    await chip(page, "Product explainer").click();
    await chip(page, "Marketing, growth or content").click();
  }

  test("F1/F5: a complete conversation is accepted by the real endpoint and stored with the form's fields", async ({ page }) => {
    const before = leadCount();
    await toLead(page);
    await answerAll(page);
    await page.locator('[data-tween="lead-consent"]').check();
    await page.locator('[data-tween="lead-send"]').click();
    await expect(page.locator('[data-tween="lead-done"]')).toContainText("Thanks, Sam");
    expect(leadCount()).toBe(before + 1);
    const rec = lastLead();
    expect(rec).toMatchObject({ name: "Sam Tester", email: "sam@fixture.test", make: ["Product explainer"], role: "Marketing, growth or content" });
    expect(String(rec.website)).toContain("fixture.test");
    // F5: events fire once each, under the names added to lib/tracking.ts
    expect((await eventsNamed(page, "tween_lead_start")).length).toBe(1);
    expect((await eventsNamed(page, "tween_lead_submit")).length).toBe(1);
    const submits = (await eventsNamed(page, "form_submit")).filter((e) => e.props.source === "tween");
    expect(submits.length).toBe(1);
    expect(JSON.stringify(await events(page))).not.toContain("sam@fixture.test");
    // F4: nothing personal is left in storage
    const stored = await page.evaluate(() => JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage }));
    expect(stored).not.toContain("Sam");
    expect(stored).not.toContain("fixture.test");
  });

  test("F2: bad answers are rejected with the form's exact copy", async ({ page }) => {
    await toLead(page);
    await page.locator('[data-tween="lead-next"]').click();
    await expect(page.getByRole("alert").filter({ hasText: "Enter your name." })).toBeVisible();
    await input(page).fill("Sam");
    await page.locator('[data-tween="lead-next"]').click();
    await input(page).fill("not-an-email");
    await page.locator('[data-tween="lead-next"]').click();
    await expect(page.getByRole("alert").filter({ hasText: "Enter a work email, like name@company.com." })).toBeVisible();
    await input(page).fill("sam@fixture.test");
    await page.locator('[data-tween="lead-next"]').click();
    await page.locator('[data-tween="lead-next"]').click();
    await expect(page.getByRole("alert").filter({ hasText: "Enter your company website." })).toBeVisible();
    await input(page).fill("fixture.test");
    await page.locator('[data-tween="lead-next"]').click();
    await chip(page, "Not sure yet").click();
    await chip(page, "Other").click();
    const before = leadCount();
    await page.locator('[data-tween="lead-send"]').click();
    await expect(page.getByRole("alert").filter({ hasText: "Please agree so we can reply to you." })).toBeVisible();
    expect(leadCount()).toBe(before);
  });

  test("F3: a filled honeypot gets the generic success and no record", async ({ page }) => {
    await toLead(page);
    await answerAll(page);
    await page.locator('[data-tween="lead-consent"]').check();
    await page.locator('[data-tween="hp"]').evaluate((el: HTMLInputElement) => {
      el.value = "I am a bot";
    });
    const before = leadCount();
    await page.locator('[data-tween="lead-send"]').click();
    await expect(page.locator('[data-tween="lead-done"]')).toBeVisible();
    expect(leadCount()).toBe(before);
  });

  test("F4: Open the full form carries the answers over and leaves nothing in storage", async ({ page }) => {
    await toLead(page);
    await input(page).fill("Sam Tester");
    await page.locator('[data-tween="lead-next"]').click();
    await input(page).fill("sam@fixture.test");
    await page.locator('[data-tween="lead-next"]').click();
    await input(page).fill("fixture.test");
    await page.locator('[data-tween="lead-next"]').click();
    await chip(page, "Social cutdowns").click();
    await page.locator('[data-tween="open-form"]').click();
    await expect(page).toHaveURL(/\/contact$/);
    const form = page.locator("form[data-lead-form]");
    await expect(form.locator('input[name="name"]')).toHaveValue("Sam Tester");
    await expect(form.locator('input[name="email"]')).toHaveValue("sam@fixture.test");
    await expect(form.locator('input[name="website"]')).toHaveValue("fixture.test");
    await expect(form.getByLabel("Social cutdowns")).toBeChecked();
    await expect(form.locator('input[name="consent"]')).not.toBeChecked();
    const stored = await page.evaluate(() => JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain("sam@fixture.test");
    expect(stored).not.toContain("tween-prefill");
  });

  test("F6: a server error shows the form's error copy and the fallback email, and the flow can retry", async ({ page }) => {
    let failures = 1;
    await page.route("**/api/lead", (route) => {
      if (failures-- > 0) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, errors: { form: "We could not send that. Please try again or write to hello@tweencrew.com." } }) });
      return route.continue();
    });
    await toLead(page);
    await answerAll(page);
    await page.locator('[data-tween="lead-consent"]').check();
    await page.locator('[data-tween="lead-send"]').click();
    const failed = page.locator('[data-tween="lead-failed"]');
    await expect(failed).toContainText("We could not send that");
    await expect(failed).toContainText("Prefer email?");
    await expect(failed).toContainText("@");
    await failed.getByRole("button").click();
    await page.locator('[data-tween="lead-consent"]').check();
    await page.locator('[data-tween="lead-send"]').click();
    await expect(page.locator('[data-tween="lead-done"]')).toBeVisible();
  });

  test("the lead flow is keyboard operable", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop keyboard check");
    await toLead(page);
    await expect(input(page)).toBeFocused();
    await page.keyboard.type("Sam Tester");
    await page.keyboard.press("Enter");
    await expect(input(page)).toHaveValue("");
    await expect(input(page)).toBeFocused();
  });
});

test("Tween's toggle has an accessible name and state", async ({ page }) => {
  await page.goto("/");
  await toggle(page).waitFor({ timeout: 20_000 });
  await expect(toggle(page)).toHaveAttribute("aria-label", "Open Tween, the Tweencrew mascot");
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(root(page)).toHaveCount(1);
});
