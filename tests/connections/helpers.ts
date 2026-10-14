import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import type { MockDb } from "@/lib/db/mock";
import type { FetchLike } from "@/lib/connections/graph";

export { openDb, closeDb, makeOwner, type Owner } from "../helpers/details";

/** A 32-byte key for TOKEN_ENCRYPTION_KEY. */
export const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

/** Meta app settings, so the Connect flows are "available". */
export function stubMetaEnv(): void {
  vi.stubEnv("META_APP_ID", "1234567890");
  vi.stubEnv("META_APP_SECRET", "meta-secret-abcdef");
  vi.stubEnv("INSTAGRAM_APP_ID", "9876543210");
  vi.stubEnv("INSTAGRAM_APP_SECRET", "ig-secret-abcdef");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", TEST_KEY);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
  vi.stubEnv("META_GRAPH_VERSION", "v23.0");
}

export interface Call {
  method: string;
  host: string;
  path: string;
  /** Query string for GET and DELETE, form body for POST. */
  params: URLSearchParams;
}
export type Reply = { status?: number; body?: unknown } | Error;
export type Handler = (call: Call) => Reply | undefined;

/** A fake fetch: the first handler that answers wins; anything else is a 400 so a stray call fails loudly. */
export function fakeFetch(handlers: Handler[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init) => {
    const u = new URL(input);
    const method = init?.method ?? "GET";
    const params = new URLSearchParams(method === "POST" ? String(init?.body ?? "") : u.search);
    const call: Call = { method, host: u.host, path: u.pathname, params };
    calls.push(call);
    for (const h of handlers) {
      const r = h(call);
      if (!r) continue;
      if (r instanceof Error) throw r;
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
    }
    return new Response(JSON.stringify({ error: { message: `unexpected ${method} ${u.host}${u.pathname}`, code: 100, type: "OAuthException" } }), { status: 400 });
  };
  return { fetch, calls };
}

/** A handler for one method and path pattern. `reply` may be a value, a function of the call, or a list used in order (the last repeats). */
export function when(method: string, path: RegExp, reply: Reply | ((c: Call) => Reply) | Reply[]): Handler {
  let i = 0;
  return (c) => {
    if (c.method !== method || !path.test(c.path)) return undefined;
    if (Array.isArray(reply)) return reply[Math.min(i++, reply.length - 1)];
    return typeof reply === "function" ? reply(c) : reply;
  };
}

export const graphError = (code: number, message = "Something went wrong", extra: { subcode?: number; type?: string; status?: number } = {}): Reply => ({
  status: extra.status ?? 400,
  body: { error: { message, type: extra.type ?? "OAuthException", code, ...(extra.subcode ? { error_subcode: extra.subcode } : {}) } },
});

/** Adds a member with another role to a brand. */
export async function addMember(db: MockDb, brandId: string, role: "editor" | "owner" = "editor"): Promise<string> {
  const email = `member-${randomUUID().slice(0, 8)}@example.com`;
  return db.withAdmin(async (tx) => {
    const [u] = await tx.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
    await tx.query("insert into public.profiles (id, email, consent_at) values ($1, $2, now())", [u.id, email]);
    await tx.query("insert into public.brand_members (brand_id, user_id, role) values ($1, $2, $3)", [brandId, u.id, role]);
    return u.id;
  });
}

/** A signed-up user who belongs to no brand. */
export async function makeStranger(db: MockDb): Promise<string> {
  const email = `stranger-${randomUUID().slice(0, 8)}@example.com`;
  return db.withAdmin(async (tx) => {
    const [u] = await tx.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
    await tx.query("insert into public.profiles (id, email, consent_at) values ($1, $2, now())", [u.id, email]);
    return u.id;
  });
}
