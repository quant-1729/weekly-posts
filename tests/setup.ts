import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";
import { setOutboxDirForTests } from "@/lib/email/outbox";

// Weekly generation now emails the owner (V-15). Keep every test file's mock emails out of .data/outbox.
const dir = mkdtempSync(path.join(os.tmpdir(), "pm-test-outbox-"));
setOutboxDirForTests(dir);
afterAll(() => {
  setOutboxDirForTests(null);
  rmSync(dir, { recursive: true, force: true });
});
