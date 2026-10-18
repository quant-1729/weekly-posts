// What a demo session may not do (docs/15-demo-login.md "Refused"): each guarded entry point answers
// "Not available in the demo." on the server, and still works in a normal session of the same account.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const env = vi.hoisted(() => {
  const store = new Map<string, { value: string; options?: Record<string, unknown> }>();
  return {
    store,
    cookies: {
      get: (name: string) => (store.has(name) ? { name, value: store.get(name)!.value } : undefined),
      set: (name: string, value: string, options?: Record<string, unknown>) => void store.set(name, { value, options }),
      delete: (name: string) => void store.delete(name),
    },
  };
});
vi.mock("next/headers", () => ({ cookies: async () => env.cookies, headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import { requestAccountDeletionAction } from "@/app/(app)/brand/account-actions";
import { addPaymentIdAction, retirePaymentIdAction } from "@/app/(app)/brand/payment-actions";
import { createFaceAction, makeFaceOptionsAction, makeFacePosesAction, makeFaceSheetAction } from "@/app/(app)/brand/face-actions";
import { chooseFacebookPageAction, disconnectAction } from "@/app/(app)/connections/actions";
import PickPage from "@/app/(app)/connections/facebook/page";
import { GET as exportGET } from "@/app/api/account/export/route";
import { GET as connectCallback } from "@/app/api/connect/[provider]/callback/route";
import { GET as connectStart } from "@/app/api/connect/[provider]/route";
import { POST as confirmPayment } from "@/app/p/[token]/route";
import { requireAdmin } from "@/lib/admin/access";
import { resetRateLimits } from "@/lib/auth/rate-limit";
import { createMockAuth } from "@/lib/auth/mock";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { resetTokenKeyForTests } from "@/lib/connections/crypto";
import { listConnections, saveConnection } from "@/lib/connections/service";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { listOutbox, setOutboxDirForTests } from "@/lib/email/outbox";
import { s } from "@/lib/i18n/strings";
import { listPaymentIds } from "@/lib/payments";
import { stubMetaEnv } from "../connections/helpers";
import { signSession } from "../helpers/session";
import { DEMO_CODE, DEMO_EMAIL, locationOf, makeDemoOwner } from "./helpers";

const REFUSED = "Not available in the demo.";

let db: MockDb;
let owner: { userId: string; brandId: string };
let outbox: string;

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
  owner = await makeDemoOwner(db);
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});
beforeEach(async () => {
  env.store.clear();
  resetRateLimits();
  resetTokenKeyForTests();
  stubMetaEnv();
  vi.stubEnv("DEMO_LOGIN_EMAIL", DEMO_EMAIL);
  vi.stubEnv("DEMO_ACCESS_CODE", DEMO_CODE);
  outbox = await mkdtemp(path.join(os.tmpdir(), "pm-demo-outbox-"));
  setOutboxDirForTests(outbox);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  setOutboxDirForTests(null);
  await rm(outbox, { recursive: true, force: true });
});

/** The demo account, signed in from the demo page. */
async function asDemo() {
  env.store.clear();
  const user = await createMockAuth().startDemoSession(DEMO_EMAIL);
  expect(user?.demo).toBe(true);
}
/** The same account, signed in by a normal magic link (a plain session row). */
async function asNormal() {
  env.store.clear();
  env.store.set(SESSION_COOKIE, { value: await signSession({ id: owner.userId, email: DEMO_EMAIL }) });
}
/** Runs an action that ends in redirect() and returns where it went. */
async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (e) {
    const m = /^REDIRECT:(.*)$/.exec((e as Error).message);
    if (m) return m[1];
    throw e;
  }
  throw new Error("did not redirect");
}

describe("the refusal text", () => {
  it("is exactly 'Not available in the demo.'", () => {
    expect(s.demo.refused).toBe(REFUSED);
    expect(s.account.delete.errors.demo).toBe(REFUSED);
    expect(s.connections.errors.demo).toBe(REFUSED);
  });
});

describe("account delete and data export", () => {
  it("delete request: refused in a demo session (no email sent), works in a normal one", async () => {
    await asDemo();
    expect(await requestAccountDeletionAction()).toEqual({ ok: false, error: "demo" });
    expect(await listOutbox(5)).toHaveLength(0);

    await asNormal();
    expect(await requestAccountDeletionAction()).toMatchObject({ ok: true, email: DEMO_EMAIL });
    expect(await listOutbox(5)).toHaveLength(1);
  });

  it("export: 403 with the refusal in a demo session, a ZIP in a normal one", async () => {
    await asDemo();
    const refused = await exportGET();
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ ok: false, code: "demo", message: REFUSED });

    await asNormal();
    const ok = await exportGET();
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/zip");
    await ok.body?.cancel();
  });
});

describe("connecting and disconnecting Instagram and Facebook", () => {
  async function connect() {
    await saveConnection({
      brandId: owner.brandId,
      userId: owner.userId,
      provider: "instagram",
      accountId: "17841400000000001",
      accountName: "@demobakery",
      platformUserId: "17841400000000001",
      scopes: [],
      expiresAt: new Date("2030-01-01T00:00:00Z"),
      token: "IGAAdemo-token-123456789",
    });
  }
  const form = (provider: string) => {
    const f = new FormData();
    f.set("provider", provider);
    return f;
  };
  const connected = async () => (await listConnections(owner.userId, owner.brandId)).length;

  it("disconnect: refused in a demo session and the connection stays; works in a normal one", async () => {
    await connect();
    await asDemo();
    expect(await redirectOf(() => disconnectAction(form("instagram")))).toBe("/connections?connect_error=demo");
    expect(await connected()).toBe(1);

    await asNormal();
    expect(await redirectOf(() => disconnectAction(form("instagram")))).toBe("/connections?disconnected=instagram");
    expect(await connected()).toBe(0);
  });

  it("choosing a Facebook Page and the Page picker: refused in a demo session", async () => {
    await asDemo();
    const f = new FormData();
    f.set("page", "1001");
    expect(await redirectOf(() => chooseFacebookPageAction(f))).toBe("/connections?connect_error=demo");
    expect(await redirectOf(() => PickPage())).toBe("/connections?connect_error=demo");
  });

  it("the Connect route and its callback: refused in a demo session, the start works in a normal one", async () => {
    const ctx = { params: Promise.resolve({ provider: "instagram" }) };
    await asDemo();
    const start = await connectStart(new NextRequest("https://app.example.com/api/connect/instagram"), ctx);
    expect(locationOf(start)).toBe("/connections?connect_error=demo");
    expect(start.headers.getSetCookie().some((c) => c.startsWith("pm_connect_nonce="))).toBe(false);
    const back = await connectCallback(new NextRequest("https://app.example.com/api/connect/instagram/callback?code=abc&state=xyz"), ctx);
    expect(locationOf(back)).toBe("/connections?connect_error=demo");
    expect(await connected()).toBe(0);

    await asNormal();
    const ok = await connectStart(new NextRequest("https://app.example.com/api/connect/instagram"), ctx);
    expect(new URL(ok.headers.get("location")!).host).toBe("www.instagram.com");
  });
});

describe("payment QR", () => {
  const input = { scheme: "upi", address: "demo.baker@okhdfcbank", payeeName: "Demo Baker" };

  it("create and retire: refused in a demo session, work in a normal one", async () => {
    await asDemo();
    expect(await addPaymentIdAction(owner.brandId, input)).toEqual({ ok: false, message: REFUSED });
    expect(await listPaymentIds(owner.userId, owner.brandId)).toHaveLength(0);
    expect(await listOutbox(5)).toHaveLength(0);

    await asNormal();
    const added = await addPaymentIdAction(owner.brandId, input);
    expect(added).toMatchObject({ ok: true });
    const id = (added as { payment: { id: string } }).payment.id;
    expect(await listOutbox(5)).toHaveLength(1);

    await asDemo();
    expect(await retirePaymentIdAction(owner.brandId, id)).toEqual({ ok: false, message: REFUSED });
    expect((await listPaymentIds(owner.userId, owner.brandId)).find((p) => p.id === id)?.status).not.toBe("retired");

    await asNormal();
    expect(await retirePaymentIdAction(owner.brandId, id)).toEqual({ ok: true });
  });

  it("the emailed confirm link does nothing in a demo session", async () => {
    const post = () =>
      confirmPayment(new NextRequest("http://localhost:3000/p/sometoken", { method: "POST", body: new URLSearchParams({ nonce: "x" }) }), {
        params: Promise.resolve({ token: "sometoken" }),
      });
    await asDemo();
    const refused = await post();
    expect(refused.status).toBe(403);
    expect(await refused.text()).toContain(REFUSED);

    await asNormal();
    const normal = await post(); // gets past the guard and fails on the missing nonce cookie instead
    expect(normal.status).toBe(403);
    expect(await normal.text()).not.toContain(REFUSED);
  });
});

describe("Brand Face paid steps", () => {
  const usage = async () => (await db.withAdmin((tx) => tx.query("select 1 from public.usage_events where brand_id = $1", [owner.brandId]))).length;
  const faces = async () => (await db.withAdmin((tx) => tx.query("select 1 from public.brand_faces where brand_id = $1", [owner.brandId]))).length;

  it("making options, the sheet and the poses are refused in a demo session before anything runs", async () => {
    await asNormal();
    const created = await createFaceAction({ kind: "illustrated", name: "Mia", description: "A friendly baker in a green apron", style: "flat" });
    if (!created.ok) throw new Error(created.message);
    const faceId = created.face.id;

    await asDemo();
    const results = [await makeFaceOptionsAction(faceId, 1), await makeFaceSheetAction(faceId, 1), await makeFacePosesAction(faceId, ["front"], 1)];
    for (const r of results) expect(r).toMatchObject({ ok: false, message: REFUSED });
    expect(await usage()).toBe(0);

    // A normal session gets past the guard: these calls fail for another reason (no approved price / no options yet).
    await asNormal();
    const normal = [await makeFaceOptionsAction(faceId, 0), await makeFaceSheetAction(faceId, 0), await makeFacePosesAction(faceId, ["front"], 0)];
    for (const r of normal) {
      expect(r.ok).toBe(false);
      expect((r as { message: string }).message).not.toBe(REFUSED);
    }
    expect(await usage()).toBe(0);
  });

  it("the free steps stay open in a demo session (a draft face can be started)", async () => {
    await asDemo();
    const before = await faces();
    const created = await createFaceAction({ kind: "illustrated", name: "Leo", description: "A cheerful baker with a flat cap", style: "flat" });
    expect(created.ok).toBe(true);
    expect(await faces()).toBe(before + 1);
  });
});

describe("admin pages", () => {
  it("a demo session gets a 404 even when its email is an admin email; a normal session is let in", async () => {
    vi.stubEnv("ADMIN_EMAILS", DEMO_EMAIL);
    await asDemo();
    await expect(requireAdmin()).rejects.toThrow("NOT_FOUND");
    await asNormal();
    await expect(requireAdmin()).resolves.toMatchObject({ isAdmin: true, email: DEMO_EMAIL });
  });
});
