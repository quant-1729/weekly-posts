import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteAccount } from "@/lib/account/delete";
import { buildExport } from "@/lib/account/export";
import type { MockDb } from "@/lib/db/mock";
import { runResearch } from "@/lib/ideas";
import { createCompetitor, saveResearchSettings } from "@/lib/ideas/competitors";
import { createMockStorage } from "@/lib/storage/mock";
import { accountRowCounts } from "../account/helpers";
import { collect, parseZip } from "../account/zip-read";
import { NOW, baseDeps, closeDb, dnsOk, groundedAnswer, makeShop, openDb, rows, scriptedAi, simpleCard, type Shop } from "./helpers";

let db: MockDb;
let dir: string;
beforeAll(async () => {
  db = await openDb();
  dir = await mkdtemp(path.join(os.tmpdir(), "pm-ideas-export-"));
});
afterAll(async () => {
  await closeDb(db);
  await rm(dir, { recursive: true, force: true });
});

const IDEAS_TABLES = ["competitors", "research_runs", "trend_cards", "post_ideas", "competitor_snapshots"];
const read = (zip: ReturnType<typeof parseZip>, name: string) => JSON.parse(new TextDecoder().decode(zip.files.get(name))) as Record<string, unknown>[];

/** A shop with a competitor, a snapshot, a finished run with a card and ideas, and the research settings. */
async function seedIdeas(shop: Shop, label: string) {
  const comp = await createCompetitor(shop.userId, shop.brandId, { name: `Rival ${label}`, website: "https://rival.example.com", instagram: "@rival.bakes" }, { resolver: dnsOk });
  await saveResearchSettings(shop.userId, shop.brandId, { focus: `focus ${label}`, on: true });
  await rows(db, "insert into public.competitor_snapshots (brand_id, competitor_id, followers, media_count, recent) values ($1, $2, 1000, 200, '[]'::jsonb)", [shop.brandId, comp.id]);
  const { ai } = scriptedAi({
    plan: [{ q: `cakes ${label}`, source: "web", why: "w" }],
    grounded: () => groundedAnswer(`Trend ${label}`, "n", "2026-10-14", `https://news.example.com/${label}`),
    cards: (f) => f.map((x) => simpleCard([x.id], `Card ${label}`)),
  });
  const run = await runResearch({ userId: shop.userId, brandId: shop.brandId, trigger: "manual", now: NOW }, baseDeps(ai));
  expect(run!.status).toBe("done");
}

describe("account export and deletion include the Ideas tables", () => {
  it("the export has competitors.json (with snapshots) and research.json (runs, cards, ideas), and nothing of another brand", async () => {
    const mine = await makeShop(db, { name: "Mine" });
    const theirs = await makeShop(db, { name: "Theirs" });
    await seedIdeas(mine, "mine");
    await seedIdeas(theirs, "theirs");

    const zip = parseZip(await collect(await buildExport(mine.userId, { storage: createMockStorage(dir), now: NOW })));
    expect(zip.names).toContain("competitors.json");
    expect(zip.names).toContain("research.json");
    const competitors = read(zip, "competitors.json");
    expect(competitors).toHaveLength(1);
    expect(competitors[0]).toMatchObject({ name: "Rival mine", instagram_handle: "rival.bakes" });
    expect(competitors[0].snapshots).toHaveLength(1);
    const research = read(zip, "research.json") as unknown as { status: string; cost_usd: string; cards: { title: string; sources: unknown[]; ideas: { description: string }[] }[] }[];
    expect(research).toHaveLength(1);
    expect(research[0].status).toBe("done");
    expect(research[0].cards[0]).toMatchObject({ title: "Card mine" });
    expect(research[0].cards[0].sources.length).toBeGreaterThan(0);
    expect(research[0].cards[0].ideas.length).toBeGreaterThan(0);
    // The research focus and switch are in brand.json (brand_memory).
    expect(JSON.stringify(read(zip, "brand.json"))).toContain("focus mine");

    const text = ["competitors.json", "research.json"].map((n) => new TextDecoder().decode(zip.files.get(n))).join("\n");
    expect(text).not.toContain("theirs");
    expect(new TextDecoder().decode(zip.files.get("README.txt"))).toMatch(/competitors\.json[\s\S]*research\.json/);
  });

  it("deleting the account removes every Ideas row of that brand and leaves the other brand's untouched", async () => {
    const a = await makeShop(db, { name: "Gone" });
    const b = await makeShop(db, { name: "Stays" });
    await seedIdeas(a, "a");
    await seedIdeas(b, "b");
    const emails = Object.fromEntries(await Promise.all([a, b].map(async (s) => [s.userId, (await rows<{ email: string }>(db, "select email from public.profiles where id = $1", [s.userId]))[0].email])));
    const acct = (s: Shop) => ({ brandId: s.brandId, userId: s.userId, email: emails[s.userId] });

    const before = await accountRowCounts(db, acct(a));
    for (const t of IDEAS_TABLES) expect(before[t], `${t} is seeded`).toBeGreaterThan(0);
    const beforeB = await accountRowCounts(db, acct(b));

    await deleteAccount(a.userId, { storage: createMockStorage(dir) });

    const after = await accountRowCounts(db, acct(a));
    for (const t of IDEAS_TABLES) expect(after[t], `${t} is gone`).toBe(0);
    expect(Object.entries(after).filter(([, n]) => n > 0)).toEqual([]);
    expect(await accountRowCounts(db, acct(b))).toEqual(beforeB);
  });
});
