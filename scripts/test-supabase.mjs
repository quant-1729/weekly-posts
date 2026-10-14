// Runs the integration tests in tests/supabase/ against the real Supabase project.
// Run through npm (`npm run test:supabase`), which loads .env.local first. Sets SUPABASE_IT=1 here,
// because `node --env-file` cannot set a variable and a plain `npm test` must skip these tests.
// The tests switch themselves to DATA_BACKEND=supabase, a random AUTH_SECRET, no Resend key and fixture AI.
import { spawnSync } from "node:child_process";
import path from "node:path";

const extra = process.argv.slice(2); // e.g. a single test file, or vitest options
const hasFilter = extra.some((a) => !a.startsWith("-"));
const vitest = path.join(process.cwd(), "node_modules", "vitest", "vitest.mjs");
const run = spawnSync(
  process.execPath,
  [vitest, "run", ...(hasFilter ? [] : ["tests/supabase"]), ...extra, "--no-file-parallelism"],
  { stdio: "inherit", env: { ...process.env, SUPABASE_IT: "1" } },
);
process.exit(run.status ?? 1);
