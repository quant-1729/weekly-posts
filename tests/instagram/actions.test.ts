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
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));
// The voice refresh that follows an import is debounced and calls the model; it is not what these tests are about.
vi.mock("@/lib/uploads/background", () => ({ scheduleVoiceRefresh: vi.fn() }));
vi.mock("@/lib/instagram/discovery", async (orig) => {
  const real = await orig<typeof import("@/lib/instagram/discovery")>();
  return { ...real, discoverInstagram: vi.fn(real.discoverInstagram) };
});

import {
  addInstagramPhotosAction,
  importInstagramAction,
  loadInstagramImagesAction,
  refreshInstagramAction,
  removeInstagramPostsAction,
} from "@/components/instagram/actions";
import { startInstagramImportAction } from "@/components/instagram/setup-actions";
import { UploadsSection } from "@/components/uploads/uploads-section";
import { renderToString } from "react-dom/server";
import type { ReactElement } from "react";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { signSession } from "../helpers/session";
import type { MockDb } from "@/lib/db/mock";
import { clearInstagramCache, getInstagramState } from "@/lib/instagram/import";
import { discoverInstagram } from "@/lib/instagram/discovery";
import { s } from "@/lib/i18n/strings";
import { scheduleVoiceRefresh } from "@/lib/uploads/background";
import { getCurrentBrand } from "@/lib/brand/current";
import { listPastPosts } from "@/lib/uploads/past-posts";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";

let db: MockDb;
let owner: string;
let brand: string;

async function signIn(userId: string | null) {
  if (userId === null) jar.store.delete(SESSION_COOKIE);
  else jar.store.set(SESSION_COOKIE, await signSession({ id: userId, email: `${userId.slice(0, 6)}@example.com` }));
}

async function waitFor<T>(fn: () => Promise<T | null | false>, ms = 4000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  db = await openTestDb();
  owner = (await createUser(db)).id;
  brand = await createBrandFor(db, owner, "Corner Bakery");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeTestDb(db);
});
beforeEach(async () => {
  vi.stubEnv("INSTAGRAM_MODE", "fixture");
  clearInstagramCache();
  vi.mocked(scheduleVoiceRefresh).mockClear();
  await signIn(owner);
  await db.withAdmin(async (tx) => {
    await tx.query("delete from public.photos where brand_id = $1", [brand]);
    await tx.query(
      "update public.brand_memory set instagram_handle = null, instagram_handle_source = null, instagram_status = null, instagram_checked_at = null where brand_id = $1",
      [brand],
    );
  });
});
afterEach(() => {
  vi.mocked(discoverInstagram).mockClear();
});

describe("the brand page actions", () => {
  it("import: reads the @name, adds the posts and hands back the state and the pictures", async () => {
    const r = await importInstagramAction(brand, "https://www.instagram.com/Sample.Bakery/?hl=en");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state).toMatchObject({ handle: "sample.bakery", handleSource: "owner", status: "imported", importedPosts: 12, available: true });
    expect(r.images.length).toBeGreaterThan(5);
    expect(vi.mocked(scheduleVoiceRefresh)).toHaveBeenCalledWith(owner, brand); // the same voice refresh pasted posts use
  });

  it("import: a bad @name is turned back with plain words, without calling Instagram", async () => {
    const r = await importInstagramAction(brand, "https://www.instagram.com/p/abc/");
    expect(r).toMatchObject({ ok: false, message: s.instagram.invalidHandle });
    expect(vi.mocked(discoverInstagram)).not.toHaveBeenCalled();
  });

  it("import: a personal account is recorded as such and adds nothing", async () => {
    const r = await importInstagramAction(brand, "@personal.shop");
    expect(r.ok && r.state).toMatchObject({ status: "not_business", importedPosts: 0, handle: "personal.shop" });
    expect(r.ok && r.images).toEqual([]);
  });

  it("signed out: nothing happens", async () => {
    await signIn(null);
    expect(await importInstagramAction(brand, "@sample.bakery")).toMatchObject({ ok: false, code: "signed_out" });
    expect(await refreshInstagramAction(brand)).toMatchObject({ ok: false, code: "signed_out" });
    expect(await removeInstagramPostsAction(brand)).toMatchObject({ ok: false, code: "signed_out" });
    expect(await loadInstagramImagesAction(brand)).toMatchObject({ ok: false, code: "signed_out" });
    expect(await addInstagramPhotosAction(brand, ["1"])).toMatchObject({ ok: false, code: "signed_out" });
    expect(vi.mocked(discoverInstagram)).not.toHaveBeenCalled();
  });

  it("another person's brand is refused", async () => {
    const stranger = (await createUser(db)).id;
    await signIn(stranger);
    expect(await importInstagramAction(brand, "@sample.bakery")).toMatchObject({ ok: false, code: "not_found" });
    expect(await removeInstagramPostsAction(brand)).toMatchObject({ ok: false, code: "not_found" });
  });

  it("refresh: reads the saved handle, but not twice within 30 seconds (Meta's limit is shared by every owner)", async () => {
    await importInstagramAction(brand, "@sample.bakery");
    expect(vi.mocked(discoverInstagram)).toHaveBeenCalledTimes(1);
    const soon = await refreshInstagramAction(brand);
    expect(soon.ok && soon.state.status).toBe("imported");
    expect(vi.mocked(discoverInstagram)).toHaveBeenCalledTimes(1); // too soon: answered from the saved read
    expect(soon.ok && soon.images.length).toBeGreaterThan(0);

    await db.withAdmin((tx) => tx.query("update public.brand_memory set instagram_checked_at = now() - interval '2 minutes' where brand_id = $1", [brand]));
    await refreshInstagramAction(brand);
    expect(vi.mocked(discoverInstagram)).toHaveBeenCalledTimes(2);
  });

  it("refresh with no handle saved does nothing", async () => {
    const r = await refreshInstagramAction(brand);
    expect(r.ok && r.state.handle).toBeNull();
    expect(vi.mocked(discoverInstagram)).not.toHaveBeenCalled();
  });

  it("add photos: stores the picked ones and says which are now in the library", async () => {
    const imported = await importInstagramAction(brand, "@sample.bakery");
    if (!imported.ok) throw new Error("import failed");
    const ids = imported.images.slice(0, 2).map((i) => i.mediaId);
    const r = await addInstagramPhotosAction(brand, ids);
    expect(r.ok && r.photos).toHaveLength(2);
    expect(r.ok && r.failed).toBe(0);
    expect(r.ok && r.images.filter((i) => i.added).map((i) => i.mediaId).sort()).toEqual([...ids].sort());
    // Garbage in the list is ignored, not trusted.
    const bad = await addInstagramPhotosAction(brand, ["https://evil.example/x.jpg", 5 as unknown as string]);
    expect(bad.ok && bad.photos).toEqual([]);
  });

  it("remove: deletes the imported posts and keeps the @name", async () => {
    await importInstagramAction(brand, "@sample.bakery");
    const r = await removeInstagramPostsAction(brand);
    expect(r.ok && r.state).toMatchObject({ handle: "sample.bakery", importedPosts: 0, status: "found" });
    expect(await listPastPosts(owner, brand)).toHaveLength(0);
  });
});

describe("the Photos and past posts section", () => {
  it("shows the Instagram card with the saved name, imported posts tagged, and makes no Instagram call while rendering", async () => {
    await importInstagramAction(brand, "@sample.bakery");
    vi.mocked(discoverInstagram).mockClear();
    const html = renderToString((await UploadsSection({ userId: owner, brandId: brand, voice: false, heading: false })) as ReactElement)
      .replace(/<!-- -->/g, "")
      .replace(/&#x27;/g, "'");
    expect(html).toContain(s.instagram.title);
    expect(html).toContain('value="@sample.bakery"');
    expect(html).toContain("12 posts from @sample.bakery added to your past posts");
    expect(html.split(s.instagram.tag).length - 1).toBe(12);
    expect(html).not.toContain("<img src=\"data:"); // no Instagram pictures until the owner asks for them
    expect(vi.mocked(discoverInstagram)).not.toHaveBeenCalled();
  });
});

describe("setup: the optional Instagram name", () => {
  async function freshOwner() {
    const u = await createUser(db);
    await signIn(u.id);
    return u.id;
  }

  it("saves the name at once and starts the import in the background; setup does not wait for the read", async () => {
    const user = await freshOwner();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const real = await vi.importActual<typeof import("@/lib/instagram/discovery")>("@/lib/instagram/discovery");
    vi.mocked(discoverInstagram).mockImplementationOnce(async (handle, opts) => {
      await gate; // Instagram is slow
      return real.discoverInstagram(handle, opts);
    });

    const t0 = Date.now();
    const res = await startInstagramImportAction({ businessName: "Fresh Loaf", handle: "@sample.loaf" });
    expect(res).toEqual({ ok: true });
    expect(Date.now() - t0).toBeLessThan(2000); // returned while the read is still waiting

    const b = await getCurrentBrand(user);
    expect(b).not.toBeNull();
    const early = await getInstagramState(user, b!.id);
    expect(early).toMatchObject({ handle: "sample.loaf", handleSource: "owner", importedPosts: 0 });
    expect(early.status).not.toBe("imported");

    release();
    const done = await waitFor(async () => {
      const st = await getInstagramState(user, b!.id);
      return st.status === "imported" ? st : null;
    });
    expect(done.importedPosts).toBe(12);
  });

  it("never fails setup: a bad name, no sign-in, or a broken read all end quietly", async () => {
    await freshOwner();
    expect(await startInstagramImportAction({ businessName: "X", handle: "not a handle!" })).toEqual({ ok: false });
    expect(await startInstagramImportAction({ businessName: "X", handle: "https://www.instagram.com/p/abc/" })).toEqual({ ok: false });
    await signIn(null);
    expect(await startInstagramImportAction({ businessName: "X", handle: "@sample.loaf" })).toEqual({ ok: false });

    const user = await freshOwner();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(discoverInstagram).mockImplementationOnce(async () => {
      throw new Error("Instagram exploded");
    });
    expect(await startInstagramImportAction({ businessName: "Broken Loaf", handle: "sample.loaf" })).toEqual({ ok: true });
    const b = await getCurrentBrand(user);
    const st = await waitFor(async () => {
      const x = await getInstagramState(user, b!.id);
      return x.status === "failed" ? x : null;
    });
    expect(st.handle).toBe("sample.loaf");
    quiet.mockRestore();
  });

  it("without Meta settings it still saves the name and shows the fallback state", async () => {
    vi.stubEnv("INSTAGRAM_MODE", "");
    vi.stubEnv("INSTAGRAM_LOOKUP_USER_ID", "");
    vi.stubEnv("INSTAGRAM_LOOKUP_TOKEN", "");
    const user = await freshOwner();
    expect(await startInstagramImportAction({ businessName: "Quiet Loaf", handle: "@sample.loaf" })).toEqual({ ok: true });
    const b = await getCurrentBrand(user);
    const st = await waitFor(async () => {
      const x = await getInstagramState(user, b!.id);
      return x.status === "unavailable" ? x : null;
    });
    expect(st).toMatchObject({ handle: "sample.loaf", available: false, importedPosts: 0 });
  });
});
