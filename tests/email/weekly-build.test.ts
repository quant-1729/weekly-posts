import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWeeklyEmail, captionLines, type WeeklyEmailPost } from "@/lib/email/weekly";
import { buildLateNotice, buildPausedNotice } from "@/lib/email/notices";
import { verifyLink } from "@/lib/links/tokens";
import { lintEmailHtml } from "./lint";

const BRAND = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;
const NOW = new Date("2026-11-09T08:00:00Z");

const posts: WeeklyEmailPost[] = [
  { id: id(1), suggestedDay: "2026-11-09", channel: "instagram", caption: "Fresh sourdough every morning.\nCome by before 10.\nThird line stays out.", flagCount: 0, hasImage: true },
  { id: id(2), suggestedDay: "2026-11-11", channel: "facebook", caption: "Our Diwali boxes are here & they look <great>.", flagCount: 2, hasImage: true },
  { id: id(3), suggestedDay: "2026-11-13", channel: "gbp", caption: "Open on Saturday.", flagCount: 1, hasImage: true },
  { id: id(4), suggestedDay: "2026-11-15", channel: "linkedin", caption: "Thanks for a good week.", flagCount: 0, hasImage: false },
];

const build = (o: Partial<Parameters<typeof buildWeeklyEmail>[0]> = {}) =>
  buildWeeklyEmail({
    brand: { id: BRAND, name: "Corner Bakery" },
    batch: { id: id(99), weekStart: "2026-11-09" },
    posts,
    lastWeekStart: "2026-11-02",
    variant: "normal",
    now: NOW,
    ...o,
  });

const hrefs = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
const tokenOf = (url: string) => /\/(?:e|i)\/([\w.-]+)$/.exec(url)![1];
const claimsOf = (url: string) => verifyLink(tokenOf(url), { now: NOW });

afterEach(() => vi.unstubAllEnvs());

describe("buildWeeklyEmail (Req 14, 20, 24)", () => {
  it("has the subject, a preheader and a one-line intro", async () => {
    const m = await build();
    expect(m.subject).toBe("Your 4 posts for the week of 9 Nov are ready");
    expect(m.html).toContain("Approve, edit or skip each one with a tap");
    expect(m.html).toContain("Here are your posts for the week of 9 Nov.");
    expect(m.html).toContain("Posts for Corner Bakery");
  });

  it("shows every post: day and channel, the first two lines of the caption, an image", async () => {
    const m = await build();
    for (const h of ["Monday · Instagram", "Wednesday · Facebook", "Friday · Google Business Profile", "Sunday · LinkedIn"]) {
      expect(m.html).toContain(h);
      expect(m.text).toContain(h);
    }
    expect(m.html).toContain("Fresh sourdough every morning.");
    expect(m.html).toContain("Come by before 10.");
    expect(m.html).not.toContain("Third line stays out.");
    expect(m.text).not.toContain("Third line stays out.");
    // text is escaped in HTML
    expect(m.html).toContain("Our Diwali boxes are here &amp; they look &lt;great&gt;.");
    expect(m.html).not.toContain("<great>");
    expect(m.html.match(/<img /g)).toHaveLength(3); // the fourth has no image
    expect(m.html).toMatch(/alt="Image for your Instagram post on Monday"/);
  });

  it("has three distinct tokens per post: Approve, Edit and Skip, each for its own post", async () => {
    const m = await build();
    const links = hrefs(m.html);
    const all = new Set<string>();
    for (const p of posts) {
      const found: Record<string, string> = {};
      for (const url of links.filter((u) => u.includes("/e/"))) {
        const c = await claimsOf(url);
        if (c?.postId === p.id) found[c.act] = url;
      }
      expect(Object.keys(found).sort()).toEqual(["approve", "edit", "skip"]);
      expect(new Set(Object.values(found)).size).toBe(3);
      for (const u of Object.values(found)) {
        all.add(u);
        const c = (await claimsOf(u))!;
        expect(c.brandId).toBe(BRAND);
        expect(c.weekStart).toBe("2026-11-09");
        expect(c.exp - c.iat).toBe(14 * 24 * 3600);
      }
    }
    expect(all.size).toBe(12);
    expect(m.html).toContain(">Approve<");
    expect(m.html).toContain(">Edit<");
    expect(m.html).toContain(">Skip<");
  });

  it("notes the open flags per post", async () => {
    const m = await build();
    expect(m.html).toContain("Please check: 2 things");
    expect(m.html).toContain("Please check: 1 thing<");
    expect(m.text).toContain("Please check: 2 things");
    expect(m.html.match(/Please check:/g)).toHaveLength(2);
  });

  it("links to the whole week", async () => {
    const m = await build();
    const view = (await Promise.all(hrefs(m.html).filter((u) => u.includes("/e/")).map(async (u) => ({ u, c: await claimsOf(u) })))).find((x) => x.c?.act === "view_week");
    expect(view?.c).toMatchObject({ brandId: BRAND, weekStart: "2026-11-09" });
    expect(m.html).toContain(">See all posts<");
  });

  it("has the one-tap check-in for last week: None, A few, Many", async () => {
    const m = await build();
    expect(m.html).toContain("Did last week&#39;s posts bring enquiries?");
    const answers: string[] = [];
    for (const u of hrefs(m.html).filter((x) => x.includes("/e/"))) {
      const c = await claimsOf(u);
      if (c?.act === "checkin") {
        expect(c.weekStart).toBe("2026-11-02");
        answers.push(String(c.extra.answer));
        expect(c.postId).toBeUndefined();
      }
    }
    expect(answers.sort()).toEqual(["few", "many", "none"]);
    for (const label of ["None", "A few", "Many"]) expect(m.html).toContain(`>${label}<`);
    expect(m.text).toContain("Did last week's posts bring enquiries?");
  });

  it("leaves the check-in out when there is no previous email", async () => {
    const m = await build({ lastWeekStart: null });
    expect(m.html).not.toContain("bring enquiries");
    expect(m.text).not.toContain("bring enquiries");
  });

  it("has a footer with Pause for 2 weeks, Unsubscribe and why they get the email", async () => {
    const m = await build();
    expect(m.html).toContain("You get this email because you use Weekly Posts to plan posts for Corner Bakery.");
    const acts = new Set<string>();
    for (const u of hrefs(m.html).filter((x) => x.includes("/e/"))) acts.add((await claimsOf(u))!.act);
    expect(acts).toContain("pause");
    expect(acts).toContain("unsubscribe");
    expect(m.html).toContain(">Pause for 2 weeks<");
    expect(m.html).toContain(">Unsubscribe<");
  });

  it("carries RFC 8058 List-Unsubscribe headers, with mailto only when there is a reply-to", async () => {
    vi.stubEnv("EMAIL_REPLY_TO", "");
    const m = await build();
    const lu = m.headers["List-Unsubscribe"];
    expect(lu).toMatch(/^<http:\/\/localhost:3000\/api\/email\/unsubscribe\?t=[\w.-]+>$/);
    expect(m.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const token = /\?t=([\w.-]+)>/.exec(lu)![1];
    expect(await verifyLink(token, { act: "unsubscribe", now: NOW })).toMatchObject({ brandId: BRAND });

    vi.stubEnv("EMAIL_REPLY_TO", "Weekly Posts <hello@example.com>");
    const withMailto = (await build()).headers["List-Unsubscribe"];
    expect(withMailto).toContain(", <mailto:hello@example.com?subject=unsubscribe>");
  });

  it("has a plain-text part with the same content and every link", async () => {
    const m = await build();
    for (const url of hrefs(m.html)) expect(m.text).toContain(url);
    // and nothing in the text that is not in the email's links, other than text
    const textUrls = m.text.match(/https?:\/\/\S+/g) ?? [];
    expect(new Set(textUrls)).toEqual(new Set(hrefs(m.html)));
    expect(m.text).toContain("Approve: ");
    expect(m.text).toContain("Unsubscribe: ");
    expect(m.text).not.toMatch(/<(p|td|table|a) /);
  });

  it("images are served from /i/ tokens for the right post", async () => {
    const m = await build();
    const srcs = [...m.html.matchAll(/<img [^>]*src="([^"]+)"/g)].map((x) => x[1]);
    expect(srcs).toHaveLength(3);
    for (const [i, src] of srcs.entries()) {
      expect(src).toMatch(/^http:\/\/localhost:3000\/i\/[\w.-]+$/);
      expect(await claimsOf(src)).toMatchObject({ act: "img", postId: posts[i].id, brandId: BRAND, extra: { format: "square" } });
    }
  });

  it("says sorry when the email is late", async () => {
    const m = await build({ batch: { id: id(99), weekStart: "2026-11-09", late: true } });
    expect(m.html).toContain("Sorry these are late.");
    expect(m.text).toContain("Sorry these are late.");
    expect((await build()).html).not.toContain("Sorry these are late.");
  });

  it("short variant: 3 posts, one big See and approve button, no per-post buttons", async () => {
    const m = await build({ variant: "short" });
    expect(m.subject).toBe("3 posts ready — 1 tap");
    expect(m.html.match(/<img /g)).toHaveLength(3);
    expect(m.html).toContain("Fresh sourdough every morning.");
    expect(m.html).not.toContain("Thanks for a good week.");
    expect(m.html).toContain(">See and approve<");
    expect(m.html).not.toContain(">Approve<");
    expect(m.html).not.toContain(">Skip<");
    expect(m.html).not.toContain("bring enquiries");
    const acts: string[] = [];
    for (const u of hrefs(m.html).filter((x) => x.includes("/e/"))) acts.push((await claimsOf(u))!.act);
    expect(acts.sort()).toEqual(["pause", "unsubscribe", "view_week"]);
    expect(m.text).toContain("See and approve: ");
    expect(m.headers["List-Unsubscribe"]).toBeTruthy();
    for (const url of hrefs(m.html)) expect(m.text).toContain(url);
  });

  it("cuts a very long caption line", () => {
    const lines = captionLines(`${"x".repeat(500)}\n\n  second  \nthird`);
    expect(lines).toHaveLength(2);
    expect(lines[0].length).toBeLessThanOrEqual(220);
    expect(lines[0].endsWith("…")).toBe(true);
    expect(lines[1]).toBe("second");
  });

  it("throws in production when the app URL is not set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "z".repeat(40));
    vi.stubEnv("EMAIL_LINK_SECRET", "k".repeat(40));
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    await expect(build()).rejects.toThrow(/NEXT_PUBLIC_APP_URL/);
  });
});

describe("AC 14: email HTML follows the Gmail and Outlook safe rules", () => {
  it("normal, short, late, no-image and no-check-in emails all lint clean", async () => {
    const variants = [
      await build(),
      await build({ variant: "short" }),
      await build({ batch: { id: id(99), weekStart: "2026-11-09", late: true } }),
      await build({ lastWeekStart: null, posts: posts.map((p) => ({ ...p, hasImage: false })) }),
      await build({ posts: [] }),
    ];
    for (const m of variants) expect(lintEmailHtml(m.html)).toEqual([]);
  });

  it("the late and paused notices lint clean too, and carry the unsubscribe headers", async () => {
    for (const m of [await buildLateNotice({ brand: { id: BRAND, name: "Corner Bakery" }, now: NOW }), await buildPausedNotice({ brand: { id: BRAND, name: "Corner Bakery" }, now: NOW })]) {
      expect(lintEmailHtml(m.html)).toEqual([]);
      expect(m.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      for (const url of hrefs(m.html)) expect(m.text).toContain(url);
    }
  });

  it("the lint catches what it should", () => {
    const good = "<!doctype html>";
    expect(lintEmailHtml(`${good}<style>p{}</style><div style="display:flex"><img src="/x.png"><form></form>`).length).toBeGreaterThan(5);
    expect(
      lintEmailHtml('<!doctype html><meta charset="utf-8"><title>t</title><p style="color:#ffffff;font-family:Arial">x</p>').join("\n"),
    ).toContain("white text without a background colour");
  });
});

describe("notices", () => {
  it("late notice says what will happen", async () => {
    const m = await buildLateNotice({ brand: { id: BRAND, name: "Corner Bakery" }, now: NOW });
    expect(m.subject).toBe("This week's posts are running late");
    expect(m.text).toContain("This week's posts are running late because our writing service had trouble.");
    expect(m.text).toContain("Open my dashboard: ");
    expect(m.html).toContain("/week");
  });

  it("paused notice has a resume button that is a resume token", async () => {
    const m = await buildPausedNotice({ brand: { id: BRAND, name: "Corner Bakery" }, now: NOW });
    expect(m.subject).toBe("We've paused your weekly posts");
    expect(m.text).toContain("We've paused your weekly posts. Want them back?");
    const acts: string[] = [];
    for (const u of hrefs(m.html).filter((x) => x.includes("/e/"))) acts.push((await claimsOf(u))!.act);
    expect(acts).toContain("resume");
    expect(m.html).toContain(">Yes, send them again<");
  });
});
