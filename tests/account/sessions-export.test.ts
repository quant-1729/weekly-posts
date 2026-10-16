import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildExport } from "@/lib/account/export";
import { createMockDb, setMockDbForTests, type MockDb } from "@/lib/db/mock";
import { createMockStorage } from "@/lib/storage/mock";
import { newUser } from "./helpers";
import { collect, parseZip } from "./zip-read";

let db: MockDb;
beforeAll(async () => {
  db = await createMockDb();
  setMockDbForTests(db);
});
afterAll(async () => {
  setMockDbForTests(null);
  await db.close();
});

describe("account export: sign-in devices", () => {
  it("includes the user's own sessions (device fields only, no ip_hash, no raw user agent) and nobody else's", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pm-sess-export-"));
    try {
      const mine = await newUser(db, "sess-mine@example.com");
      const other = await newUser(db, "sess-other@example.com");
      await db.withAdmin(async (tx) => {
        await tx.query(
          `insert into public.user_sessions (user_id, user_agent, browser, os, device_type, country, city, ip_hash, revoked_at, revoked_by)
           values ($1, 'Mozilla/5.0 secret-ua', 'Chrome 130', 'Windows', 'desktop', 'AU', 'Sydney', 'abcdef0123456789abcdef0123456789', now(), 'admin'),
                  ($1, null, 'Safari 17', 'iOS 17', 'mobile', null, null, 'ffffffffffffffffffffffffffffffff', null, null),
                  ($2, null, 'Firefox 131', 'Linux', 'desktop', 'NZ', 'Auckland', '00000000000000000000000000000000', null, null)`,
          [mine, other],
        );
      });
      const zip = parseZip(await collect(await buildExport(mine, { storage: createMockStorage(root) })));
      expect(zip.names).toContain("sessions.json");
      const raw = new TextDecoder().decode(zip.files.get("sessions.json"));
      const list = JSON.parse(raw) as Array<Record<string, unknown>>;
      expect(list).toHaveLength(2);
      expect(list.map((r) => r.browser).sort()).toEqual(["Chrome 130", "Safari 17"]);
      expect(list.find((r) => r.browser === "Chrome 130")).toMatchObject({
        os: "Windows",
        device_type: "desktop",
        country: "AU",
        city: "Sydney",
        revoked_by: "admin",
      });
      for (const r of list) {
        expect(Object.keys(r).sort()).toEqual(["browser", "city", "country", "created_at", "device_type", "last_seen_at", "os", "revoked_at", "revoked_by"]);
      }
      for (const bad of ["ip_hash", "abcdef0123", "ffffffff", "secret-ua", "Firefox", "Auckland"]) expect(raw).not.toContain(bad);
      expect(new TextDecoder().decode(zip.files.get("README.txt"))).toContain("sessions.json");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
