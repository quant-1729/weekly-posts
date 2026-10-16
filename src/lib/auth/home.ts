import { getDb } from "@/lib/db";

/**
 * Where a signed-in user lands: /home (the Home page) once their business is set up, else /setup (no brand yet,
 * or setup not finished). One business per account. /create, /week and /plan (v1) still work by URL.
 */
export async function homePathFor(userId: string): Promise<"/setup" | "/home"> {
  const [row] = await getDb().withUser(userId, (tx) =>
    tx.query<{ n: number }>(
      `select count(*)::int as n
         from public.brand_members bm
         join public.brand_memory m on m.brand_id = bm.brand_id
        where bm.user_id = $1 and m.setup_completed_at is not null`,
      [userId],
    ),
  );
  return row && row.n > 0 ? "/home" : "/setup";
}
