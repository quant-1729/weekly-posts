// cards -> record -> assemble, forwarding the same flags (--scenes, --out, --only, --base, ...).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
for (const step of ["cards", "record", "assemble"]) {
  console.log(`\n=== ${step} ===`);
  const r = spawnSync(process.execPath, [path.join(here, `${step}.mjs`), ...args], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
