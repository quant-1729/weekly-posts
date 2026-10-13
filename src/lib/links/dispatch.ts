import { getDb } from "@/lib/db";
import { isCsrfSecret, newCsrfSecret } from "@/lib/auth/continue";
import { LINK_CSRF_COOKIE, linkCookieOptions, linkNonce, linkNonceMatches } from "./csrf";
import { getLinkHandler, type LinkBrand, type LinkContext } from "./handlers";
import { insertPostAction } from "./log";
import { PAGE_CSP, emailsOffPage, esc, expiredPage, pageCsp, renderPage, timedOutPage, unavailablePage, messagePage, type LinkPage } from "./page";
import { loadLinkHandlers } from "./load";
import { jtiHash, verifyLink, type LinkAct, type LinkClaims } from "./tokens";
import { s } from "@/lib/i18n/strings";

/**
 * The logic of GET and POST /e/[token] (docs/email-links.md section 1). The route files are thin.
 *
 * GET only shows a page and never changes anything, so a mail scanner that opens the link does
 * nothing. POST acts, and only with the nonce from the page that this browser loaded.
 */

export interface LinkResponse {
  status: number;
  html: string;
  /** A Content-Security-Policy to send instead of the default (only for a page that carries a script). */
  csp?: string;
  /** Cookie to set (the CSRF secret), if any. */
  cookie?: { name: string; value: string; options: ReturnType<typeof linkCookieOptions> };
}

/**
 * Acts that still work after the owner unsubscribed. Unsubscribing only stops the emails: the
 * links in weeks that were already sent keep working (view the week, approve, skip, edit, and the
 * ready-to-share page), and so do the acts that undo or manage the subscription.
 */
const WORKS_WHEN_UNSUBSCRIBED: readonly LinkAct[] = ["unsubscribe", "pause", "resume", "view_week", "approve", "skip", "edit", "ready"];

/**
 * `replaced` (H-10): the post in the link is gone ("Generate new posts" deletes the drafts), but the
 * brand and the link's week still exist. The dispatcher then shows that week's current posts instead.
 */
type Loaded = { ok: true; brand: LinkBrand; replaced: boolean } | { ok: false; page: LinkPage };

/** The checks that run on every GET and POST: brand exists, post belongs to it, weekly links not switched off. */
async function recheck(claims: LinkClaims): Promise<Loaded> {
  const { brand, postOk, weekOk } = await getDb().withService(async (tx) => {
    const [row] = await tx.query<{ id: string; name: string; timezone: string | null; paused: string | null; unsub: Date | string | null }>(
      `select b.id::text as id, coalesce(nullif(trim(m.business_name), ''), b.name) as name, m.timezone,
              m.email_paused_until::text as paused, m.email_unsubscribed_at as unsub
         from public.brands b left join public.brand_memory m on m.brand_id = b.id where b.id = $1`,
      [claims.brandId],
    );
    let postOk = true;
    if (row && claims.postId) {
      const [p] = await tx.query<{ id: string }>(
        `select p.id::text as id from public.posts p
          where p.id = $1 and p.brand_id = $2
            and (p.batch_id is null or exists (select 1 from public.weekly_batches w where w.id = p.batch_id and w.brand_id = p.brand_id))`,
        [claims.postId, claims.brandId],
      );
      postOk = Boolean(p);
    }
    let weekOk = false;
    if (row && !postOk && claims.weekStart) {
      const [w] = await tx.query<{ id: string }>(`select id::text as id from public.weekly_batches where brand_id = $1 and week_start = $2::date`, [claims.brandId, claims.weekStart]);
      weekOk = Boolean(w);
    }
    return { brand: row, postOk, weekOk };
  });
  if (!brand || (!postOk && !weekOk)) return { ok: false, page: unavailablePage() };
  const replaced = !postOk;
  const linkBrand: LinkBrand = {
    id: brand.id,
    name: brand.name,
    timezone: brand.timezone || "UTC",
    emailPausedUntil: brand.paused,
    emailUnsubscribedAt: brand.unsub ? new Date(brand.unsub) : null,
  };
  if (linkBrand.emailUnsubscribedAt && !WORKS_WHEN_UNSUBSCRIBED.includes(replaced ? "view_week" : claims.act)) {
    return { ok: false, page: emailsOffPage() };
  }
  return { ok: true, brand: linkBrand, replaced };
}

/**
 * The page for a link whose post was replaced (H-10): the week's current posts, each with its own
 * fresh links, under a short note. It only reads: a POST with an old token never acts on another post.
 */
async function replacedWeekPage(ctx: LinkContext): Promise<LinkPage> {
  const handler = getLinkHandler("view_week");
  if (!handler) return unavailablePage();
  const page = await handler.view(ctx);
  const note = `<p role="status" style="margin:0 0 20px;padding:10px 12px;border-radius:8px;background:#eff6ff;border:1px solid #93c5fd;color:#1e3a8a;">${esc(s.links.replacedNote)}</p>`;
  return { ...page, body: note + page.body };
}

function respond(page: LinkPage, cookie?: LinkResponse["cookie"]): LinkResponse {
  return { status: page.status ?? 200, html: renderPage(page), csp: page.script ? pageCsp(page) : undefined, cookie };
}

export const LINK_PAGE_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": PAGE_CSP,
};

function makeContext(token: string, claims: LinkClaims, brand: LinkBrand, secret: string, now: Date): LinkContext {
  return {
    token,
    claims,
    nonce: linkNonce(claims.jti, secret),
    jtiHash: jtiHash(claims.jti),
    now,
    brand,
    logPostAction: (action, detail) => insertPostAction(claims, action, detail),
  };
}

/** GET /e/{token}: show the page. Changes nothing. `cookie` is the browser's CSRF cookie value, if any. */
export async function handleLinkGet(token: string, cookie: string | undefined, now: Date = new Date()): Promise<LinkResponse> {
  loadLinkHandlers();
  const claims = await verifyLink(token, { now });
  // "img" tokens are for /i/ only.
  if (!claims || claims.act === "img") return respond(expiredPage());
  const loaded = await recheck(claims);
  if (!loaded.ok) return respond(loaded.page);
  const handler = getLinkHandler(claims.act);
  if (!handler) return respond(unavailablePage());

  const secret = isCsrfSecret(cookie) ? cookie : newCsrfSecret();
  const ctx = makeContext(token, claims, loaded.brand, secret, now);
  const page = loaded.replaced ? await replacedWeekPage(ctx) : await handler.view(ctx);
  return respond(page, { name: LINK_CSRF_COOKIE, value: secret, options: linkCookieOptions() });
}

/** POST /e/{token}: act. Needs the nonce for this token and this browser's cookie. */
export async function handleLinkPost(
  token: string,
  form: FormData,
  cookie: string | undefined,
  now: Date = new Date(),
): Promise<LinkResponse> {
  loadLinkHandlers();
  const claims = await verifyLink(token, { now });
  if (!claims || claims.act === "img") return respond(expiredPage());
  const nonce = form.get("nonce");
  if (!isCsrfSecret(cookie) || !linkNonceMatches(claims.jti, cookie, typeof nonce === "string" ? nonce : undefined)) {
    return respond(timedOutPage());
  }
  const loaded = await recheck(claims);
  if (!loaded.ok) return respond(loaded.page);
  const handler = getLinkHandler(claims.act);
  if (!handler) return respond(unavailablePage());

  try {
    const ctx = makeContext(token, claims, loaded.brand, cookie, now);
    const page = loaded.replaced ? await replacedWeekPage(ctx) : await handler.act(ctx, form);
    return respond(page);
  } catch (e) {
    console.error(`[link] act=${claims.act} jti=${jtiHash(claims.jti)} failed: ${e instanceof Error ? e.message : String(e)}`);
    return respond(messagePage(s.links.errorTitle, s.links.errorBody, 500));
  }
}
