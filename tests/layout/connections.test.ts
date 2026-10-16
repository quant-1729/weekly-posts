// The Connections page (C-02): Instagram import status and name, publishing described as coming soon (no buttons
// until they work), and the saved YouTube channel. It reads the database only.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";

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
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => "/connections",
}));
vi.mock("@/components/instagram/actions", () => ({
  importInstagramAction: vi.fn(),
  refreshInstagramAction: vi.fn(),
  removeInstagramPostsAction: vi.fn(),
  loadInstagramImagesAction: vi.fn(),
  addInstagramPhotosAction: vi.fn(),
}));

import BrandPage from "@/app/(app)/brand/page";
import Page from "@/app/(app)/connections/page";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { signSession } from "../helpers/session";
import { saveConnection } from "@/lib/connections/service";
import { createContact } from "@/lib/contacts/service";
import type { MockDb } from "@/lib/db/mock";
import { s } from "@/lib/i18n/strings";
import { saveInstagramHandle } from "@/lib/instagram/import";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";

let db: MockDb;
let owner: string;
let brand: string;
let newcomer: string;
let fetchSpy: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  db = await openTestDb();
  owner = (await createUser(db)).id;
  newcomer = (await createUser(db)).id;
  brand = await createBrandFor(db, owner, "Corner Bakery");
  await db.withAdmin((tx) =>
    tx.query(
      `update public.brand_memory set business_name = 'Corner Bakery', category = 'Bread', audience = 'Locals', country = 'GB',
              timezone = 'Europe/London', tone = 'friendly', minutes_per_post = 20, setup_completed_at = now() where brand_id = $1`,
      [brand],
    ),
  );
});
afterAll(async () => {
  await closeTestDb(db);
});
beforeEach(async () => {
  jar.store.set(SESSION_COOKIE, await signSession({ id: owner, email: "owner@example.com" }));
  fetchSpy = vi.fn(() => {
    throw new Error("the Connections page must not use the network");
  });
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const html = async () => renderToString((await Page()) as ReactElement).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'");

describe("the Connections page", () => {
  it("renders the Instagram import card, both publishing cards and YouTube, without any network call", async () => {
    const out = await html();
    expect(out).toContain(s.connections.title);
    expect(out).toContain('data-testid="instagram-card"');
    expect(out).toContain(s.instagram.title);
    expect(out).toContain(s.connections.publishInstagram.title);
    expect(out).toContain(s.connections.publishFacebook.title);
    expect(out).not.toContain("Coming soon");
    expect(out).toContain(s.connections.youtube.title);
    // Import and Connect are different things, said in one line.
    expect(out).toContain("Import reads your public posts; Connect lets us publish for you.");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("without Meta settings the Connect buttons are off and say that setup is pending", async () => {
    vi.stubEnv("META_APP_ID", "");
    vi.stubEnv("META_APP_SECRET", "");
    vi.stubEnv("INSTAGRAM_APP_ID", "");
    vi.stubEnv("INSTAGRAM_APP_SECRET", "");
    const out = await html();
    const cards = [...out.matchAll(/<section[^>]*data-connection="publish-[a-z]+"[\s\S]*?<\/section>/g)].map((m) => m[0]);
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card).toContain("Setup pending");
      expect(card).toContain("Connecting is not switched on yet");
      expect(card).toMatch(/<button[^>]*disabled/);
      expect(card).not.toContain("/api/connect/");
    }
  });

  it("with Meta settings each card links to its connect route and explains the account needed", async () => {
    vi.stubEnv("META_APP_ID", "123");
    vi.stubEnv("META_APP_SECRET", "secret-secret");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 5).toString("base64"));
    const out = await html();
    expect(out).toContain('href="/api/connect/instagram"');
    expect(out).toContain('href="/api/connect/facebook"');
    expect(out).toContain("Business or creator account needed");
    expect(out).toContain("Facebook Page needed");
    expect(out).not.toContain("Setup pending");
  });

  it("a connected account shows its name, when the permission ends, Reconnect and Disconnect", async () => {
    vi.stubEnv("META_APP_ID", "123");
    vi.stubEnv("META_APP_SECRET", "secret-secret");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 5).toString("base64"));
    await saveConnection({ brandId: brand, userId: owner, provider: "instagram", accountId: "17841400000000001", accountName: "@cornerbakery", scopes: [], platformUserId: null, expiresAt: new Date("2030-01-15T00:00:00Z"), token: "IGsecret-token-aaaaaaaaaaaaaaaaaaaa" });
    const out = await html();
    const card = out.match(/<section[^>]*data-connection="publish-instagram"[\s\S]*?<\/section>/)![0];
    expect(card).toContain("Connected");
    expect(card).toContain("Account: @cornerbakery");
    expect(card).toContain("15 Jan 2030");
    expect(card).toContain("Reconnect");
    expect(card).toContain("Disconnect");
    expect(out).not.toContain("IGsecret-token");
    // The Facebook card is still a plain Connect.
    expect(out.match(/<section[^>]*data-connection="publish-facebook"[\s\S]*?<\/section>/)![0]).not.toContain("Reconnect");
  });

  it("an expired connection asks to reconnect, and a connection ending soon warns", async () => {
    vi.stubEnv("META_APP_ID", "123");
    vi.stubEnv("META_APP_SECRET", "secret-secret");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 5).toString("base64"));
    await db.withAdmin((tx) => tx.query("update public.channel_connections set status = 'expired' where brand_id = $1", [brand]));
    expect(await html()).toContain("Needs reconnecting");
    await db.withAdmin((tx) => tx.query("update public.channel_connections set status = 'active', expires_at = now() + interval '3 days' where brand_id = $1", [brand]));
    expect(await html()).toContain("Reconnect to keep auto-posting");
  });

  it("only the owner sees the buttons", async () => {
    vi.stubEnv("META_APP_ID", "123");
    vi.stubEnv("META_APP_SECRET", "secret-secret");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 5).toString("base64"));
    const editor = (await createUser(db)).id;
    await db.withAdmin((tx) => tx.query("insert into public.brand_members (brand_id, user_id, role) values ($1, $2, 'editor')", [brand, editor]));
    jar.store.set(SESSION_COOKIE, await signSession({ id: editor, email: "editor@example.com" }));
    const out = await html();
    expect(out).toContain("Only the owner of the business can connect or disconnect.");
    expect(out).not.toContain("/api/connect/");
    expect(out).not.toContain("Disconnect?");
  });

  it("shows the result of a connect attempt", async () => {
    const render = async (sp: Record<string, string>) => renderToString((await Page({ searchParams: Promise.resolve(sp) })) as ReactElement).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'");
    expect(await render({ connected: "instagram" })).toContain("Connected. We can now post your approved designs there.");
    expect(await render({ connect_error: "personal_account" })).toContain("personal Instagram account");
    expect(await render({ connect_error: "nonsense" })).toContain("did not let us finish");
    expect(await render({ disconnected: "facebook" })).toContain("Disconnected.");
  });

  it("shows the Instagram name and import status that were saved", async () => {
    await saveInstagramHandle({ userId: owner, brandId: brand, handle: "@cornerbakery", source: "owner" });
    await db.withAdmin((tx) =>
      tx.query("update public.brand_memory set instagram_status = 'unavailable', instagram_checked_at = now() where brand_id = $1", [brand]),
    );
    const out = await html();
    expect(out).toContain('value="@cornerbakery"');
    expect(out).toContain(s.instagram.status.unavailable);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows the saved YouTube channel from the contact points, or points to the Brand page when there is none", async () => {
    expect(await html()).toContain(s.connections.youtube.none);
    expect(await html()).toContain('href="/brand#contacts"');
    await createContact(owner, brand, { kind: "youtube", value: "https://www.youtube.com/@cornerbakery" });
    const out = await html();
    expect(out).toContain("Your channel: @cornerbakery");
    expect(out).not.toContain(s.connections.youtube.none);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor to sign in and a new owner to setup", async () => {
    jar.store.clear();
    await expect(Page()).rejects.toThrow("REDIRECT:/login");
    jar.store.set(SESSION_COOKIE, await signSession({ id: newcomer, email: "new@example.com" }));
    await expect(Page()).rejects.toThrow("REDIRECT:/setup");
  });
});

/** The first element in a tree (not rendered: the Brand page has async server blocks) that has this prop. */
function findWithProp(node: ReactNode, prop: string): ReactElement<Record<string, unknown>> | null {
  let found: ReactElement<Record<string, unknown>> | null = null;
  Children.forEach(node, (child) => {
    if (found || !isValidElement(child)) return;
    const props = child.props as Record<string, unknown>;
    if (prop in props) found = child as ReactElement<Record<string, unknown>>;
    else found = findWithProp(props.children as ReactNode, prop);
  });
  return found;
}

describe("the Brand page header on phones", () => {
  it("links to Connections and the Mascot, which the four phone tabs do not include", async () => {
    const more = findWithProp((await BrandPage()) as ReactElement, "data-brand-more");
    expect(more).not.toBeNull();
    const out = renderToString(more as ReactElement);
    expect(out).toContain('href="/connections"');
    expect(out).toContain('href="/mascot"');
    expect(String(more!.props.className)).toContain("md:hidden");
  });
});
