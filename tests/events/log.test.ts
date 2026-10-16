import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { cleanDetail, logEvent } from "@/lib/events/log";

let db: MockDb;
beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});

const rows = (kind: string) =>
  db.withAdmin((tx) =>
    tx.query<{ ok: boolean; user_id: string | null; detail: Record<string, unknown> }>(
      "select ok, user_id, detail from public.app_events where kind = $1",
      [kind],
    ),
  );

describe("logEvent", () => {
  it("records a small event", async () => {
    const userId = await db.withAdmin(
      async (tx) => (await tx.query<{ id: string }>("insert into auth.users (email) values ('ev@example.com') returning id"))[0].id,
    );
    await logEvent({ kind: "test.simple", userId, ok: false, detail: { reason: "rate_limited", count: 3, flag: true } });
    expect(await rows("test.simple")).toEqual([
      { ok: false, user_id: userId, detail: { reason: "rate_limited", count: 3, flag: true } },
    ]);
  });

  it("strips content-like and secret-like fields and long or address-like values", async () => {
    await logEvent({
      kind: "test.strip",
      detail: {
        reason: "ok_value",
        caption: "Buy our cakes!",
        post_text: "hello",
        description: "my bakery",
        payment_id: "me@upi",
        token: "abc",
        email: "a@b.co",
        note: "x",
        by: "someone@example.com", // a value that looks like an address
        link_to: "https://example.com/x",
        run: "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", // token-like
        long: "y".repeat(500),
        "Bad Key": "x",
        nested: { a: 1 } as unknown as string,
        n: Number.NaN,
        kept: "fine",
      },
    });
    const [r] = await rows("test.strip");
    expect(r.detail).toEqual({ reason: "ok_value", kept: "fine" });
    const text = JSON.stringify(r.detail);
    for (const bad of ["cakes", "bakery", "upi", "a@b.co", "example.com", "yyyy"]) expect(text).not.toContain(bad);
  });

  it("keeps at most 8 fields", () => {
    const detail = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${i}`, i]));
    expect(Object.keys(cleanDetail(detail))).toHaveLength(8);
  });

  it("allows a uuid value", () => {
    const id = randomUUID();
    expect(cleanDetail({ target: id })).toEqual({ target: id });
  });

  it("never throws or rejects: bad kind, bad ids, a failing database", async () => {
    await expect(logEvent({ kind: "Bad Kind!" })).resolves.toBeUndefined();
    await expect(logEvent({ kind: "test.badids", userId: "not-a-uuid", brandId: "x", sessionId: "y" })).resolves.toBeUndefined();
    expect((await rows("test.badids"))[0]).toMatchObject({ user_id: null }); // bad ids are dropped, the event is kept
    await expect(logEvent(undefined as never)).resolves.toBeUndefined();
    // A valid uuid for a user that does not exist: the foreign key refuses; nothing is thrown.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(logEvent({ kind: "test.nouser", userId: randomUUID() })).resolves.toBeUndefined();
    expect(await rows("test.nouser")).toHaveLength(0);
    warn.mockRestore();
  });
});
