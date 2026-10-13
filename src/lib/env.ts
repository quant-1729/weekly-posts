import { z } from "zod";

// Blank values in .env files (KEY=) count as "not set".
const blankToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const optional = z.preprocess(blankToUndefined, z.string().optional());

const schema = z.object({
  DATA_BACKEND: z.preprocess(blankToUndefined, z.enum(["mock", "supabase"]).optional()),
  AUTH_SECRET: optional,
  NEXT_PUBLIC_SUPABASE_URL: optional,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,
  SUPABASE_DB_URL: optional,
  NODE_ENV: optional,
  VERCEL_ENV: optional,
  NEXT_PUBLIC_APP_URL: optional,
  RESEND_API_KEY: optional,
  EMAIL_FROM: optional,
  EMAIL_REPLY_TO: optional,
  CRON_SECRET: optional,
  EMAIL_LINK_SECRET: optional,
});

export type Env = {
  dataBackend: "mock" | "supabase";
  authSecret: string;
  isProduction: boolean;
  /** True on Vercel production. Mock auth refuses to run there. */
  isVercelProduction: boolean;
  /** Public base URL used in emailed links, no trailing slash. Empty in production if unset. */
  appUrl: string;
  /** Resend is used only when both the key and the from address are set. */
  resendApiKey: string | undefined;
  emailFrom: string | undefined;
  emailReplyTo: string | undefined;
  /** Bearer secret for /api/cron/*. Without it those routes answer 401. */
  cronSecret: string | undefined;
  /** Signs emailed action links. Optional here: src/lib/links/tokens.ts derives a dev value in mock mode and throws in production. */
  emailLinkSecret: string | undefined;
};

/**
 * True when developer-only pages (such as /dev/outbox) may be served: never in
 * production and never on Vercel (any VERCEL_ENV). Reads process.env directly so
 * the proxy can call it without needing AUTH_SECRET.
 */
export function isDevToolsEnabled(): boolean {
  const blank = (v: string | undefined) => v === undefined || v.trim() === "";
  return process.env.NODE_ENV !== "production" && blank(process.env.VERCEL_ENV);
}

/** Fixed secret used only in mock mode when AUTH_SECRET is blank. Never accepted in production. */
export const DEV_AUTH_SECRET = "postmitra-dev-only-secret-do-not-use-in-production";

let warnedDevSecret = false;

/**
 * Reads and validates environment variables. Called on use (not at import)
 * so tests can change process.env.
 */
export function getEnv(): Env {
  const raw = schema.parse(process.env);

  const hasSupabaseKeys = Boolean(
    raw.NEXT_PUBLIC_SUPABASE_URL &&
      raw.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      raw.SUPABASE_SERVICE_ROLE_KEY,
  );
  const dataBackend = raw.DATA_BACKEND ?? (hasSupabaseKeys ? "supabase" : "mock");
  const isProduction = raw.NODE_ENV === "production";

  let authSecret = raw.AUTH_SECRET;
  if (!authSecret) {
    if (isProduction) {
      throw new Error("AUTH_SECRET is required in production. Set it in the environment.");
    }
    if (dataBackend !== "mock") {
      throw new Error("AUTH_SECRET is required when DATA_BACKEND is not mock.");
    }
    authSecret = DEV_AUTH_SECRET;
    if (!warnedDevSecret) {
      warnedDevSecret = true;
      console.warn(
        "[env] AUTH_SECRET is blank; using a fixed development secret. Set AUTH_SECRET in .env.local.",
      );
    }
  } else if (isProduction && authSecret.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters in production.");
  }

  return {
    dataBackend,
    authSecret,
    isProduction,
    isVercelProduction: raw.VERCEL_ENV === "production",
    appUrl: (raw.NEXT_PUBLIC_APP_URL ?? (isProduction ? "" : "http://localhost:3000")).trim().replace(/\/+$/, ""),
    resendApiKey: raw.RESEND_API_KEY,
    emailFrom: raw.EMAIL_FROM,
    emailReplyTo: raw.EMAIL_REPLY_TO,
    cronSecret: raw.CRON_SECRET,
    emailLinkSecret: raw.EMAIL_LINK_SECRET,
  };
}
