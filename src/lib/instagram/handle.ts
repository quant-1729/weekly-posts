// Instagram handles: reading one from what the owner typed or pasted, and finding profile links
// in a website's HTML. No server dependencies, so the setup screen can import it too.

/** Instagram's own rule: 1 to 30 letters, numbers, dots and underscores (the database check is the same). */
export const HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;

/** First path parts of instagram.com that are pages, not profiles. */
const RESERVED_PATHS = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "explore",
  "accounts",
  "stories",
  "direct",
  "about",
  "legal",
  "developer",
  "privacy",
  "web",
  "api",
  "oauth",
  "challenge",
  "directory",
  "emails",
  "press",
  "static",
  "popular",
  "share",
  "embed",
  "embed.js",
  "locations",
  "tags",
  "nametag",
  "session",
  "login",
  "download",
  "ads",
  "business",
  "creators",
  "lite",
  "threads",
  "reg",
  "legal",
  "terms",
  "help",
  "sharer",
  "sharer.php",
]);

/** `instagram.com/{name}/p/{id}` and friends: a post that happens to sit under a profile name. */
const POST_SEGMENTS = new Set(["p", "reel", "tv", "embed"]);

const HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);

function validName(name: string): boolean {
  return HANDLE_RE.test(name) && !name.startsWith(".") && !name.endsWith(".") && !name.includes("..");
}

/** The handle in an instagram.com address, or null for anything that is not a profile address. */
function handleFromUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw.replace(/^\/\//, "")}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;
  let parts = url.pathname.split("/").filter(Boolean);
  if (parts[0]?.toLowerCase() === "_u") parts = parts.slice(1); // app deep links: /_u/name
  const name = parts[0];
  if (!name || RESERVED_PATHS.has(name.toLowerCase())) return null;
  if (parts[1] && POST_SEGMENTS.has(parts[1].toLowerCase())) return null;
  return validName(name) ? name.toLowerCase() : null;
}

/**
 * Reads a handle from "@name", "name" or an instagram.com address (with or without https://, query
 * strings and trailing slashes). Returns it without the "@", in lower case (Instagram ignores
 * case), or null when it is not a usable profile name. Post, reel and other page addresses are null.
 */
export function normalizeInstagramHandle(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim();
  if (t === "" || t.length > 300) return null;
  if (/instagram\.com|instagr\.am/i.test(t) || /^https?:\/\//i.test(t)) return handleFromUrl(t);
  const name = t.replace(/^@/, "");
  return validName(name) ? name.toLowerCase() : null;
}

/** "bakery.one" -> "@bakery.one". */
export function displayHandle(handle: string): string {
  return `@${handle}`;
}

const LINK_RE = /(?:https?:)?\/\/(?:www\.|m\.)?instagram\.com\/[^\s"'<>()\\]*/gi;

/**
 * Profile links found in page text: anchors, JSON-LD "sameAs" lists, or plain text. Share, embed,
 * post and reel links are ignored. Handles come back lower case, without duplicates, in the order
 * they first appear on the page. `html` may also be a list of addresses joined by spaces.
 */
export function findInstagramHandles(html: string | string[]): string[] {
  const text = (Array.isArray(html) ? html.join("\n") : html).replace(/\\\//g, "/").replace(/&amp;/gi, "&");
  const found: string[] = [];
  for (const m of text.matchAll(LINK_RE)) {
    const handle = handleFromUrl(m[0].replace(/[.,;:!?]+$/, ""));
    if (!handle || handle === "instagram" || found.includes(handle)) continue;
    found.push(handle);
  }
  return found;
}
