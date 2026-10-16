import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildExport, exportFileName } from "@/lib/account/export";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import type { Storage } from "@/lib/storage";
import { createMockStorage } from "@/lib/storage/mock";
import { newUser } from "./helpers";
import { seedAccount, type SeededAccount } from "./seed";
import { collect, parseZip } from "./zip-read";

let db: MockDb;
let root: string;
let storage: Storage;

beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "pm-export-"));
  storage = createMockStorage(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const NOW = new Date("2026-10-13T09:30:00Z");
const text = (z: Map<string, Uint8Array>, name: string) => new TextDecoder().decode(z.get(name));
const jsonOf = (z: Map<string, Uint8Array>, name: string) => JSON.parse(text(z, name));

/** Where each seeded file must land in the ZIP. */
function expectedFiles(a: SeededAccount): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const f of a.files) {
    const rel = f.path.slice(a.brandId.length + 1);
    let name: string;
    if (f.bucket === "brand-assets") name = "logo.png";
    else if (f.bucket === "photos") name = rel.startsWith(a.pastPostId) ? `photos/past-posts/${rel}` : `photos/${rel}`;
    else if (f.bucket === "renders") {
      const [postId, file] = rel.split("/");
      name = `renders/${a.postCodes[a.postIds.indexOf(postId)]}/${file}`;
    } else name = `${f.bucket}/${rel}`;
    out.set(name, f.bytes);
  }
  return out;
}

describe("buildExport", () => {
  it("is a valid ZIP (central directory and every CRC) holding every listed file", async () => {
    const a = await seedAccount(db, storage);
    const zip = parseZip(await collect(await buildExport(a.userId, { storage, now: NOW })));

    const jsonFiles = ["account.json", "brand.json", "facts.json", "photos.json", "posts.json", "actions.json", "checkins.json", "clicks.json", "owner-dates.json", "emails.json", "sessions.json", "usps.json", "contact-points.json", "post-briefs.json", "payment-ids.json", "connections.json", "queue.json", "queue-settings.json", "insights.json", "competitors.json", "research.json"];
    const files = expectedFiles(a);
    expect(zip.names.slice().sort()).toEqual(["README.txt", ...jsonFiles, ...files.keys()].sort());
    expect(zip.names).not.toContain("MISSING-FILES.txt");
    expect(zip.names[0]).toBe("README.txt");
    // The names the task lists.
    for (const name of ["logo.png", `photos/${a.photoId}.jpg`, `photos/past-posts/${a.pastPostId}.jpg`, `renders/${a.postCodes[0]}/square.png`, `renders/${a.postCodes[0]}/vertical.png`, `renders/${a.postCodes[0]}/landscape.png`]) {
      expect(zip.names).toContain(name);
    }

    // Photos and every other file are byte-identical to storage.
    for (const [name, bytes] of files) expect(Buffer.from(zip.files.get(name)!).equals(bytes), name).toBe(true);
    for (const f of a.files) {
      const stored = await storage.get(f.bucket, f.path);
      expect(Buffer.from(stored!.bytes).equals(f.bytes)).toBe(true);
    }

    const readme = text(zip.files, "README.txt");
    for (const name of [...jsonFiles, "logo.png", "photos/", "renders/"]) expect(readme).toContain(name);
  });

  it("writes the JSON the task lists", async () => {
    const a = await seedAccount(db, storage);
    const { files: z } = parseZip(await collect(await buildExport(a.userId, { storage, now: NOW })));

    const account = jsonOf(z, "account.json");
    expect(account.email).toBe(a.email);
    expect(typeof account.created_at).toBe("string");

    const brand = jsonOf(z, "brand.json");
    expect(brand.brand.name).toBe(a.name);
    expect(brand.brand_memory.business_name).toBe(a.name);
    expect(brand.brand_memory.logo_path).toBe(`brand-assets/${a.brandId}/logo.png`);
    expect(brand.mascots).toHaveLength(1);
    expect(brand.voice_feedback.map((v: { instruction: string }) => v.instruction)).toEqual(["shorter please"]);

    // All facts, including the one the owner removed, each with its source.
    const facts = jsonOf(z, "facts.json");
    expect(facts).toHaveLength(3);
    expect(facts.filter((f: { active: boolean }) => !f.active)).toHaveLength(1);
    const price = facts.find((f: { kind: string }) => f.kind === "price");
    expect(price).toMatchObject({ source_type: "website", source_ref: "https://bakery.example.com/menu", source_quote: "Sourdough £4.50", value: "£4.50" });

    const photos = jsonOf(z, "photos.json");
    expect(photos).toHaveLength(4);
    expect(photos.find((p: { id: string }) => p.id === a.pastPostId)).toMatchObject({ kind: "past_post", extracted_text: "Fresh bread today", file: `photos/past-posts/${a.pastPostId}.jpg` });
    expect(photos.find((p: { extracted_text: string }) => p.extracted_text === "Pasted caption about cake").file).toBeNull();

    const posts = jsonOf(z, "posts.json");
    expect(posts).toHaveLength(2);
    const first = posts.find((p: { post_code: string }) => p.post_code === a.postCodes[0]);
    expect(first).toMatchObject({ status: "approved", cta: "Come in", hashtags: ["#bread"] });
    expect(first.caption).toContain("Caption number 0");
    expect(first.fact_flags[0]).toMatchObject({ kind: "price", status: "open" });
    expect(first.approved_at).toBeTruthy();
    expect(first.created_at).toBeTruthy();
    expect(first.post_images.map((i: { format: string }) => i.format).sort()).toEqual(["landscape", "square", "vertical"]);
    expect(first.post_images[0].image_path).toContain(`renders/${a.brandId}/`);
    const second = posts.find((p: { post_code: string }) => p.post_code === a.postCodes[1]);
    expect(second.outputs).toHaveLength(1);

    expect(jsonOf(z, "actions.json").map((r: { action: string; post_code: string }) => [r.action, r.post_code])).toEqual([
      ["approve", a.postCodes[0]],
      ["share", a.postCodes[0]],
    ]);
    expect(jsonOf(z, "checkins.json")).toHaveLength(1);
    expect(jsonOf(z, "owner-dates.json")).toHaveLength(1);
    expect(jsonOf(z, "owner-dates.json")[0]).toMatchObject({ name: "Shop birthday", yearly: true });

    // Clicks: counts per post, and no user agents.
    const clicks = jsonOf(z, "clicks.json");
    expect(clicks.map((c: { post_code: string; clicks: number }) => [c.post_code, c.clicks]).sort()).toEqual(
      [
        [a.postCodes[0], 3],
        [a.postCodes[1], 0],
      ].sort(),
    );
    expect(text(z, "clicks.json")).not.toMatch(/user_agent|secret-agent|Mozilla/);

    // Emails: kind, subject, date and status only. Brandless ones for this user (delete confirmation,
    // other account emails) are included now (email_log_select_own); never the body or the address.
    const emails = jsonOf(z, "emails.json");
    expect(emails.map((e: { kind: string }) => e.kind).sort()).toEqual(["account_delete", "magic_link", "reminder", "weekly"]);
    expect(emails.map((e: { subject: string }) => e.subject)).toContain("Confirm delete");
    for (const e of emails) expect(Object.keys(e).sort()).toEqual(["created_at", "kind", "status", "subject"]);
    expect(text(z, "emails.json")).not.toContain(a.email);
  });

  it("includes only the owner's data, even when another account exists", async () => {
    const a = await seedAccount(db, storage);
    const b = await seedAccount(db, storage);
    const zipA = parseZip(await collect(await buildExport(a.userId, { storage, now: NOW })));

    const everything = [...zipA.files.entries()].filter(([n]) => n.endsWith(".json") || n.endsWith(".txt")).map(([, v]) => new TextDecoder().decode(v)).join("\n");
    for (const secret of [b.brandId, b.userId, b.email, b.name, ...b.postCodes, ...b.postIds, b.photoId, b.mascotId]) {
      expect(everything).not.toContain(secret);
    }
    for (const name of zipA.names) for (const secret of [b.photoId, b.pastPostId, b.postCodes[0], b.mascotId]) expect(name).not.toContain(secret);
    const bBytes = b.files.map((f) => f.bytes);
    for (const [, data] of zipA.files) expect(bBytes.some((x) => x.equals(Buffer.from(data)))).toBe(false);

    // And B's own export is B's.
    const zipB = parseZip(await collect(await buildExport(b.userId, { storage, now: NOW })));
    expect(jsonOf(zipB.files, "account.json").email).toBe(b.email);
    expect(zipB.names).toContain(`photos/${b.photoId}.jpg`);
    expect(zipB.names).not.toContain(`photos/${a.photoId}.jpg`);
  });

  it("will not export a file outside the user's own brands, even if a row points at one", async () => {
    const a = await seedAccount(db, storage);
    const b = await seedAccount(db, storage);
    const stolen = b.files.find((f) => f.bucket === "photos")!;
    const rowId = randomUUID();
    await db.withAdmin((tx) =>
      tx.query("insert into public.photos (id, brand_id, kind, storage_path) values ($1, $2, 'photo', $3)", [rowId, a.brandId, `photos/${stolen.path}`]),
    );
    const zip = parseZip(await collect(await buildExport(a.userId, { storage, now: NOW })));
    for (const [, data] of zip.files) expect(Buffer.from(data).equals(stolen.bytes)).toBe(false);
    expect(zip.names).not.toContain(`photos/${rowId}.jpg`);
    expect(text(zip.files, "MISSING-FILES.txt")).toContain("path not usable");
  });

  it("lists a file that is missing from storage instead of failing", async () => {
    const a = await seedAccount(db, storage);
    await storage.remove("photos", `${a.brandId}/${a.photoId}.jpg`);
    const zip = parseZip(await collect(await buildExport(a.userId, { storage, now: NOW })));
    expect(zip.names).not.toContain(`photos/${a.photoId}.jpg`);
    expect(text(zip.files, "MISSING-FILES.txt")).toContain(`photos/${a.photoId}.jpg`);
    expect(zip.names).toContain(`photos/${a.photo2Id}.jpg`);
  });

  it("reads files one at a time, only as the stream is read, and stops when it is cancelled", async () => {
    const a = await seedAccount(db, storage);
    let live = 0;
    let maxLive = 0;
    let gets = 0;
    const counting: Storage = {
      ...storage,
      async get(bucket, p) {
        gets += 1;
        live += 1;
        maxLive = Math.max(maxLive, live);
        try {
          return await storage.get(bucket, p);
        } finally {
          live -= 1;
        }
      },
    };
    const stream = await buildExport(a.userId, { storage: counting, now: NOW });
    expect(gets).toBe(0); // building the export reads rows, not files
    const reader = stream.getReader();
    await reader.read(); // README header
    await reader.read(); // README data
    expect(gets).toBe(0);
    await reader.cancel(); // the download was dropped
    expect(gets).toBe(0);

    const full = await buildExport(a.userId, { storage: counting, now: NOW });
    await collect(full);
    expect(gets).toBe(a.files.length);
    expect(maxLive).toBe(1);
  });

  it("exports selling points, contacts, briefs and payment IDs, never a payment confirmation secret", async () => {
    const a = await seedAccount(db, storage);
    await db.withAdmin(async (tx) => {
      await tx.query(
        `insert into public.payment_ids (brand_id, scheme, address, payee_name, confirm_token_hash, confirm_expires_at)
         values ($1, 'upi', 'shop@okbank', 'Corner Bakery', 'SECRET-TOKEN-HASH', now() + interval '1 day')`,
        [a.brandId],
      );
    });
    const zip = parseZip(await collect(await buildExport(a.userId, { storage, now: NOW })));
    const usps = jsonOf(zip.files, "usps.json");
    expect(usps.map((u: { title: string }) => u.title)).toEqual(["20% off cakes", "Family run"]);
    expect(usps[0]).toMatchObject({ kind: "discount", details: { percent: 20 } });
    expect(jsonOf(zip.files, "contact-points.json").map((c: { value: string }) => c.value).sort()).toEqual(["+442079460958", "https://bakery.example.com"]);
    const briefs = jsonOf(zip.files, "post-briefs.json");
    expect(briefs).toHaveLength(1);
    expect(briefs[0]).toMatchObject({ post_type: "offer", cta: "visit", photo_id: a.photoId });
    expect(briefs[0]).toHaveProperty("extra_post_types");
    expect(briefs[0]).toMatchObject({ content_format: "post", slide_count: null });
    const pay = jsonOf(zip.files, "payment-ids.json");
    expect(pay).toHaveLength(1);
    expect(pay[0]).toMatchObject({ address: "shop@okbank", payee_name: "Corner Bakery", status: "pending" });
    expect(Object.keys(pay[0])).not.toContain("confirm_token_hash");
    expect(Object.keys(pay[0])).not.toContain("confirm_expires_at");
    for (const bytes of zip.files.values()) expect(new TextDecoder().decode(bytes)).not.toContain("SECRET-TOKEN-HASH");
  });

  it("an account with no business still exports its account file", async () => {
    const userId = await newUser(db, `empty-${randomUUID().slice(0, 6)}@example.com`);
    const zip = parseZip(await collect(await buildExport(userId, { storage, now: NOW })));
    expect(zip.names.sort()).toEqual(["README.txt", "account.json", "emails.json", "sessions.json"]);
  });

  it("puts each business in its own folder when the account has more than one", async () => {
    const a = await seedAccount(db, storage);
    const [{ id: second }] = await db.withUser(a.userId, (tx) => tx.query<{ id: string }>("select public.create_brand('Second Shop') as id"));
    const zip = parseZip(await collect(await buildExport(a.userId, { storage, now: NOW })));
    expect(zip.names).toContain("account.json");
    expect(zip.names).toContain(`second-shop-${second.slice(0, 8)}/facts.json`);
    expect(zip.names.some((n) => n.endsWith(`-${a.brandId.slice(0, 8)}/facts.json`))).toBe(true);
    expect(zip.names).not.toContain("facts.json");
  });

  it("names the download weekly-posts-export-{date}.zip", () => {
    expect(exportFileName(NOW)).toBe("weekly-posts-export-2026-10-13.zip");
  });

  it("rejects a malformed user id", async () => {
    await expect(buildExport("nope", { storage })).rejects.toThrow("Invalid user id");
  });
});

describe("export reads rows as the user (row-level security)", () => {
  it("a user who is not a member sees none of the brand's rows through withUser", async () => {
    const a = await seedAccount(db, storage);
    const outsider = await newUser(db, `outsider-${randomUUID().slice(0, 6)}@example.com`);
    const zip = parseZip(await collect(await buildExport(outsider, { storage, now: NOW })));
    expect(zip.names.sort()).toEqual(["README.txt", "account.json", "emails.json", "sessions.json"]);
    expect([...zip.files.values()].some((v) => new TextDecoder().decode(v).includes(a.brandId))).toBe(false);
  });
});
