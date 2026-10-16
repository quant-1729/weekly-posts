import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// tests/supabase/* talk to the real Supabase project. They run only through `npm run test:supabase`
// (which sets SUPABASE_IT=1); a plain `npm test` does not even load them.
const supabaseIt = process.env.SUPABASE_IT === "1";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: supabaseIt
      ? [...configDefaults.exclude, "admin-dashboard/**"]
      : [...configDefaults.exclude, "tests/supabase/**", "admin-dashboard/**"],
    globalSetup: supabaseIt ? ["tests/supabase/global.ts"] : [],
    setupFiles: ["tests/setup.ts"],
    // The real project is a network hop away (about 0.4 s per query), so its tests get more time.
    testTimeout: supabaseIt ? 180_000 : 30_000,
    hookTimeout: supabaseIt ? 300_000 : 60_000,
    teardownTimeout: supabaseIt ? 300_000 : 10_000,
  },
});
