import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

import { DELETE, POST } from "@/app/api/brand/logo/route";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { signSession } from "../helpers/session";
import type { MockDb } from "@/lib/db/mock";
import { setStorageForTests } from "@/lib/storage";
import { createMockStorage } from "@/lib/storage/mock";
import type { Storage } from "@/lib/storage/types";
import { closeTestDb, createBrandFor, createUser, openTestDb } from "../brand/helpers";

let db: MockDb;
let root: string;
let storage: Storage;
let owner: string;
let brand: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "pm-logo-route-"));
  storage = createMockStorage(root);
  setStorageForTests(storage);
  db = await openTestDb();
  owner = (await createUser(db)).id;
  brand = await createBrandFor(db, owner, "Corner Bakery");
  jar.store.set(SESSION_COOKIE, await signSession({ id: owner, email: "owner@example.com" }));
});
afterAll(async () => {
  setStorageForTests(null);
  await closeTestDb(db);
  await rm(root, { recursive: true, force: true });
});

async function logoOnWhite(size: number): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="#fff"/><rect x="${size * 0.2}" y="${size * 0.2}" width="${size * 0.6}" height="${size * 0.6}" fill="#B5121B"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function post(bytes: Buffer) {
  const form = new FormData();
  form.set("brand_id", brand);
  form.set("file", new File([new Uint8Array(bytes)], "logo.png", { type: "image/png" }));
  return POST(new Request("http://localhost/api/brand/logo", { method: "POST", body: form }) as never);
}

describe("POST /api/brand/logo", () => {
  it("still saves the logo and the palette, and now reports size and background", async () => {
    const res = await post(await logoOnWhite(240));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, logoPath: `brand-assets/${brand}/logo.png` });
    expect(body.palette.primary).toMatch(/^#[0-9A-F]{6}$/);
    expect(body.report).toMatchObject({ width: 240, height: 240, lowResolution: true, background: "removed", active: "without_background" });
    expect(await storage.get("brand-assets", `${brand}/logo-original.png`)).not.toBeNull();
  });

  it("rejects what it always rejected", async () => {
    const res = await post(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"));
    expect(res.status).toBe(400);
    expect((await res.json()).ok).toBe(false);
  });

  it("removing the logo also removes the stored versions", async () => {
    const res = await DELETE({ nextUrl: new URL(`http://localhost/api/brand/logo?brand_id=${brand}`) } as never);
    expect((await res.json()).ok).toBe(true);
    for (const name of ["logo.png", "logo-original.png", "logo-clean.png"]) expect(await storage.get("brand-assets", `${brand}/${name}`)).toBeNull();
  });
});
