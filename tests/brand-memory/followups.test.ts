import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    api: {
      get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
      set: (name: string, value: string) => void store.set(name, value),
      delete: (name: string) => void store.delete(name),
    },
  };
});
vi.mock("next/headers", () => ({ cookies: async () => jar.api, headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import Home from "@/app/page";
import { homePathFor } from "@/lib/auth/home";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { signSession } from "../helpers/session";
import type { MockDb } from "@/lib/db/mock";
import { s } from "@/lib/i18n/strings";
import { addFact, editFact, listFacts } from "@/lib/memory/facts";
import { rereadMessage } from "@/lib/memory/messages";
import { rereadWebsite } from "@/lib/memory/website";
import { prepareWebsiteRead, runWebsiteRead } from "@/lib/setup/website";
import { readWebsiteFacts } from "@/lib/website/extract";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";
import { LOCAL_ENV, serve, serveSite, type TestServer } from "../website/site-server";

let db: MockDb;
let owner: string;
let brand: string;
let server: TestServer | null = null;

beforeAll(async () => {
  db = await openTestDb();
  owner = (await createUser(db)).id;
});
afterAll(async () => {
  await closeTestDb(db);
});
beforeEach(async () => {
  brand = await createBrandFor(db, owner, "Corner Bakery");
});
afterEach(async () => {
  await server?.close();
  server = null;
});

const options = { fetch: LOCAL_ENV };
const websiteRows = (active?: boolean) =>
  db.withAdmin((tx) =>
    tx.query<{ id: string; kind: string; label: string | null; value: string; active: boolean; source_ref: string }>(
      `select id, kind::text, label, value, active, source_ref from public.brand_facts
        where brand_id = $1 and source_type = 'website' ${active === undefined ? "" : active ? "and active" : "and not active"} order by created_at, id`,
      [brand],
    ),
  );
const status = async () =>
  (await db.withAdmin((tx) => tx.query<{ website_url: string | null; website_status: string }>("select website_url, website_status::text from public.brand_memory where brand_id = $1", [brand])))[0];

describe("a re-read does not undo an owner edit", () => {
  it("skips website facts the owner edited or added with the same kind and label, and counts them", async () => {
    server = await serveSite("corner-bakery");
    const url = `${server.origin}/`;
    await rereadWebsite({ userId: owner, brandId: brand, url, options });
    const first = await listFacts(owner, brand);
    const loaf = first.find((f) => f.kind === "price" && f.label === "Sourdough loaf")!;
    // an edit that keeps the label, and an edit that renames it (matched under the original label too)
    const rye = first.find((f) => f.kind === "price" && f.label === "Rye and seed loaf")!;
    await editFact(owner, brand, loaf.id, { kind: "price", label: "Sourdough loaf", value: "£9.99" });
    await editFact(owner, brand, rye.id, { kind: "price", label: "Rye loaf (renamed)", value: "£5.20" });
    // owner-added with the same kind + label as a website fact (case and spacing do not matter)
    await addFact(owner, brand, { kind: "offer", label: "friday  DISCOUNT", value: "15% off on Fridays" });
    // owner-added without a label must not hide anything
    await addFact(owner, brand, { kind: "price", label: "", value: "Ask in store" });

    const out = await rereadWebsite({ userId: owner, brandId: brand, url, options });
    expect(out).toMatchObject({ status: "ok", factsSaved: 19, factsSkippedOwnerEdited: 3 });

    const active = await websiteRows(true);
    expect(active).toHaveLength(19);
    // the owner's version wins
    expect(active.some((f) => f.kind === "price" && f.label === "Sourdough loaf")).toBe(false);
    expect(active.some((f) => f.kind === "price" && f.label === "Rye and seed loaf")).toBe(false);
    expect(active.some((f) => f.kind === "offer" && f.label === "Friday discount")).toBe(false);
    // the same label under another kind is a different fact and is still saved
    expect(active.some((f) => f.kind === "product" && f.label === "Sourdough loaf")).toBe(true);
    // everything else was replaced as before
    expect(active.some((f) => f.label === "Cinnamon bun" && f.kind === "price")).toBe(true);

    const listed = await listFacts(owner, brand);
    expect(listed.filter((f) => f.kind === "price" && f.label === "Sourdough loaf").map((f) => f.value)).toEqual(["£9.99"]);
    expect(listed.find((f) => f.label === "Rye loaf (renamed)")).toMatchObject({ value: "£5.20", editedFrom: "website" });
    expect(listed.find((f) => f.value === "15% off on Fridays")).toBeTruthy();
    expect(listed.find((f) => f.value === "Ask in store")).toBeTruthy();

    // the owner sees it
    expect(rereadMessage(out)).toBe("Done. We read 4 pages and found 19 facts. 3 kept as you edited them.");
  });

  it("an owner fact that was removed no longer blocks the website's fact", async () => {
    server = await serveSite("corner-bakery");
    const url = `${server.origin}/`;
    await rereadWebsite({ userId: owner, brandId: brand, url, options });
    const loaf = (await listFacts(owner, brand)).find((f) => f.kind === "price" && f.label === "Sourdough loaf")!;
    const edited = await editFact(owner, brand, loaf.id, { kind: "price", label: "Sourdough loaf", value: "£9.99" });
    await db.withAdmin((tx) => tx.query("update public.brand_facts set active = false where id = $1", [edited.id]));
    const out = await rereadWebsite({ userId: owner, brandId: brand, url, options });
    expect(out.factsSkippedOwnerEdited).toBe(0);
    expect(out.factsSaved).toBe(22);
  });

  it("the reader reports 0 skipped when the owner has no versions", async () => {
    server = await serveSite("corner-bakery");
    const res = await readWebsiteFacts({ userId: owner, brandId: brand, url: `${server.origin}/`, options });
    expect(res).toMatchObject({ factsSaved: 22, factsSkippedOwnerEdited: 0 });
  });
});

describe("old website facts stay until a new read succeeds", () => {
  async function seedFromBakery(): Promise<void> {
    server = await serveSite("corner-bakery");
    await rereadWebsite({ userId: owner, brandId: brand, url: `${server.origin}/`, options });
    expect(await websiteRows(true)).toHaveLength(22);
  }

  it("a blocked new address keeps the old facts and says so", async () => {
    await seedFromBakery();
    const blocked = await serve((req, res) => {
      if (req.url === "/robots.txt") return void res.writeHead(200, { "content-type": "text/plain" }).end("User-agent: *\nDisallow: /\n");
      res.writeHead(200, { "content-type": "text/html" }).end("<html><body>Hello there, this page is long enough to read.</body></html>");
    });
    try {
      const out = await rereadWebsite({ userId: owner, brandId: brand, url: `${blocked.origin}/`, options });
      expect(out).toMatchObject({ status: "blocked", addressChanged: true, factsSaved: 0 });
      expect(await websiteRows(true)).toHaveLength(22);
      expect(await websiteRows(false)).toHaveLength(0);
      expect((await status()).website_status).toBe("blocked");
      expect(rereadMessage(out)).toBe("We couldn't read the new address; your existing facts are kept.");
      expect(s.brandV2.facts.reread.hint).toMatch(/kept until the new address has been read successfully/);
    } finally {
      await blocked.close();
    }
  });

  it("an unreachable address, a model failure and a read with no facts all keep the old facts", async () => {
    await seedFromBakery();
    const gone = await serve((_req, res) => void res.end());
    const goneUrl = `${gone.origin}/`;
    await gone.close();
    const unreachable = await rereadWebsite({ userId: owner, brandId: brand, url: goneUrl, options });
    expect(unreachable.status).toBe("failed");
    expect(rereadMessage(unreachable)).toBe(s.brandV2.facts.reread.failedNewAddress);
    expect(await websiteRows(true)).toHaveLength(22);

    const other = await serveSite("corner-bakery");
    try {
      // the model fails on a site that loads fine
      const aiFail = await rereadWebsite({
        userId: owner,
        brandId: brand,
        url: `${other.origin}/`,
        options,
        read: async (a) => ({
          ...(await readWebsiteFacts({ ...a, options: { ...options, fixture: () => ({ business_summary: "", facts: [] }) } })),
          status: "failed" as const,
          reason: "ai_failed",
        }),
      });
      expect(aiFail.status).toBe("failed");
      expect(await websiteRows(true)).toHaveLength(22);

      // a read that works but finds no facts does not wipe the old ones either
      const empty = await rereadWebsite({
        userId: owner,
        brandId: brand,
        url: `${other.origin}/`,
        options: { ...options, fixture: () => ({ business_summary: "A bakery.", facts: [] }) },
      });
      expect(empty).toMatchObject({ status: "ok", factsSaved: 0 });
      expect(await websiteRows(true)).toHaveLength(22);
    } finally {
      await other.close();
    }
  });

  it("a successful read of the new address replaces them", async () => {
    await seedFromBakery();
    const old = await websiteRows(true);
    const other = await serveSite("corner-bakery");
    try {
      const out = await rereadWebsite({ userId: owner, brandId: brand, url: `${other.origin}/`, options });
      expect(out).toMatchObject({ status: "ok", factsSaved: 22, addressChanged: true });
      const active = await websiteRows(true);
      expect(active).toHaveLength(22);
      expect(active.every((f) => f.source_ref.startsWith(other.origin))).toBe(true);
      expect((await websiteRows(false)).map((f) => f.id).sort()).toEqual(old.map((f) => f.id).sort());
    } finally {
      await other.close();
    }
  });

  it("setup's background read follows the same rule", async () => {
    await seedFromBakery();
    // the owner goes back in setup and types another address: nothing is deactivated yet
    expect(await prepareWebsiteRead(owner, brand, "https://other-site.example/")).toBe(true);
    expect(await websiteRows(true)).toHaveLength(22);
    expect((await status()).website_status).toBe("none");

    // that read fails: the old facts are still there and the status says failed
    await runWebsiteRead({
      userId: owner,
      brandId: brand,
      url: "https://other-site.example/",
      read: async () => {
        throw new Error("network down");
      },
      timeoutMs: 2000,
    });
    expect(await websiteRows(true)).toHaveLength(22);
    expect((await status()).website_status).toBe("failed");

    // a good read of another address replaces them
    const other = await serveSite("corner-bakery");
    try {
      const url = `${other.origin}/`;
      expect(await prepareWebsiteRead(owner, brand, url)).toBe(true);
      await runWebsiteRead({ userId: owner, brandId: brand, url, read: (a) => readWebsiteFacts({ ...a, options }) });
      const active = await websiteRows(true);
      expect(active).toHaveLength(22);
      expect(active.every((f) => f.source_ref.startsWith(other.origin))).toBe(true);
    } finally {
      await other.close();
    }
  });

  it("removing the website on purpose still stops its facts being used", async () => {
    await seedFromBakery();
    await rereadWebsite({ userId: owner, brandId: brand, url: "", options });
    expect(await websiteRows(true)).toHaveLength(0);
  });
});

describe("landing page", () => {
  async function signIn(id: string) {
    jar.store.set(SESSION_COOKIE, await signSession({ id, email: `${id.slice(0, 6)}@example.com` }));
  }

  it("homePathFor: /setup with no brand or an unfinished one, /home once set up", async () => {
    const fresh = (await createUser(db)).id;
    expect(await homePathFor(fresh)).toBe("/setup");
    await createBrandFor(db, fresh, "Half done");
    expect(await homePathFor(fresh)).toBe("/setup");
    await db.withAdmin((tx) =>
      tx.query("update public.brand_memory set setup_completed_at = now() where brand_id in (select brand_id from public.brand_members where user_id = $1)", [fresh]),
    );
    expect(await homePathFor(fresh)).toBe("/home");
  });

  it("/ sends an owner with a finished brand to /home, a new one to /setup, and a visitor to /login", async () => {
    await db.withAdmin((tx) => tx.query("update public.brand_memory set setup_completed_at = now() where brand_id = $1", [brand]));
    await signIn(owner);
    await expect(Home()).rejects.toThrow("REDIRECT:/home");
    await signIn((await createUser(db)).id);
    await expect(Home()).rejects.toThrow("REDIRECT:/setup");
    jar.store.delete(SESSION_COOKIE);
    await expect(Home()).rejects.toThrow("REDIRECT:/login");
  });
});
