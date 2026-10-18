import { z } from "zod";

// Blank values in .env files (KEY=) count as "not set".
const blankToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const optional = z.preprocess(blankToUndefined, z.string().optional());

const schema = z.object({
  DATA_BACKEND: z.preprocess(blankToUndefined, z.enum(["mock", "supabase"]).optional()),
  STORAGE_BACKEND: z.preprocess(blankToUndefined, z.enum(["mock", "supabase", "gcs"]).optional()),
  AUTH_SECRET: optional,
  NEXT_PUBLIC_SUPABASE_URL: optional,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,
  SUPABASE_DB_URL: optional,
  NODE_ENV: optional,
  VERCEL_ENV: optional,
  K_SERVICE: optional, // set by Cloud Run itself
  NEXT_PUBLIC_APP_URL: optional,
  RESEND_API_KEY: optional,
  EMAIL_FROM: optional,
  EMAIL_REPLY_TO: optional,
  CRON_SECRET: optional,
  EMAIL_LINK_SECRET: optional,
  ADMIN_EMAILS: optional,
  DEMO_LOGIN_EMAIL: optional,
  DEMO_ACCESS_CODE: optional,
  DEMO_WEEKLY_USD_CAP: optional,
  DEMO_DAILY_CALL_CAP: optional,
});

export type Env = {
  dataBackend: "mock" | "supabase";
  /** Where files go (C-32): STORAGE_BACKEND, or the same as dataBackend when unset. */
  storageBackend: "mock" | "supabase" | "gcs";
  authSecret: string;
  isProduction: boolean;
  /** True on Vercel production or on Cloud Run (K_SERVICE is set there). Mock auth refuses to run on either. */
  isHostedProduction: boolean;
  /** Supabase project URL, service role key and pooled database URL (server only). Undefined until set. */
  supabaseUrl: string | undefined;
  supabaseServiceRoleKey: string | undefined;
  supabaseDbUrl: string | undefined;
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
  /** Emails allowed to open /admin (ADMIN_EMAILS, comma-separated): trimmed, lower-case, no blanks. Empty = nobody. */
  adminEmails: string[];
  /** Demo login for judges (docs/15-demo-login.md). `email` and `accessCode` must both be set for the demo to exist. */
  demo: {
    /** The account the demo signs in to (DEMO_LOGIN_EMAIL), trimmed and lower-case. */
    email: string | undefined;
    /** The shared access code (DEMO_ACCESS_CODE). Never logged or sent to the browser. */
    accessCode: string | undefined;
    /** Weekly AI cap in USD for the demo user's brands (DEMO_WEEKLY_USD_CAP). Unset or not a positive number = the normal cap. */
    weeklyUsdCap: number | undefined;
    /** Daily AI call cap for the demo user's brands (DEMO_DAILY_CALL_CAP). Unset or below 1 = the brand's own cap. */
    dailyCallCap: number | undefined;
  };
};

/** A positive finite number from a setting, else undefined (a typo means "use the normal cap", never "no cap"). */
function positiveNumber(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v.trim());
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

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
    storageBackend: raw.STORAGE_BACKEND ?? dataBackend,
    authSecret,
    isProduction,
    isHostedProduction: raw.VERCEL_ENV === "production" || Boolean(raw.K_SERVICE),
    supabaseUrl: raw.NEXT_PUBLIC_SUPABASE_URL,
    supabaseServiceRoleKey: raw.SUPABASE_SERVICE_ROLE_KEY,
    supabaseDbUrl: raw.SUPABASE_DB_URL,
    appUrl: (raw.NEXT_PUBLIC_APP_URL ?? (isProduction ? "" : "http://localhost:3000")).trim().replace(/\/+$/, ""),
    resendApiKey: raw.RESEND_API_KEY,
    emailFrom: raw.EMAIL_FROM,
    emailReplyTo: raw.EMAIL_REPLY_TO,
    cronSecret: raw.CRON_SECRET,
    emailLinkSecret: raw.EMAIL_LINK_SECRET,
    adminEmails: (raw.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e !== ""),
    demo: {
      email: raw.DEMO_LOGIN_EMAIL?.trim().toLowerCase() || undefined,
      accessCode: raw.DEMO_ACCESS_CODE || undefined,
      weeklyUsdCap: positiveNumber(raw.DEMO_WEEKLY_USD_CAP),
      dailyCallCap: (() => {
        const n = positiveNumber(raw.DEMO_DAILY_CALL_CAP);
        return n !== undefined && n >= 1 ? Math.floor(n) : undefined;
      })(),
    },
  };
}
