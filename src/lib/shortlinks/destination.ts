// Where a short link goes, and the UTM tags added to it (Req 19). Pure, no database.

/** Hosts where a link opens a chat. UTM tags mean nothing there and can break the deep link. */
const MESSAGING_HOSTS = new Set(["wa.me", "api.whatsapp.com", "m.me", "t.me"]);

/** Parses an http(s) URL. Anything else (javascript:, data:, tel:, garbage) gives null. */
export function parseWebUrl(value: string | null | undefined): URL | null {
  const t = (value ?? "").trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

export function isMessagingLink(u: URL): boolean {
  return MESSAGING_HOSTS.has(u.hostname.toLowerCase().replace(/^www\./, ""));
}

/**
 * Adds utm_source={channel}, utm_medium=social, utm_campaign=weekly-posts, utm_content={post code}.
 * Existing utm_* params are kept as they are (only the missing ones are added), the rest of the
 * query is left byte for byte, and the #fragment stays. Messaging deep links are returned untouched.
 */
export function withUtm(u: URL, args: { channel: string | null; postCode: string }): string {
  const out = new URL(u.href);
  if (isMessagingLink(out)) return out.href;
  const wanted: [string, string][] = [
    ["utm_source", args.channel || "other"],
    ["utm_medium", "social"],
    ["utm_campaign", "weekly-posts"],
    ["utm_content", args.postCode],
  ];
  const add = wanted.filter(([k]) => !out.searchParams.has(k)).map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  if (add.length > 0) out.search = (out.search ? `${out.search}&` : "?") + add.join("&");
  return out.href;
}

/**
 * The owner's chosen destination, else the website, else null (the caller then uses the
 * public card). A stored value that is not an http(s) URL is skipped, never redirected to.
 */
export function pickDestination(args: {
  linkDestination: string | null;
  websiteUrl: string | null;
  channel: string | null;
  postCode: string;
}): string | null {
  const u = parseWebUrl(args.linkDestination) ?? parseWebUrl(args.websiteUrl);
  return u ? withUtm(u, { channel: args.channel, postCode: args.postCode }) : null;
}
