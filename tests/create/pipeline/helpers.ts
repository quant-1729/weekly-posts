import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createBrief } from "@/lib/briefs/service";
import type { Brief } from "@/lib/briefs/types";
import { createContact } from "@/lib/contacts/service";
import type { MockDb } from "@/lib/db/mock";
import { listOutbox } from "@/lib/email/outbox";
import { addPaymentId, confirmPaymentId } from "@/lib/payments";
import { setStorageForTests, type Storage } from "@/lib/storage";
import { createMockStorage } from "@/lib/storage/mock";
import { createUsp } from "@/lib/usps/service";
import type { Usp } from "@/lib/usps/types";
import { makeOwner, type Owner } from "../../helpers/details";

export const NOW = new Date("2026-10-14T12:00:00Z");
export const BASE_URL = "http://localhost:3000";

export interface Bakery extends Owner {
  storage: Storage;
  dir: string;
  usps: { discount: Usp; best: Usp; rating: Usp; delivery: Usp; free: Usp; price: Usp; upTo: Usp };
  paymentId: string;
  photoId: string;
}

/** A London bakery with contacts, selling points, an active payment ID, a photo file and a mock storage that getStorage() returns. */
export async function makeBakery(db: MockDb, name = "Corner Bakery"): Promise<Bakery> {
  const o = await makeOwner(db, { name, country: "GB", timezone: "Europe/London" });
  // Every post costs two AI events (the words and the fact check), so the default of 30 a day is too few for a test file.
  await db.withAdmin((tx) => tx.query("update public.brands set daily_generation_cap = 1000 where id = $1", [o.brandId]));
  const dir = mkdtempSync(path.join(os.tmpdir(), "pm-create-"));
  const storage = createMockStorage(dir);
  setStorageForTests(storage);
  const usp = (u: { kind: Usp["kind"]; title: string; details: Record<string, unknown> }) => createUsp(o.userId, o.brandId, u as never);
  const discount = await usp({ kind: "discount", title: "20% off cakes", details: { percent: 20, on: "cakes" } });
  const best = await usp({ kind: "quality", title: "Best cakes in town", details: { claim: "Best cakes in town" } });
  const rating = await usp({ kind: "reviews", title: "4.8 on Google", details: { rating: 4.8, count: 230, platform: "Google" } });
  const delivery = await usp({ kind: "delivery", title: "Free delivery in London", details: { promise: "Free delivery", area: "London" } });
  const free = await usp({ kind: "free_extra", title: "Free coffee with every cake", details: { what: "Free coffee" } });
  const price = await usp({ kind: "price", title: "Loaf from £4.50", details: { item: "Sourdough loaf", price: { amount: 4.5, currency: "GBP" }, unit: "loaf" } });
  const upTo = await usp({ kind: "discount", title: "Up to 30% off pastries", details: { percent: 30, on: "pastries", upTo: true } });
  for (const c of [
    { kind: "phone", value: "+44 20 7946 0958" },
    { kind: "whatsapp", value: "+44 20 7946 0958" },
    { kind: "website", value: "https://bakery.example.com" },
    { kind: "address", value: "12 High Street, London" },
    { kind: "instagram", value: "cornerbakery" },
  ]) await createContact(o.userId, o.brandId, { ...c, isDefault: true });

  await addPaymentId({ userId: o.userId, brandId: o.brandId, scheme: "upi", address: "corner.bakery@okhdfcbank", payeeName: "Corner Bakery" });
  const token = /\/p\/([A-Za-z0-9_-]{43})/.exec((await listOutbox()).at(-1)!.text)![1];
  await confirmPaymentId(token);
  const paymentId = (await db.withAdmin((tx) => tx.query<{ id: string }>("select id from public.payment_ids where brand_id = $1 and status = 'active'", [o.brandId])))[0].id;

  // A photo with a real file.
  const photoId = (
    await db.withUser(o.userId, (tx) =>
      tx.query<{ id: string }>("insert into public.photos (brand_id, storage_path, usable) values ($1, $2, true) returning id", [o.brandId, "photos/pending.jpg"]),
    )
  )[0].id;
  const rel = `${o.brandId}/${photoId}.jpg`;
  const jpeg = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#c47a3c" } }).jpeg().toBuffer();
  await storage.put("photos", rel, jpeg, "image/jpeg");
  await db.withAdmin((tx) => tx.query("update public.photos set storage_path = $2 where id = $1", [photoId, `photos/${rel}`]));

  return { ...o, storage, dir, usps: { discount, best, rating, delivery, free, price, upTo }, paymentId, photoId };
}

export function cleanup(b: Bakery): void {
  setStorageForTests(null);
  rmSync(b.dir, { recursive: true, force: true });
}

/** A ready brief for the bakery (an offer on cakes, with the contact blocks on) with any field overridden. */
export async function readyBrief(b: Bakery, patch: Record<string, unknown> = {}): Promise<Brief> {
  return createBrief(
    b.userId,
    b.brandId,
    {
      postType: "offer",
      primaryUspId: b.usps.discount.id,
      secondaryUspIds: [],
      cta: "visit",
      blocks: { phone: true, website: true, address: true, dates: true },
      endsOn: "2026-10-20",
      channels: ["instagram"],
      status: "ready",
      ...patch,
    },
    { now: NOW },
  );
}

let seq = 0;
/**
 * A word no earlier caption used (letters only, so it is not mistaken for a number). Captions of different briefs of one
 * brand must not share six words in a row, or the repetition check (C-3) flags them; tests put one in the middle of a sentence.
 */
export function uniq(): string {
  let n = ++seq;
  let w = "";
  do {
    w = String.fromCharCode(97 + (n % 26)) + w;
    n = Math.floor(n / 26);
  } while (n > 0);
  return `qx${w}`;
}
