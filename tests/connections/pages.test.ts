import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { ReactElement } from "react";

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

import MetaDeletionPage from "@/app/meta/deletion/[code]/page";
import PickPage from "@/app/(app)/connections/facebook/page";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { signSession } from "../helpers/session";
import { resetTokenKeyForTests } from "@/lib/connections/crypto";
import { handleDataDeletion } from "@/lib/connections/deletion";
import { sealPending } from "@/lib/connections/facebook";
import type { MockDb } from "@/lib/db/mock";
import { closeDb, fakeFetch, makeOwner, openDb, stubMetaEnv, when, type Owner } from "./helpers";

let db: MockDb;
let owner: Owner;

beforeAll(async () => {
  db = await openDb();
});
afterAll(async () => {
  await closeDb(db);
});
beforeEach(async () => {
  stubMetaEnv();
  resetTokenKeyForTests();
  owner = await makeOwner(db);
  jar.store.clear();
  jar.store.set(SESSION_COOKIE, await signSession({ id: owner.userId, email: "o@example.com" }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const render = async (el: Promise<ReactElement> | ReactElement) => renderToString(await el).replace(/<!-- -->/g, "");

describe("the public deletion status page", () => {
  it("shows done for a real code and says nothing about the account", async () => {
    const { confirmation_code } = await handleDataDeletion({ userId: "5555", provider: "facebook" });
    const out = await render(MetaDeletionPage({ params: Promise.resolve({ code: confirmation_code }) }));
    expect(out).toContain('data-deletion-status="done"');
    expect(out).toContain("Data deletion request");
    expect(out).not.toContain("5555");
  });

  it("says it cannot find an unknown code", async () => {
    const out = await render(MetaDeletionPage({ params: Promise.resolve({ code: "abcdefghijklmnopqrstuvwx" }) }));
    expect(out).toContain('data-deletion-status="unknown"');
  });
});

describe("the Facebook Page picker", () => {
  it("lists the Pages by name only", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch([when("GET", /\/me\/accounts$/, { body: { data: [{ id: "1", name: "Corner Bakery", access_token: "EAAsecretPageTokenAAAA" }, { id: "2", name: "Corner Cafe", access_token: "EAAsecretPageTokenBBBB" }] } })]).fetch,
    );
    jar.store.set("pm_fb_pending", sealPending({ brandId: owner.brandId, userId: owner.userId, fbUserId: "4242", userToken: "EAAUserToken1234567890" }));
    const out = await render(PickPage());
    expect(out).toContain("Choose your Facebook Page");
    expect(out).toContain("Corner Bakery");
    expect(out).toContain("Corner Cafe");
    expect(out).toContain('name="page"');
    expect(out).not.toContain("EAAsecret");
    expect(out).not.toContain("EAAUserToken");
  });

  it("sends the owner back to Connections when the wait has expired or was never started", async () => {
    await expect(PickPage()).rejects.toThrow("REDIRECT:/connections?connect_error=pending_expired");
  });

  it("sends a signed-out visitor to sign in", async () => {
    jar.store.clear();
    await expect(PickPage()).rejects.toThrow("REDIRECT:/login");
  });
});
