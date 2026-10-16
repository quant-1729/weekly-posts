import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => session.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }),
  usePathname: () => "/ideas",
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
const runSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ideas/run", () => ({ runResearch: runSpy }));

import { dismissCardAction, dismissIdeaAction, makeIdeaPostAction, researchNowAction } from "@/app/(app)/ideas/actions";
import IdeasPage from "@/app/(app)/ideas/page";
import { getBrief } from "@/lib/briefs/service";
import type { MockDb } from "@/lib/db/mock";
import { saveResearchSettings } from "@/lib/ideas/competitors";
import { loadIdeasView } from "@/lib/ideas/view";
import { NOW, closeDb, makeShop, openDb, rows, type Shop } from "./helpers";
import { seedCard, seedCards, seedIdea, seedRun } from "./seed";

let db: MockDb;
beforeAll(async () => {
  db = await openDb();
});
afterAll(async () => {
  await closeDb(db);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  runSpy.mockReset();
});

const atNow = () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
};
const render = async (shop: Shop, e?: string) => {
  session.user = { id: shop.userId };
  atNow();
  return renderToString(await IdeasPage({ searchParams: Promise.resolve({ e }) }));
};
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const redirectOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    const m = /^REDIRECT (.*)$/.exec((e as Error).message);
    if (m) return m[1];
    throw e;
  }
  return null;
};
const count = async (table: string, brandId: string) => (await rows<{ n: number }>(db, `select count(*)::int as n from public.${table} where brand_id = $1`, [brandId]))[0].n;
const statusOf = async (table: string, id: string) => (await rows<{ status: string }>(db, `select status from public.${table} where id = $1`, [id]))[0].status;

describe("the Ideas page: access and empty states", () => {
  it("sends a signed-out visitor to sign in and an unfinished setup to /setup", async () => {
    session.user = null;
    await expect(IdeasPage({})).rejects.toThrow("REDIRECT /login");
    const shop = await makeShop(db);
    await rows(db, "update public.brand_memory set setup_completed_at = null where brand_id = $1", [shop.brandId]);
    session.user = { id: shop.userId };
    await expect(IdeasPage({})).rejects.toThrow("REDIRECT /setup");
  });

  it("before any research: one line, an enabled Research now with the runs left and the cost note, and what it does", async () => {
    const shop = await makeShop(db);
    const html = await render(shop);
    expect(html).toContain("Not researched yet.");
    expect(html).toMatch(/<button[^>]*>Research now<\/button>/);
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>Research now/);
    expect(html).toContain("2 of 2 runs left this week");
    expect(html).toMatch(/A run uses about \$0\.\d\d of AI/);
    expect(html).toContain("We look at what is trending for businesses like yours");
    expect(html).not.toContain("data-trend-card");
  });

  it("with research off: Research now is disabled with the reason and the page links to Brand", async () => {
    const shop = await makeShop(db);
    await saveResearchSettings(shop.userId, shop.brandId, { focus: null, on: false });
    const html = await render(shop);
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Research now<\/button>/);
    expect(html).toContain("Weekly research is switched off.");
    expect(html).toContain('href="/brand#competitors"');
    expect(html).toContain("Turn it on in Brand");
  });

  it("disabled with the reason when there is no profile, the manual limit is reached, or the research budget is spent", async () => {
    const noProfile = await makeShop(db);
    await rows(db, "update public.brand_memory set category = null where brand_id = $1", [noProfile.brandId]);
    expect(await render(noProfile)).toContain("Add what your business does on the Brand page first.");
    expect((await loadIdeasView(noProfile.userId, noProfile.brandId, NOW)).disabled).toBe("no_profile");

    const limit = await makeShop(db);
    await seedRun(db, limit.brandId, { trigger: "manual", status: "done", startedAt: new Date(NOW.getTime() - 3_600_000), costUsd: 0.1 });
    await seedRun(db, limit.brandId, { trigger: "manual", status: "failed", startedAt: new Date(NOW.getTime() - 7_200_000), costUsd: 0.1 });
    // A capped attempt does not use up a run.
    await seedRun(db, limit.brandId, { trigger: "manual", status: "capped", startedAt: new Date(NOW.getTime() - 1_800_000), costUsd: 0 });
    const limitHtml = await render(limit);
    expect(limitHtml).toMatch(/<button[^>]*\sdisabled=""[^>]*>Research now<\/button>/);
    expect(limitHtml).toContain("You have used all 2 runs this week.");
    expect((await loadIdeasView(limit.userId, limit.brandId, NOW)).runsLeft).toBe(0);

    const capped = await makeShop(db);
    await rows(db, "insert into public.usage_events (brand_id, kind, usd, created_at) values ($1, 'research', 0.49, $2)", [capped.brandId, NOW.toISOString()]);
    expect((await loadIdeasView(capped.userId, capped.brandId, NOW)).disabled).toBe("research_cap");
    expect(await render(capped)).toContain("research budget is used up");
  });

  it("when the last run found nothing, and when every card was dismissed, it says so", async () => {
    const none = await makeShop(db);
    await seedRun(db, none.brandId, { status: "done" });
    const html = await render(none);
    expect(html).toContain("The last research found nothing new to suggest.");
    expect(html).toContain("Last researched today.");

    const dismissed = await makeShop(db);
    const runId = await seedRun(db, dismissed.brandId, { startedAt: new Date(NOW.getTime() - 86_400_000) });
    await seedCard(db, dismissed.brandId, runId, { status: "dismissed" });
    const dHtml = await render(dismissed);
    expect(dHtml).toContain("You have dealt with all the ideas.");
    expect(dHtml).toContain("Last researched yesterday.");
    expect(dHtml).not.toContain("data-trend-card");
  });
});

describe("the Ideas page: trend cards", () => {
  it("shows a card with confidence, sources, freshness, why it matters, source links, flags and the actions", async () => {
    const shop = await makeShop(db);
    const runId = await seedRun(db, shop.brandId);
    const cardId = await seedCard(db, shop.brandId, runId, {
      title: "Pumpkin loaves are trending",
      confidence: "high",
      sources: [
        { url: "https://news.example.com/pumpkin", title: "Pumpkin loaves", site: "news.example.com", published_at: "2026-10-12" },
        { url: "https://blog.example.org/bakes?a=1&b=2", title: "Bakes", site: "blog.example.org", published_at: "2026-10-09" },
        { url: "javascript:alert(1)", title: "Bad", site: "evil", published_at: "2026-10-09" },
      ],
    });
    await seedIdea(db, shop.brandId, cardId, {
      postType: "new_product",
      angle: "Meet the pumpkin loaf",
      description: "Introduce our pumpkin loaf and invite people to taste it",
      format: "carousel",
      flags: ["from research, please check: no prices, dates or claims were added"],
    });
    const html = await render(shop);
    expect(html).toContain("Pumpkin loaves are trending");
    expect(html).toContain("High confidence");
    expect(html).toContain("2 sources"); // the javascript: link is not a source
    expect(html).toContain("this week");
    expect(html).toContain("Why it matters");
    expect(html).toContain("It fits what you sell.");
    // Sources: site, date, new tab, safe rel.
    expect(html).toContain('href="https://news.example.com/pumpkin"');
    expect(html).toContain("news.example.com · 12 Oct");
    expect(html).toContain("blog.example.org · 9 Oct");
    expect(html).not.toContain('href="javascript:');
    for (const a of html.match(/<a [^>]*target="_blank"[^>]*>/g) ?? []) expect(a).toContain('rel="noopener noreferrer nofollow"');
    expect((html.match(/target="_blank"/g) ?? []).length).toBe(2);
    // The idea: chips, description, flag, actions.
    expect(html).toContain("New product or service");
    expect(html).toContain("Carousel");
    expect(html).toContain("Meet the pumpkin loaf");
    expect(html).toContain("Introduce our pumpkin loaf and invite people to taste it");
    expect(html).toContain("from research, please check");
    expect(html).toContain("Make this post");
    expect(html).toContain("Not for me");
    expect(html).toContain("Dismiss this trend");
    expect(html).toContain(`name="cardId" value="${cardId}"`);
  });

  it("shows at most 5 live cards, newest first, from the latest finished run only, and none dismissed, expired or another business's", async () => {
    const shop = await makeShop(db);
    const other = await makeShop(db);
    await seedCards(db, shop.brandId, 7, { startedAt: new Date(NOW.getTime() - 5 * 86_400_000) });
    const runId = await seedRun(db, shop.brandId, { startedAt: new Date(NOW.getTime() - 86_400_000) });
    await seedCard(db, shop.brandId, runId, { title: "Older card", createdAt: new Date(NOW.getTime() - 86_400_000 - 3_600_000) });
    await seedCard(db, shop.brandId, runId, { title: "Newest card", createdAt: new Date(NOW.getTime() - 86_400_000) });
    await seedCard(db, shop.brandId, runId, { title: "Dismissed card", status: "dismissed" });
    await seedCard(db, shop.brandId, runId, { title: "Expired card", expiresAt: new Date(NOW.getTime() - 1000) });
    await seedCards(db, other.brandId, 2);
    const html = await render(shop);
    expect((html.match(/data-trend-card/g) ?? []).length).toBe(2); // only the latest run's two live cards
    expect(html.indexOf("Newest card")).toBeGreaterThan(-1);
    expect(html.indexOf("Newest card")).toBeLessThan(html.indexOf("Older card"));
    for (const hidden of ["Dismissed card", "Expired card", "Trend 1"]) expect(html).not.toContain(hidden);

    const many = await makeShop(db);
    const runMany = await seedRun(db, many.brandId, { startedAt: new Date(NOW.getTime() - 3_600_000) });
    for (let i = 0; i < 7; i++) await seedCard(db, many.brandId, runMany, { title: `Card ${i}`, createdAt: new Date(NOW.getTime() - i * 60_000) });
    const manyHtml = await render(many);
    expect((manyHtml.match(/data-trend-card/g) ?? []).length).toBe(5);
    expect(manyHtml.indexOf("Card 0")).toBeLessThan(manyHtml.indexOf("Card 1"));
    expect(manyHtml).not.toContain("Card 5");
  });

  it("an idea already used shows its state instead of the two buttons; a dismissed idea is hidden", async () => {
    const shop = await makeShop(db);
    const runId = await seedRun(db, shop.brandId);
    const cardId = await seedCard(db, shop.brandId, runId);
    await seedIdea(db, shop.brandId, cardId, { status: "used" });
    await seedIdea(db, shop.brandId, cardId, { status: "dismissed", angle: "Hidden angle" });
    const html = await render(shop);
    expect(html).toContain("Post started");
    expect(html).not.toContain("Not for me");
    expect(html).not.toContain("Hidden angle");
  });

  it("is one column and wraps long text, so a phone has no horizontal scroll", async () => {
    const shop = await makeShop(db);
    await seedCards(db, shop.brandId, 1);
    const html = await render(shop);
    expect(html).not.toMatch(/\bgrid-cols-[2-9]\b/);
    expect(html).toContain("break-words");
    expect(html).not.toMatch(/min-w-max|w-\[\d{3,}px\]/);
  });
});

describe("competitors on the Ideas page", () => {
  it("is hidden when Business Discovery is off and nothing was saved", async () => {
    const shop = await makeShop(db);
    await seedCards(db, shop.brandId, 1);
    expect(await render(shop)).not.toContain("data-competitors");
  });

  it("with Business Discovery on and no competitors, hints to add them on the Brand page", async () => {
    vi.stubEnv("IDEAS_BUSINESS_DISCOVERY", "on");
    const shop = await makeShop(db);
    const html = await render(shop);
    expect(html).toContain("data-competitors");
    expect(html).toContain("Add competitors on the Brand page");
    expect(html).toContain('href="/brand#competitors"');
  });

  it("lists what each competitor posted lately, with the best post link, even with the switch off", async () => {
    const shop = await makeShop(db);
    const [c] = await rows<{ id: string }>(db, "insert into public.competitors (brand_id, name) values ($1, 'Rival Bakes') returning id::text as id", [shop.brandId]);
    await rows(db, "insert into public.competitor_snapshots (brand_id, competitor_id, taken_at, followers, media_count, recent) values ($1, $2, $3, 100, 10, $4::jsonb)", [
      shop.brandId,
      c.id,
      NOW.toISOString(),
      JSON.stringify([
        { permalink: "https://www.instagram.com/p/AAA/", posted_at: "2026-10-12T09:00:00Z", format: "video", likes: 120, comments: 8 },
        { permalink: "https://www.instagram.com/p/BBB/", posted_at: "2026-10-10T09:00:00Z", format: "photo", likes: 30, comments: 2 },
        { permalink: "javascript:alert(1)", posted_at: "2026-10-09T09:00:00Z", format: "photo", likes: 999, comments: 999 },
      ]),
    ]);
    const html = await render(shop);
    expect(html).toContain("Rival Bakes");
    expect(html).toContain("Video, 120 likes, 8 comments");
    expect(html).toContain("Photo, 30 likes, 2 comments");
    expect(html).toContain('href="https://www.instagram.com/p/AAA/"');
    expect(html).not.toContain("999");
    expect(html).not.toContain('href="javascript:');
  });
});

describe("Make this post, Not for me and dismissing a card", () => {
  it("starts a draft brief with the idea's post type and description as notes, marks the idea used and opens the Details step", async () => {
    const shop = await makeShop(db);
    session.user = { id: shop.userId };
    const { items } = await seedCards(db, shop.brandId, 1);
    const ideaId = items[0].ideaId;
    const before = await count("post_briefs", shop.brandId);
    const to = await redirectOf(makeIdeaPostAction(form({ ideaId })));
    expect(to).toMatch(/^\/create\/[0-9a-f-]{36}$/);
    const briefId = to!.split("/")[2];
    expect(await count("post_briefs", shop.brandId)).toBe(before + 1);
    const brief = await getBrief(shop.userId, shop.brandId, briefId);
    expect(brief).toMatchObject({
      postType: "announcement",
      notes: "A post about our autumn bakes, inviting people to come in and try them",
      status: "draft",
      primaryUspId: null,
      cta: null,
      qr: null,
      photoId: null,
    });
    const [idea] = await rows<{ status: string; brief_id: string }>(db, "select status, brief_id::text as brief_id from public.post_ideas where id = $1", [ideaId]);
    expect(idea).toEqual({ status: "used", brief_id: briefId });
    // No post was made and nothing was scheduled.
    expect(await count("posts", shop.brandId)).toBe(0);
    expect(await count("queue_items", shop.brandId)).toBe(0);
  });

  it("pressing it twice opens the same brief and never makes a second one", async () => {
    const shop = await makeShop(db);
    session.user = { id: shop.userId };
    const { items } = await seedCards(db, shop.brandId, 1);
    const first = await redirectOf(makeIdeaPostAction(form({ ideaId: items[0].ideaId })));
    const second = await redirectOf(makeIdeaPostAction(form({ ideaId: items[0].ideaId })));
    expect(second).toBe(first);
    expect(await count("post_briefs", shop.brandId)).toBe(1);
  });

  it("cannot be used on another business's idea, a dismissed idea or a made-up id", async () => {
    const shop = await makeShop(db);
    const other = await makeShop(db);
    const mine = await seedCards(db, shop.brandId, 1);
    const theirs = await seedCards(db, other.brandId, 1);
    session.user = { id: shop.userId };
    expect(await redirectOf(makeIdeaPostAction(form({ ideaId: theirs.items[0].ideaId })))).toBe("/ideas?e=not_found");
    expect(await count("post_briefs", other.brandId)).toBe(0);
    expect(await statusOf("post_ideas", theirs.items[0].ideaId)).toBe("new");
    await rows(db, "update public.post_ideas set status = 'dismissed' where id = $1", [mine.items[0].ideaId]);
    expect(await redirectOf(makeIdeaPostAction(form({ ideaId: mine.items[0].ideaId })))).toBe("/ideas?e=dismissed");
    expect(await redirectOf(makeIdeaPostAction(form({ ideaId: "nope" })))).toBe("/ideas?e=not_found");
  });

  it("Not for me hides the idea and leaves the other ideas and other businesses alone", async () => {
    const shop = await makeShop(db);
    const other = await makeShop(db);
    const runId = await seedRun(db, shop.brandId);
    const cardId = await seedCard(db, shop.brandId, runId);
    const a = await seedIdea(db, shop.brandId, cardId, { angle: "Idea A" });
    const b = await seedIdea(db, shop.brandId, cardId, { angle: "Idea B" });
    const theirs = await seedCards(db, other.brandId, 1);
    session.user = { id: shop.userId };
    await dismissIdeaAction(form({ ideaId: a }));
    await dismissIdeaAction(form({ ideaId: theirs.items[0].ideaId })); // not theirs to change
    expect(await statusOf("post_ideas", a)).toBe("dismissed");
    expect(await statusOf("post_ideas", b)).toBe("new");
    expect(await statusOf("post_ideas", theirs.items[0].ideaId)).toBe("new");
    const html = await render(shop);
    expect(html).toContain("Idea B");
    expect(html).not.toContain("Idea A");
  });

  it("dismissing a card hides it with its unused ideas and keeps used ideas", async () => {
    const shop = await makeShop(db);
    const runId = await seedRun(db, shop.brandId);
    const cardId = await seedCard(db, shop.brandId, runId, { title: "Going away" });
    const fresh = await seedIdea(db, shop.brandId, cardId);
    const used = await seedIdea(db, shop.brandId, cardId, { status: "used" });
    session.user = { id: shop.userId };
    await dismissCardAction(form({ cardId }));
    expect(await statusOf("trend_cards", cardId)).toBe("dismissed");
    expect(await statusOf("post_ideas", fresh)).toBe("dismissed");
    expect(await statusOf("post_ideas", used)).toBe("used");
    const html = await render(shop);
    expect(html).not.toContain("Going away");
    expect(html).toContain("You have dealt with all the ideas.");
  });
});

describe("Research now", () => {
  it("does not start a run when it is disabled, and says why", async () => {
    const shop = await makeShop(db);
    await saveResearchSettings(shop.userId, shop.brandId, { focus: null, on: false });
    session.user = { id: shop.userId };
    expect(await researchNowAction()).toEqual({ ok: false, message: "Weekly research is switched off." });
    expect(runSpy).not.toHaveBeenCalled();

    const limit = await makeShop(db);
    for (let i = 1; i <= 2; i++) await seedRun(db, limit.brandId, { trigger: "manual", startedAt: new Date(Date.now() - i * 3_600_000) });
    session.user = { id: limit.userId };
    const res = await researchNowAction();
    expect(res.ok).toBe(false);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("starts one manual run as the signed-in owner and reports the result", async () => {
    const shop = await makeShop(db);
    session.user = { id: shop.userId };
    runSpy.mockResolvedValueOnce({ status: "done", error: null });
    const res = await researchNowAction();
    expect(res.ok).toBe(true);
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy.mock.calls[0][0]).toMatchObject({ userId: shop.userId, brandId: shop.brandId, trigger: "manual" });

    runSpy.mockResolvedValueOnce({ status: "failed", error: "ai_timeout" });
    expect(await researchNowAction()).toEqual({ ok: false, message: "The research could not finish. Please try again later." });
    runSpy.mockResolvedValueOnce({ status: "capped", error: "research_cap" });
    expect((await researchNowAction()).ok).toBe(false);
    runSpy.mockRejectedValueOnce(new Error("boom"));
    expect(await researchNowAction()).toEqual({ ok: false, message: "Something went wrong. Please try again." });
  });

  it("refuses a signed-out visitor", async () => {
    session.user = null;
    expect((await researchNowAction()).ok).toBe(false);
    expect(runSpy).not.toHaveBeenCalled();
  });
});

describe("row-level security on ideas", () => {
  it("a member reads only their own runs, cards and ideas, and cannot change another business's", async () => {
    const a = await makeShop(db);
    const b = await makeShop(db);
    const x = await seedCards(db, a.brandId, 1);
    await seedCards(db, b.brandId, 1);
    const asUser = <T,>(shop: Shop, sql: string, p: unknown[] = []) => db.withUser(shop.userId, (tx) => tx.query<T>(sql, p));
    expect(await asUser(a, "select id from public.trend_cards")).toHaveLength(1);
    expect(await asUser(a, "select id from public.post_ideas")).toHaveLength(1);
    expect(await asUser(a, "select id from public.research_runs")).toHaveLength(1);
    expect(await asUser(b, "select id from public.trend_cards where brand_id = $1", [a.brandId])).toHaveLength(0);
    expect(await asUser(b, "update public.post_ideas set status = 'dismissed' where id = $1 returning id", [x.items[0].ideaId])).toHaveLength(0);
    expect(await asUser(b, "update public.trend_cards set status = 'dismissed' where id = $1 returning id", [x.items[0].cardId])).toHaveLength(0);
    // Runs and cards are written by the server, never by an owner.
    await expect(asUser(a, "insert into public.research_runs (brand_id, trigger, window_start, window_end) values ($1, 'manual', now(), now())", [a.brandId])).rejects.toThrow();
    await expect(asUser(a, "delete from public.trend_cards where id = $1 returning id", [x.items[0].cardId])).resolves.toHaveLength(0);
    expect(await asUser(a, "select id from public.trend_cards")).toHaveLength(1);
  });
});
