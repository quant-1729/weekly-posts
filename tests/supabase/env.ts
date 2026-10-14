import { randomBytes } from "node:crypto";

/**
 * Imported first by every file in tests/supabase. Inside the test process only (never in
 * .env.local): the Supabase backend, a random AUTH_SECRET, no Resend key and no sender
 * address (so sign-in emails go to the mock outbox, never to a real inbox), fixture AI.
 */
export const IT = process.env.SUPABASE_IT === "1";

if (IT) {
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL"]) {
    if (!process.env[key]) throw new Error(`${key} is not set. Run these tests with: npm run test:supabase`);
  }
  process.env.DATA_BACKEND = "supabase";
  process.env.AUTH_SECRET = randomBytes(32).toString("hex");
  process.env.RESEND_API_KEY = "";
  process.env.EMAIL_FROM = "";
  process.env.EMAIL_REPLY_TO = "";
  process.env.AI_MODE = "fixture";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
}
