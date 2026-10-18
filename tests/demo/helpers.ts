import type { MockDb } from "@/lib/db/mock";
import { makeOwner, type Owner } from "../helpers/details";

export const DEMO_EMAIL = "demo.judge@example.com";
export const DEMO_CODE = "correct-horse-battery-staple";

/** An owner with a brand whose profile email is the demo email (any case). */
export async function makeDemoOwner(db: MockDb, email: string = DEMO_EMAIL): Promise<Owner> {
  const owner = await makeOwner(db, { name: "Demo Bakery" });
  await db.withAdmin(async (tx) => {
    await tx.query("update auth.users set email = $2 where id = $1", [owner.userId, email]);
    await tx.query("update public.profiles set email = $2 where id = $1", [owner.userId, email]);
  });
  return owner;
}

/** A response's Location as a path and query. */
export function locationOf(res: Response): string {
  const u = new URL(res.headers.get("location") ?? "http://x/");
  return `${u.pathname}${u.search}`;
}
