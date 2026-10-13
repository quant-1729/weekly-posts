// Schema v2 (0005_v2.sql): every new table is brand-scoped by RLS, server-only
// tables reject member writes, and v1 + v2 rows coexist.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockDb, type MockDb } from "@/lib/db/mock";

let db: MockDb;
let a: string, b: string; // users (email sign-in)
let brandA: string, brandB: string;
let batchA: string, postA: string, photoA: string;

async function fails(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

beforeAll(async () => {
  db = await createMockDb();
  [a, b] = await db.withAdmin(async (tx) => {
    const ids: string[] = [];
    for (const email of ["owner-a@example.com", "owner-b@example.com"]) {
      const [u] = await tx.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [email]);
      await tx.query(`insert into public.profiles (id, email, consent_at) values ($1, $2, now())`, [u.id, email]);
      ids.push(u.id);
    }
    return ids;
  });
  brandA = (await db.withUser(a, (tx) => tx.query<{ id: string }>(`select public.create_brand('Corner Bakery') as id`)))[0].id;
  brandB = (await db.withUser(b, (tx) => tx.query<{ id: string }>(`select public.create_brand('Harbour Dental') as id`)))[0].id;

  await db.withUser(a, async (tx) => {
    await tx.query(
      `update public.brand_memory set country = 'GB', region = 'GB-ENG', timezone = 'Europe/London', goal = 'footfall',
         post_language = 'en-GB', minutes_per_post = 20, website_url = 'https://bakery.example', schedule_weekday = 1,
         schedule_time = '07:30', example_phrases = '{"Fresh from the oven"}', words_to_avoid = '{"cheap"}'
       where brand_id = $1`,
      [brandA],
    );
    await tx.query(
      `insert into public.brand_facts (brand_id, kind, label, value, source_type, source_ref, source_quote)
       values ($1, 'price', 'Sourdough loaf', '£4.50', 'website', 'https://bakery.example/menu', 'Sourdough loaf £4.50')`,
      [brandA],
    );
    [{ id: photoA }] = await tx.query<{ id: string }>(
      `insert into public.photos (brand_id, storage_path) values ($1, $2) returning id`,
      [brandA, `${brandA}/photos/p1.jpg`],
    );
    await tx.query(`insert into public.owner_dates (brand_id, date, name) values ($1, '2026-11-20', 'Shop birthday')`, [brandA]);
  });

  // The generation job runs as the service role.
  await db.withService(async (tx) => {
    [{ id: batchA }] = await tx.query<{ id: string }>(
      `insert into public.weekly_batches (brand_id, week_start, status) values ($1, '2026-10-19', 'ready') returning id`,
      [brandA],
    );
    [{ id: postA }] = await tx.query<{ id: string }>(
      `insert into public.posts (brand_id, batch_id, post_code, status, channel, post_language, caption, cta, hashtags, suggested_day, photo_id)
       values ($1, $2, 'abc1234', 'draft', 'instagram', 'en-GB', 'Fresh sourdough today', 'Pop in', '{"#bakery"}', '2026-10-21', $3)
       returning id`,
      [brandA, batchA, photoA],
    );
    for (const f of ["square", "vertical", "landscape"]) {
      await tx.query(
        `insert into public.post_images (post_id, brand_id, format, template_id, image_path) values ($1, $2, $3, 't', $4)`,
        [postA, brandA, f, `renders/${brandA}/${postA}/${f}.png`],
      );
    }
    await tx.query(
      `insert into public.email_log (brand_id, user_id, kind, to_email, subject, status) values ($1, $2, 'weekly', 'owner-a@example.com', 'Your posts', 'sent')`,
      [brandA, a],
    );
    await tx.query(
      `insert into public.post_actions (post_id, brand_id, action, via) values ($1, $2, 'approve', 'email_link')`,
      [postA, brandA],
    );
  });
});

afterAll(async () => {
  await db.close();
});

const count = (uid: string, table: string) =>
  db.withUser(uid, (tx) => tx.query<{ n: number }>(`select count(*)::int as n from public.${table}`)).then((r) => r[0].n);

describe("schema v2", () => {
  it("supports email-only accounts and keeps v1 phone accounts valid", async () => {
    const rows = await db.withUser(a, (tx) => tx.query<{ email: string; phone: string | null }>(`select email, phone from public.profiles`));
    expect(rows).toEqual([{ email: "owner-a@example.com", phone: null }]);
    expect(await fails(() => db.withAdmin((tx) => tx.query(`insert into public.profiles (id, consent_at) values (gen_random_uuid(), now())`)))).toBe(true);
  });

  it("stores brand memory v2 fields and rejects bad codes", async () => {
    const [m] = await db.withUser(a, (tx) =>
      tx.query<{ country: string; timezone: string; post_language: string; goal: string }>(
        `select country, timezone, post_language, goal::text from public.brand_memory where brand_id = $1`,
        [brandA],
      ),
    );
    expect(m).toEqual({ country: "GB", timezone: "Europe/London", post_language: "en-GB", goal: "footfall" });
    expect(await fails(() => db.withUser(a, (tx) => tx.query(`update public.brand_memory set country = 'gbr' where brand_id = $1`, [brandA])))).toBe(true);
    expect(await fails(() => db.withUser(a, (tx) => tx.query(`update public.brand_memory set post_language = 'English' where brand_id = $1`, [brandA])))).toBe(true);
  });

  it.each(["brand_facts", "photos", "owner_dates", "weekly_batches", "post_images", "post_actions", "email_log"])(
    "%s: owner A sees its rows, owner B sees none",
    async (table) => {
      expect(await count(a, table)).toBeGreaterThan(0);
      expect(await count(b, table)).toBe(0);
    },
  );

  it("B cannot write into A's brand on any member-writable table", async () => {
    const attempts = [
      `insert into public.brand_facts (brand_id, kind, value, source_type) values ('${brandA}', 'price', '£1', 'owner')`,
      `insert into public.photos (brand_id, extracted_text) values ('${brandA}', 'x')`,
      `insert into public.owner_dates (brand_id, date, name) values ('${brandA}', '2026-12-01', 'x')`,
      `insert into public.checkins (brand_id, week_start, answer, via) values ('${brandA}', '2026-10-19', 'many', 'dashboard')`,
      `insert into public.voice_feedback (brand_id, instruction) values ('${brandA}', 'shorter')`,
    ];
    for (const sql of attempts) expect(await fails(() => db.withUser(b, (tx) => tx.query(sql)))).toBe(true);
  });

  it("members cannot write server-only tables", async () => {
    expect(await fails(() => db.withUser(a, (tx) => tx.query(`insert into public.weekly_batches (brand_id, week_start) values ($1, '2026-10-26')`, [brandA])))).toBe(true);
    expect(await fails(() => db.withUser(a, (tx) => tx.query(`insert into public.email_log (brand_id, kind, to_email, subject) values ($1, 'weekly', 'x@y.z', 's')`, [brandA])))).toBe(true);
    // Link actions are server-only; a member may log only their own dashboard action.
    expect(await fails(() => db.withUser(a, (tx) => tx.query(`insert into public.post_actions (post_id, brand_id, action, via) values ($1, $2, 'approve', 'email_link')`, [postA, brandA])))).toBe(true);
    await db.withUser(a, (tx) => tx.query(`insert into public.post_actions (post_id, brand_id, action, via, user_id) values ($1, $2, 'posted', 'dashboard', $3)`, [postA, brandA, a]));
  });

  it("a post cannot point at another brand's photo or batch", async () => {
    const [{ id: photoB }] = await db.withUser(b, (tx) => tx.query<{ id: string }>(`insert into public.photos (brand_id, extracted_text) values ($1, 'b') returning id`, [brandB]));
    expect(await fails(() => db.withService((tx) => tx.query(`update public.posts set photo_id = $1 where id = $2`, [photoB, postA])))).toBe(true);
    expect(await fails(() => db.withService((tx) => tx.query(`insert into public.posts (brand_id, batch_id, post_code) values ($1, $2, 'zzz9999')`, [brandB, batchA])))).toBe(true);
  });

  it("v2 post statuses and one image per format", async () => {
    await db.withUser(a, (tx) => tx.query(`update public.posts set status = 'approved', approved_at = now() where id = $1`, [postA]));
    expect(await fails(() => db.withService((tx) => tx.query(`insert into public.post_images (post_id, brand_id, format, template_id, image_path) values ($1, $2, 'square', 't', 'x')`, [postA, brandA])))).toBe(true);
  });

  it("deleting the brand removes all v2 rows (Req 22)", async () => {
    await db.withUser(a, (tx) => tx.query(`delete from public.brands where id = $1`, [brandA]));
    const left = await db.withAdmin((tx) =>
      tx.query<{ n: number }>(
        `select (select count(*) from public.brand_facts where brand_id = $1)
              + (select count(*) from public.photos where brand_id = $1)
              + (select count(*) from public.owner_dates where brand_id = $1)
              + (select count(*) from public.weekly_batches where brand_id = $1)
              + (select count(*) from public.posts where brand_id = $1)
              + (select count(*) from public.post_images where brand_id = $1)
              + (select count(*) from public.post_actions where brand_id = $1)
              + (select count(*) from public.email_log where brand_id = $1) as n`,
        [brandA],
      ),
    );
    expect(Number(left[0].n)).toBe(0);
  });
});
