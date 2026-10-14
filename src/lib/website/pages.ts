// Page selection (Req 3): from the links on the home page, pick up to 5 pages in total
// (home included) that are likely to hold business facts: about, menu or services, contact.

import type { PageLink } from "./clean";
import type { RobotsRules } from "./robots";

export const MAX_PAGES = 5;

export type PageKind = "home" | "about" | "offerings" | "contact" | "fallback";

export interface PageCandidate {
  url: string;
  kind: PageKind;
}
export interface SkippedPage {
  url: string;
  reason: string;
}
export interface PageSelection {
  /** Home first, then the others in priority order. Robots-disallowed pages are not in it. */
  pages: PageCandidate[];
  skipped: SkippedPage[];
  /** True when the home page had no matching links and the common paths were tried instead. */
  usedFallback: boolean;
}

// Multilingual basics: English plus French, Spanish, German, Italian and Portuguese stems.
const ABOUT = /\b(about|about us|a propos|apropos|our story|who we are|meet the team|our team|nosotros|quienes somos|sobre nosotros|sobre nos|uber uns|ueber uns|chi siamo|qui sommes nous|notre histoire)\b/;
const OFFERINGS = /\b(menu|menus|carte|carta|speisekarte|services?|servicios?|servizi|servicos|treatments?|products?|productos?|produits?|produkte|prodotti|pricing|prices?|price list|tarifs?|precios|preise|leistungen|dienstleistungen)\b/;
const CONTACT = /\b(contact|contacts|contact us|contactez nous|nous contacter|kontakt|contacto|contatto|contato|find us|visit us|opening hours|hours|location|locations)\b/;

// Pages that are never useful for facts, wherever they appear in the path.
const DENY_SEGMENT = /^(blog|blogs|news|press|careers?|jobs?|privacy|privacy-policy|terms|terms-and-conditions|cookies?|login|signin|sign-in|register|cart|checkout|account|tag|tags|category|categories|feed|wp-admin|wp-json|search|sitemap|sitemap\.xml)$/;
const NON_HTML_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|docx?|xlsx?|pptx?|mp[34]|mov|avi|css|js|json|xml|txt)$/i;

const COMMON_PATHS = ["/about", "/menu", "/services", "/contact"];

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function segments(pathname: string): string[] {
  return pathname
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponentSafe)
    .map((s) => s.replace(/\.(html?|php|aspx?|jsp)$/i, ""));
}
function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function bareHost(u: URL): string {
  return u.host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}
/** Same host, or the same host with or without "www." (www.shop.example and shop.example are one site). */
function sameSite(a: URL, b: URL): boolean {
  return bareHost(a) === bareHost(b);
}

export function pageKey(u: URL | string): string {
  const url = typeof u === "string" ? new URL(u) : u;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return `${url.host.toLowerCase()}${path}${url.search}`;
}

interface Scored {
  url: URL;
  kind: Exclude<PageKind, "home" | "fallback">;
  score: number;
  order: number;
}

/**
 * Chooses the pages to read. `home` is the final URL of the home page, `links` its links,
 * and `robots` the rules for the home page's origin (links are same-host, so same origin).
 */
export function selectPages(home: URL, links: PageLink[], robots: RobotsRules): PageSelection {
  const skipped: SkippedPage[] = [];
  const homeKey = pageKey(home);
  const scored: Scored[] = [];
  const seen = new Set<string>([homeKey]);

  links.forEach((link, order) => {
    let url: URL;
    try {
      url = new URL(link.href);
    } catch {
      return;
    }
    if (!sameSite(url, home)) return;
    url.protocol = home.protocol; // stay on the scheme and host the home page was read with
    url.host = home.host; // (www. and the bare host are one site; the one that answered is the one we use)
    if (NON_HTML_EXT.test(url.pathname)) return;
    const segs = segments(url.pathname);
    if (segs.length > 3 || segs.some((s) => DENY_SEGMENT.test(s.toLowerCase()))) return;
    const key = pageKey(url);
    if (seen.has(key)) return;

    const pathText = norm(segs.join(" "));
    const anchorText = norm(link.text);
    const kinds: Array<[Scored["kind"], RegExp]> = [
      ["about", ABOUT],
      ["offerings", OFFERINGS],
      ["contact", CONTACT],
    ];
    for (const [kind, re] of kinds) {
      // A match in the path is stronger than one in the anchor text; shallow paths beat deep ones.
      const score = (re.test(pathText) ? 4 : 0) + (re.test(anchorText) ? 2 : 0) - Math.max(0, segs.length - 1) * 0.5;
      if (score >= 2) {
        seen.add(key);
        scored.push({ url, kind, score, order });
        return;
      }
    }
  });

  const usedFallback = scored.length === 0;
  const pages: PageCandidate[] = [{ url: home.href, kind: "home" }];
  const room = MAX_PAGES - 1;

  const allowed = (s: Scored) => {
    if (robots.isAllowed(s.url)) return true;
    skipped.push({ url: s.url.href, reason: "robots" });
    return false;
  };

  if (usedFallback) {
    for (const path of COMMON_PATHS) {
      if (pages.length > room) break;
      const url = new URL(path, home);
      if (!robots.isAllowed(url)) {
        skipped.push({ url: url.href, reason: "robots" });
        continue;
      }
      pages.push({ url: url.href, kind: "fallback" });
    }
    return { pages, skipped, usedFallback };
  }

  // First the best page of each kind (about, then menu or services, then contact), so that a site with
  // five product pages still gets its contact page. Then the rest, by kind and score.
  const rank: Record<Scored["kind"], number> = { about: 0, offerings: 1, contact: 2 };
  const byPriority = [...scored].sort((a, b) => rank[a.kind] - rank[b.kind] || b.score - a.score || a.order - b.order);
  const chosen: Scored[] = [];
  for (const kind of ["about", "offerings", "contact"] as const) {
    for (const s of byPriority.filter((x) => x.kind === kind)) {
      if (chosen.length >= room) break;
      if (allowed(s)) {
        chosen.push(s);
        break; // one per kind in this round; a disallowed one falls through to the next best
      }
    }
  }
  for (const s of byPriority) {
    if (chosen.length >= room) break;
    if (chosen.includes(s) || skipped.some((k) => k.url === s.url.href)) continue;
    if (allowed(s)) chosen.push(s);
  }
  chosen.sort((a, b) => byPriority.indexOf(a) - byPriority.indexOf(b));
  for (const s of chosen) pages.push({ url: s.url.href, kind: s.kind });
  return { pages, skipped, usedFallback };
}
