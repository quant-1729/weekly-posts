import { createHash, createHmac, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getEnv } from "@/lib/env";
import { isValidIsoDate } from "@/lib/occasions/dates";

/**
 * Signed, expiring, no-login links (docs/email-links.md section 2).
 *
 * A token is a compact JWS (HS256, EMAIL_LINK_SECRET). Claims: sub = brand id, pid = post id
 * (absent for brand-level acts), act, wk = week start, x = extra (such as a check-in answer),
 * jti, iat, exp = iat + 14 days (AC 14).
 *
 * A link never acts on GET (see src/lib/links/dispatch.ts). Never log a whole token: log
 * jtiHash(jti).
 */

export const LINK_TTL_SECONDS = 14 * 24 * 3600;

export const LINK_ACTS = [
  "view_week",
  "approve",
  "skip",
  "edit",
  "ready",
  "checkin",
  "pause",
  "unsubscribe",
  /** Undo a pause (sent in the "we paused your emails" notice). */
  "resume",
  /** A post image for an email (/i/[token]). */
  "img",
] as const;
export type LinkAct = (typeof LINK_ACTS)[number];

/** Acts that always work on one post (the token must carry pid). "ready" may carry one too. */
export const POST_ACTS: readonly LinkAct[] = ["approve", "skip", "edit", "img"];

export type LinkExtra = Record<string, string | boolean>;

export interface LinkClaims {
  brandId: string;
  postId?: string;
  act: LinkAct;
  weekStart?: string;
  extra: LinkExtra;
  jti: string;
  iat: number;
  exp: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET_LABEL = "postmitra/email-link/v1";

/**
 * EMAIL_LINK_SECRET. Without it: a value derived from AUTH_SECRET and a fixed label in
 * development and tests, and an error in production.
 */
export function emailLinkSecret(): string {
  const env = getEnv();
  if (env.emailLinkSecret) return env.emailLinkSecret;
  if (env.isProduction) throw new Error("EMAIL_LINK_SECRET is required in production. Set it in the environment.");
  return createHmac("sha256", env.authSecret).update(SECRET_LABEL).digest("hex");
}

function key(): Uint8Array {
  return new TextEncoder().encode(emailLinkSecret());
}

/** Short fingerprint of a jti for logs and post_actions.detail. Not reversible to the token. */
export function jtiHash(jti: string): string {
  return createHash("sha256").update(jti).digest("hex").slice(0, 12);
}

export interface SignLinkInput {
  brandId: string;
  postId?: string;
  act: LinkAct;
  weekStart?: string;
  /** Small extra values, for example { answer: "few" } for a check-in. */
  extra?: LinkExtra;
  /** Test clock. Default: now. */
  now?: Date | number;
}

const toMs = (v: Date | number | undefined): number => (v === undefined ? Date.now() : v instanceof Date ? v.getTime() : v);

export async function signLink(input: SignLinkInput): Promise<string> {
  if (!LINK_ACTS.includes(input.act)) throw new Error(`Unknown link act: ${input.act}`);
  if (!UUID_RE.test(input.brandId)) throw new Error("signLink needs a brand id");
  if (input.postId !== undefined && !UUID_RE.test(input.postId)) throw new Error("signLink got an invalid post id");
  if (input.weekStart !== undefined && !isValidIsoDate(input.weekStart)) throw new Error("signLink got an invalid week start");
  const iat = Math.floor(toMs(input.now) / 1000);
  const claims: Record<string, unknown> = { act: input.act };
  if (input.postId) claims.pid = input.postId;
  if (input.weekStart) claims.wk = input.weekStart;
  if (input.extra && Object.keys(input.extra).length > 0) claims.x = input.extra;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.brandId)
    .setJti(randomUUID())
    .setIssuedAt(iat)
    .setExpirationTime(iat + LINK_TTL_SECONDS)
    .sign(key());
}

/**
 * The claims, or null when the token is missing, forged, expired or malformed. With `act`,
 * a token for another act is also null (a "pause" token cannot unsubscribe).
 */
export async function verifyLink(
  token: string | undefined | null,
  opts: { act?: LinkAct | readonly LinkAct[]; now?: Date | number } = {},
): Promise<LinkClaims | null> {
  if (!token || token.length > 2000) return null;
  try {
    const { payload } = await jwtVerify(token, key(), {
      algorithms: ["HS256"],
      currentDate: new Date(toMs(opts.now)),
    });
    const act = payload.act;
    if (typeof act !== "string" || !(LINK_ACTS as readonly string[]).includes(act)) return null;
    const wanted = opts.act === undefined ? null : Array.isArray(opts.act) ? opts.act : [opts.act];
    if (wanted && !wanted.includes(act as LinkAct)) return null;
    if (typeof payload.sub !== "string" || !UUID_RE.test(payload.sub)) return null;
    if (typeof payload.jti !== "string" || typeof payload.exp !== "number" || typeof payload.iat !== "number") return null;
    const pid = payload.pid;
    if (pid !== undefined && (typeof pid !== "string" || !UUID_RE.test(pid))) return null;
    const wk = payload.wk;
    if (wk !== undefined && (typeof wk !== "string" || !isValidIsoDate(wk))) return null;
    const x = payload.x;
    const extra: LinkExtra = {};
    if (x !== undefined) {
      if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
      for (const [k, v] of Object.entries(x)) {
        if (typeof v === "string" || typeof v === "boolean") extra[k] = v;
      }
    }
    if ((POST_ACTS as readonly string[]).includes(act) && !pid) return null;
    return {
      brandId: payload.sub,
      postId: pid,
      act: act as LinkAct,
      weekStart: wk,
      extra,
      jti: payload.jti,
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

/** Absolute URL of a link page. */
export function linkUrl(token: string): string {
  return `${appBase()}/e/${token}`;
}

export function imageUrl(token: string): string {
  return `${appBase()}/i/${token}`;
}

/** NEXT_PUBLIC_APP_URL. Emailed links must be absolute, so an unset value in production is an error. */
export function appBase(): string {
  const base = getEnv().appUrl;
  if (!base) throw new Error("NEXT_PUBLIC_APP_URL is required to build emailed links.");
  return base;
}
