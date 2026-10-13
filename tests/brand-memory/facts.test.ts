import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
vi.mock("@/app/(app)/brand/actions", () => ({
  addFactAction: vi.fn(),
  editFactAction: vi.fn(),
  removeFactAction: vi.fn(),
  rereadWebsiteAction: vi.fn(),
}));

import { FactItem, FactsSection } from "@/components/brand/facts-section";
import { BrandAccessError } from "@/lib/brand/current";
import type { MockDb } from "@/lib/db/mock";
import { fill, s } from "@/lib/i18n/strings";
import { addFact, editFact, FactLimitError, FactNotFoundError, FactValidationError, listFacts, removeFact } from "@/lib/memory/facts";
import { rereadMessage } from "@/lib/memory/messages";
import { MAX_ACTIVE_FACTS, groupOfKind, type FactView } from "@/lib/memory/schema";
import { rereadWebsite } from "@/lib/memory/website";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";
import { LOCAL_ENV, serveSite, type TestServer } from "../website/site-server";

let db: MockDb;
let owner: string;
let outsider: string;
let brand: string;

beforeAll(async () => {
  db = await openTestDb();
  owner = (await createUser(db)).id;
  outsider = (await createUser(db)).id;
  brand = await createBrandFor(db, owner, "Corner Bakery");
});
afterAll(async () => {
  await closeTestDb(db);
});
beforeEach(async () => {
  await db.withAdmin((tx) => tx.query("delete from public.brand_facts where brand_id = $1", [brand]));
  // These tests re-read the website more often than the weekly limit allows (V-21); the limit has its own tests.
  await db.withAdmin((tx) => tx.query("delete from public.usage_events where brand_id = $1", [brand]));
});

const PAGE = "https://cornerbakery.example/menu.html";

async function insertFact(f: {
  kind?: string;
  label?: string | null;
  value: string;
  source: "website" | "setup" | "upload" | "owner";
  ref?: string | null;
  quote?: string | null;
  promise?: boolean;
  active?: boolean;
}): Promise<string> {
  const [row] = await db.withAdmin((tx) =>
    tx.query<{ id: string }>(
      `insert into public.brand_facts (brand_id, kind, label, value, source_type, source_ref, source_quote, outcome_promise, active)
       values ($1, $2::public.fact_kind, $3, $4, $5::public.fact_source, $6, $7, $8, $9) returning id`,
      [brand, f.kind ?? "product", f.label ?? null, f.value, f.source, f.ref ?? null, f.quote ?? null, f.promise ?? false, f.active ?? true],
    ),
  );
  return row.id;
}

const rows = (where = "true") =>
  db.withAdmin((tx) =>
    tx.query<{ id: string; kind: string; label: string | null; value: string; source_type: string; source_ref: string | null; source_quote: string | null; active: boolean; outcome_promise: boolean; created_by: string | null }>(
      `select id, kind::text, label, value, source_type::text, source_ref, source_quote, active, outcome_promise, created_by
         from public.brand_facts where brand_id = $1 and ${where} order by created_at, id`,
      [brand],
    ),
  );

function render(facts: FactView[], regulated = false): string {
  return renderToString(
    createElement(FactsSection, { brandId: brand, facts, regulated, website: { url: "https://cornerbakery.example", status: "ok", readAt: "2026-10-13" } }),
  );
}

describe("AC 4/5: every fact is shown with its source", () => {
  it("lists all four source types with the right badge, link and quote", async () => {
    await insertFact({ value: "£4.50", label: "Sourdough loaf", kind: "price", source: "website", ref: PAGE, quote: "Sourdough loaf £4.50" });
    await insertFact({ value: "Sourdough bread and cakes", label: "What we sell", source: "setup", ref: "what_sell", quote: "Sourdough bread and cakes" });
    await insertFact({ value: "Free delivery over £20", kind: "offer", source: "upload", ref: "11111111-1111-4111-8111-111111111111", quote: "Free delivery on orders over £20" });
    await insertFact({ value: "Gluten free on request", kind: "differentiator", source: "owner" });

    const facts = await listFacts(owner, brand);
    expect(facts).toHaveLength(4);
    expect(facts.map((f) => f.sourceType).sort()).toEqual(["owner", "setup", "upload", "website"]);

    const html = render(facts);
    // every fact value is on the page
    for (const f of facts) expect(html).toContain(f.value.replace(/£/g, "£"));
    // one badge per source type, with the exact words
    expect(html).toContain(s.brandV2.facts.source.website);
    expect(html).toContain(s.brandV2.facts.source.setup);
    expect(html).toContain(s.brandV2.facts.source.upload);
    expect(html).toContain(s.brandV2.facts.source.owner);

    // the website badge links to the source page and opens in a new tab, safely
    const link = /<a [^>]*>/.exec(html.slice(html.indexOf('data-source="website"')))![0];
    expect(link).toContain(`href="${PAGE}"`);
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
    // the quote is available on tap
    expect(html).toContain("Sourdough loaf £4.50");
    expect(html).toContain(s.brandV2.facts.showQuote);
    // setup and owner badges are not links
    const setupPart = html.slice(html.indexOf('data-source="setup"'), html.indexOf('data-source="setup"') + 200);
    expect(setupPart).not.toContain("<a ");
    // grouped: prices, offers, differentiators, products and services
    for (const g of ["product", "price", "offer", "differentiator"] as const) expect(html).toContain(s.brandV2.facts.groups[g]);
  });

  it("only links http(s) pages: a javascript: source_ref is shown as plain text", async () => {
    await insertFact({ value: "£1", kind: "price", source: "website", ref: "javascript:alert(1)", quote: "q" });
    const html = render(await listFacts(owner, brand));
    expect(html).not.toContain("javascript:");
    expect(html).toContain(s.brandV2.facts.source.website);
  });

  it("groups contact facts together and keeps an empty state", async () => {
    expect(render([])).toContain(s.brandV2.facts.empty);
    await insertFact({ kind: "phone", value: "+44 20 7946 0183", source: "website", ref: PAGE, quote: "q" });
    await insertFact({ kind: "email", value: "hello@cornerbakery.example", source: "website", ref: PAGE, quote: "q" });
    await insertFact({ kind: "address", value: "27 Lansdowne Parade", source: "website", ref: PAGE, quote: "q" });
    const html = render(await listFacts(owner, brand));
    expect(html.split(s.brandV2.facts.groups.contact).length - 1).toBe(1);
    expect(groupOfKind("phone")).toBe("contact");
  });

  it("does not list removed facts", async () => {
    await insertFact({ value: "Old price", kind: "price", source: "website", ref: PAGE, quote: "q", active: false });
    await insertFact({ value: "Current price", kind: "price", source: "owner" });
    expect((await listFacts(owner, brand)).map((f) => f.value)).toEqual(["Current price"]);
  });
});

describe("add, edit and remove persist", () => {
  it("adds an owner fact", async () => {
    const f = await addFact(owner, brand, { kind: "offer", label: " Friday ", value: "  10% off on Fridays  " });
    expect(f).toMatchObject({ kind: "offer", label: "Friday", value: "10% off on Fridays", sourceType: "owner", sourceRef: null, editedFrom: null });
    const [row] = await rows();
    expect(row).toMatchObject({ source_type: "owner", active: true, created_by: owner, outcome_promise: false });
    expect((await listFacts(owner, brand)).map((x) => x.value)).toEqual(["10% off on Fridays"]);
  });

  it("validates: value 1 to 1000 characters, label up to 120, a known kind", async () => {
    const bad = async (input: unknown) => (await addFact(owner, brand, input).catch((e) => e)) as FactValidationError;
    expect((await bad({ kind: "offer", label: "", value: "   " })).fieldErrors.value).toBe("value_required");
    expect((await bad({ kind: "offer", label: "", value: "x".repeat(1001) })).fieldErrors.value).toBe("value_too_long");
    expect((await bad({ kind: "offer", label: "y".repeat(121), value: "ok" })).fieldErrors.label).toBe("label_too_long");
    expect((await bad({ kind: "nonsense", label: "", value: "ok" })).fieldErrors.kind).toBe("invalid_kind");
    expect(await bad({ kind: "offer" })).toBeInstanceOf(FactValidationError);
    expect(await rows()).toHaveLength(0);
    await addFact(owner, brand, { kind: "offer", label: "y".repeat(120), value: "x".repeat(1000) });
    expect(await rows()).toHaveLength(1);
  });

  it("stops at the limit of active facts", async () => {
    await db.withAdmin((tx) =>
      tx.query(
        `insert into public.brand_facts (brand_id, kind, value, source_type)
         select $1, 'other', 'Fact ' || g, 'owner' from generate_series(1, $2) g`,
        [brand, MAX_ACTIVE_FACTS],
      ),
    );
    await expect(addFact(owner, brand, { kind: "other", label: "", value: "one too many" })).rejects.toBeInstanceOf(FactLimitError);
  });

  it("editing a website fact keeps the old row inactive and adds an owner row that says what it was edited from", async () => {
    const original = await insertFact({ value: "£4.50", label: "Sourdough loaf", kind: "price", source: "website", ref: PAGE, quote: "Sourdough loaf £4.50", promise: true });
    const edited = await editFact(owner, brand, original, { kind: "price", label: "Sourdough loaf", value: "£4.80" });

    const all = await rows();
    expect(all).toHaveLength(2);
    const old = all.find((r) => r.id === original)!;
    expect(old).toMatchObject({ active: false, value: "£4.50", source_type: "website", source_ref: PAGE, source_quote: "Sourdough loaf £4.50" });
    const fresh = all.find((r) => r.id === edited.id)!;
    expect(fresh).toMatchObject({ active: true, value: "£4.80", source_type: "owner", source_ref: original, source_quote: null, created_by: owner });
    // an edit does not make a promise safe
    expect(fresh.outcome_promise).toBe(true);

    const listed = await listFacts(owner, brand);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ value: "£4.80", sourceType: "owner", editedFrom: "website" });
    const html = render(listed);
    expect(html).toContain("Edited by you (was from your website)");
    expect(html).not.toContain(PAGE); // the old page is not claimed as the source of the new value
  });

  it("editing a setup fact says it was from setup", async () => {
    const original = await insertFact({ kind: "product", label: "What we sell", value: "Bread", source: "setup", ref: "what_sell", quote: "Bread" });
    await editFact(owner, brand, original, { kind: "product", label: "What we sell", value: "Bread and cakes" });
    const [f] = await listFacts(owner, brand);
    expect(f).toMatchObject({ value: "Bread and cakes", sourceType: "owner", editedFrom: "setup" });
    expect(render([f])).toContain("Edited by you (was from setup)");
  });

  it("an owner's own fact changes in place, and a second edit of an edit keeps its origin", async () => {
    const own = await addFact(owner, brand, { kind: "offer", label: "", value: "Buy one" });
    const again = await editFact(owner, brand, own.id, { kind: "offer", label: "Deal", value: "Buy two" });
    expect(again.id).toBe(own.id);
    expect(await rows()).toHaveLength(1);

    const web = await insertFact({ value: "£4.50", kind: "price", source: "website", ref: PAGE, quote: "q" });
    const first = await editFact(owner, brand, web, { kind: "price", label: "", value: "£4.60" });
    const second = await editFact(owner, brand, first.id, { kind: "price", label: "", value: "£4.70" });
    expect(second.id).toBe(first.id);
    expect(second.editedFrom).toBe("website");
    expect((await rows()).filter((r) => r.active && r.kind === "price")).toHaveLength(1);
  });

  it("an edit that changes nothing writes nothing", async () => {
    const web = await insertFact({ value: "£4.50", label: "Loaf", kind: "price", source: "website", ref: PAGE, quote: "q" });
    const same = await editFact(owner, brand, web, { kind: "price", label: "Loaf", value: "£4.50" });
    expect(same.id).toBe(web);
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0].active).toBe(true);
  });

  it("refuses to edit a missing, removed or malformed fact", async () => {
    const gone = await insertFact({ value: "x", source: "owner", active: false });
    await expect(editFact(owner, brand, gone, { kind: "other", label: "", value: "y" })).rejects.toBeInstanceOf(FactNotFoundError);
    await expect(editFact(owner, brand, "not-a-uuid", { kind: "other", label: "", value: "y" })).rejects.toBeInstanceOf(FactNotFoundError);
  });

  it("removing sets active = false and never deletes the row", async () => {
    const id = await insertFact({ value: "£4.50", kind: "price", source: "website", ref: PAGE, quote: "q" });
    expect(await removeFact(owner, brand, id)).toBe(true);
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id, active: false, value: "£4.50" });
    expect(await listFacts(owner, brand)).toEqual([]);
    expect(await removeFact(owner, brand, id)).toBe(false);
    expect(await removeFact(owner, brand, "nope")).toBe(false);
  });
});

describe("outcome-promise chip", () => {
  const fact = (promise: boolean): FactView => ({
    id: "f1",
    kind: "claim",
    label: "Results",
    value: "Lose 5 kg in a month, guaranteed",
    sourceType: "website",
    sourceRef: PAGE,
    sourceQuote: "Lose 5 kg in a month, guaranteed",
    outcomePromise: promise,
    editedFrom: null,
  });

  it("shows the regulated wording for a regulated brand", () => {
    const html = renderToString(createElement(FactItem, { fact: fact(true), regulated: true }));
    expect(html).toContain("Posts won&#x27;t repeat this: health, money, legal and education promises can break advertising rules.");
    expect(s.brandV2.facts.promiseRegulated).toBe("Posts won't repeat this: health, money, legal and education promises can break advertising rules.");
    expect(html).toContain('data-promise="regulated"');
  });

  it("shows a softer note for other brands, and nothing when the fact is not a promise", () => {
    const plain = renderToString(createElement(FactItem, { fact: fact(true), regulated: false }));
    expect(plain).toContain(s.brandV2.facts.promiseOther);
    expect(plain).not.toContain("advertising rules");
    const none = renderToString(createElement(FactItem, { fact: fact(false), regulated: true }));
    expect(none).not.toContain("data-promise");
  });
});

describe("members only", () => {
  it("refuses every fact call from someone outside the brand and changes nothing", async () => {
    const id = await insertFact({ value: "£4.50", kind: "price", source: "website", ref: PAGE, quote: "q" });
    const input = { kind: "other", label: "", value: "intruder" };
    await expect(listFacts(outsider, brand)).rejects.toBeInstanceOf(BrandAccessError);
    await expect(addFact(outsider, brand, input)).rejects.toBeInstanceOf(BrandAccessError);
    await expect(editFact(outsider, brand, id, input)).rejects.toBeInstanceOf(BrandAccessError);
    await expect(removeFact(outsider, brand, id)).rejects.toBeInstanceOf(BrandAccessError);
    await expect(rereadWebsite({ userId: outsider, brandId: brand, url: "https://cornerbakery.example" })).rejects.toBeInstanceOf(BrandAccessError);
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id, active: true, value: "£4.50" });
  });
});

describe("re-read replaces the website facts", () => {
  let server: TestServer | null = null;
  afterAll(async () => {
    await server?.close();
  });

  it("deactivates the old website facts, adds the new ones, and keeps the owner's", async () => {
    server = await serveSite("corner-bakery");
    const url = `${server.origin}/`;
    const options = { fetch: LOCAL_ENV };

    const first = await rereadWebsite({ userId: owner, brandId: brand, url, options });
    expect(first).toMatchObject({ status: "ok", websiteUrl: url, factsSaved: 22 });
    expect(first.pagesRead).toBeGreaterThanOrEqual(3);

    const own = await addFact(owner, brand, { kind: "offer", label: "", value: "Free coffee with a loaf" });
    const edited = await editFact(owner, brand, (await rows("source_type = 'website'"))[1].id, { kind: "price", label: "Edited", value: "£9.99" });

    const second = await rereadWebsite({ userId: owner, brandId: brand, url, options });
    // the one the owner edited is not brought back: the owner's version wins
    expect(second).toMatchObject({ factsSaved: 21, factsSkippedOwnerEdited: 1 });

    const website = await rows("source_type = 'website'");
    expect(website).toHaveLength(43);
    expect(website.filter((r) => r.active)).toHaveLength(21);
    expect(website.filter((r) => !r.active)).toHaveLength(22); // kept for audit, never deleted
    // the owner's fact and the owner's edit survive a re-read
    const listed = await listFacts(owner, brand);
    expect(listed.find((f) => f.id === own.id)).toBeTruthy();
    expect(listed.find((f) => f.id === edited.id)).toMatchObject({ value: "£9.99", editedFrom: "website" });
    // every listed website fact links to a page on the site
    for (const f of listed.filter((x) => x.sourceType === "website")) expect(f.sourceRef!.startsWith(server.origin)).toBe(true);
  });

  it("a failed re-read of the same address keeps the facts that are there", async () => {
    await rereadWebsite({ userId: owner, brandId: brand, url: `${server!.origin}/`, options: { fetch: LOCAL_ENV } });
    expect(await rows("source_type = 'website' and active")).toHaveLength(22);
    const failing = await rereadWebsite({
      userId: owner,
      brandId: brand,
      url: `${server!.origin}/`,
      read: async () => ({ status: "failed", pagesRead: [], skipped: [], factsSaved: 0, factsDropped: 0, factsSkippedOwnerEdited: 0, logoCandidates: [], themeColor: null, summary: "", reason: "ai_failed" }),
    });
    expect(failing).toMatchObject({ status: "failed", reason: "ai_failed", factsSaved: 0 });
    expect((await rows("source_type = 'website' and active")).length).toBe(22);
  });

  it("changing the address clears the old site's facts, and an empty address removes the website", async () => {
    const other = await serveSite("corner-bakery");
    try {
      await rereadWebsite({ userId: owner, brandId: brand, url: `${other.origin}/`, options: { fetch: LOCAL_ENV } });
      const active = await rows("source_type = 'website' and active");
      expect(active).toHaveLength(22);
      expect(active.every((r) => r.source_ref!.startsWith(other.origin))).toBe(true);

      const removed = await rereadWebsite({ userId: owner, brandId: brand, url: "  ", options: { fetch: LOCAL_ENV } });
      expect(removed).toMatchObject({ status: "none", websiteUrl: null, factsSaved: 0 });
      expect(await rows("source_type = 'website' and active")).toHaveLength(0);
      const [m] = await db.withAdmin((tx) => tx.query<{ website_url: string | null; website_status: string }>("select website_url, website_status::text from public.brand_memory where brand_id = $1", [brand]));
      expect(m).toEqual({ website_url: null, website_status: "none" });
    } finally {
      await other.close();
    }
  });

  it("rejects a bad address and says so in plain words", async () => {
    await expect(rereadWebsite({ userId: owner, brandId: brand, url: "ftp://example.com" })).rejects.toMatchObject({ name: "WebsiteUrlError" });
    expect(s.brandV2.facts.reread.invalidUrl).toMatch(/web address/);
  });

  it("tells the owner what happened in plain words", () => {
    const m = (o: Partial<Parameters<typeof rereadMessage>[0]>) =>
      rereadMessage({ status: "ok", websiteUrl: "https://a.example", pagesRead: 4, factsSaved: 22, reason: null, ...o });
    expect(m({})).toBe("Done. We read 4 pages and found 22 facts.");
    expect(m({ status: "partial", pagesRead: 1, factsSaved: 1 })).toBe("We read 1 page and found 1 fact. Some pages could not be opened.");
    expect(m({ status: "blocked" })).toBe(s.brandV2.facts.reread.blocked);
    expect(m({ status: "failed", reason: "ai_failed" })).toBe(s.brandV2.facts.reread.aiFailed);
    expect(m({ status: "failed", reason: "network" })).toBe(s.brandV2.facts.reread.failed);
    expect(m({ factsSaved: 0 })).toBe(fill(s.brandV2.facts.reread.noFacts, { pages: "4 pages" }));
    expect(m({ websiteUrl: null, status: "none" })).toBe(s.brandV2.facts.reread.removed);
  });
});
