// HTML to visible text for the website reader (Req 3), plus the page metadata the
// setup needs: title, meta description, logo candidates, theme colour and links.
//
// Dropped: script, style, noscript, svg, templates, frames, hidden elements and obvious
// cookie banners. Kept: header, nav and footer (hours and addresses live in footers).
// Line breaks are kept at block elements; table cells are separated by " | ".

import { VOID_ELEMENTS, decodeEntities, tokenize } from "./html";

export const MAX_PAGE_CHARS = 8000;

export type LogoSource = "img" | "apple_touch_icon" | "icon" | "og_image";
export interface LogoCandidate {
  url: string;
  source: LogoSource;
}
export interface PageLink {
  /** Absolute http(s) URL without the fragment. */
  href: string;
  text: string;
}
export interface CleanedPage {
  title: string;
  /** The og:title meta tag, or an empty string. */
  ogTitle: string;
  metaDescription: string;
  /** Visible text, at most MAX_PAGE_CHARS characters. */
  text: string;
  /** True when the text was longer than the cap and the middle was cut. */
  truncated: boolean;
  /** Best first: logo-like images, apple-touch-icon, favicon, og:image. Absolute URLs. */
  logoCandidates: LogoCandidate[];
  themeColor: string | null;
  links: PageLink[];
}

const DROP_TAGS = new Set(["svg", "noscript", "template", "iframe", "canvas", "object", "select", "datalist", "audio", "video", "map", "math", "frameset"]);
const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "body", "caption", "dd", "details", "dialog", "div", "dl", "dt", "fieldset",
  "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p",
  "pre", "section", "summary", "table", "tbody", "thead", "tfoot", "tr", "ul", "legend",
]);
// Tags that implicitly end an open element of the listed types (HTML optional end tags).
const P_CLOSERS = ["address", "article", "aside", "blockquote", "div", "dl", "fieldset", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "pre", "section", "table", "ul"];
const CLOSED_BY: Record<string, Set<string>> = {
  li: new Set(["li"]),
  dt: new Set(["dt", "dd"]),
  dd: new Set(["dt", "dd"]),
  tr: new Set(["tr", "td", "th"]),
  td: new Set(["td", "th"]),
  th: new Set(["td", "th"]),
  tbody: new Set(["thead", "tbody", "tfoot", "tr", "td", "th"]),
  thead: new Set(["thead", "tbody", "tfoot", "tr", "td", "th"]),
  tfoot: new Set(["thead", "tbody", "tfoot", "tr", "td", "th"]),
  option: new Set(["option"]),
};
for (const t of P_CLOSERS) (CLOSED_BY[t] ??= new Set()).add("p");

const HIDDEN_STYLE = /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?![\d.])/i;
const COOKIE_ATTR = /(^|[\s_-])(cookie|cookies|cookiebanner|cookie-banner|cookiebot|cookieconsent|cc-window|cc-banner|gdpr|onetrust|consent)([\s_-]|$)/i;
const COOKIE_TAGS = new Set(["div", "section", "aside", "dialog", "form"]);
const MAX_BANNER_CHARS = 1500; // a "cookie" element with more text than this is real content
const LOGO_ATTR = /(^|[^a-z])logo/i;
const MAX_LOGOS = 6;

function collapseSpaces(s: string): string {
  return s.replace(/[\s​‌‍﻿]+/g, " ").trim();
}

function absoluteUrl(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(href.trim(), base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

interface Entry {
  name: string;
  hidden: boolean;
  cookie: boolean;
  startSegs: number;
  startLen: number;
}

/** Shortens text over the cap by keeping the start and the end, where footers are. */
export function capText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_PAGE_CHARS) return { text, truncated: false };
  const marker = "\n[...]\n";
  const tail = 2400;
  const head = MAX_PAGE_CHARS - tail - marker.length;
  let h = text.slice(0, head);
  const nl = h.lastIndexOf("\n");
  if (nl > head * 0.8) h = h.slice(0, nl);
  let t = text.slice(text.length - tail);
  const nl2 = t.indexOf("\n");
  if (nl2 >= 0 && nl2 < tail * 0.2) t = t.slice(nl2 + 1);
  return { text: h + marker + t, truncated: true };
}

export function cleanHtml(html: string, pageUrl: string): CleanedPage {
  const tokens = tokenize(html);
  const segs: string[] = [];
  let len = 0;
  const stack: Entry[] = [];
  let hiddenCount = 0;
  let headDepth = 0;
  let titleOpen = false;
  let rawSkip: string | null = null;

  let title = "";
  let metaDescription = "";
  let ogDescription = "";
  let ogTitle = "";
  let themeColor: string | null = null;
  let base = pageUrl;
  const logos: LogoCandidate[] = [];
  const links: PageLink[] = [];
  let anchor: { href: string; text: string; label: string } | null = null;
  let rowHasCell = false;

  const emit = (s: string) => {
    if (!s) return;
    segs.push(s);
    len += s.length;
  };
  const addLogo = (url: string | null, source: LogoSource) => {
    if (!url || logos.length >= MAX_LOGOS || logos.some((l) => l.url === url)) return;
    logos.push({ url, source });
  };
  const finishAnchor = () => {
    if (!anchor) return;
    const text = collapseSpaces(anchor.text) || collapseSpaces(anchor.label);
    links.push({ href: anchor.href, text });
    anchor = null;
  };
  const popEntry = () => {
    const e = stack.pop();
    if (!e) return;
    if (e.hidden) hiddenCount--;
    if (e.cookie && len - e.startLen <= MAX_BANNER_CHARS) {
      segs.length = e.startSegs;
      len = e.startLen;
    }
    if (BLOCK_TAGS.has(e.name)) emit("\n");
    if (e.name === "a") finishAnchor();
  };

  for (const tok of tokens) {
    if (tok.t === "text") {
      if (titleOpen) {
        if (!title) title = collapseSpaces(decodeEntities(tok.v));
        continue;
      }
      if (rawSkip) continue;
      const decoded = decodeEntities(tok.v);
      if (anchor) anchor.text += ` ${decoded}`;
      if (hiddenCount > 0 || headDepth > 0) continue;
      emit(decoded.replace(/[\t\n\r\f ]+/g, " "));
      continue;
    }

    if (tok.t === "close") {
      const name = tok.name;
      if (name === "title") {
        titleOpen = false;
        continue;
      }
      if (rawSkip) {
        if (name === rawSkip) rawSkip = null;
        continue;
      }
      if (name === "head") {
        headDepth = Math.max(0, headDepth - 1);
        continue;
      }
      if (name === "br" || VOID_ELEMENTS.has(name)) continue;
      let idx = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) {
          idx = i;
          break;
        }
      }
      if (idx < 0) continue;
      while (stack.length > idx) popEntry();
      continue;
    }

    // open tag
    const { name, attrs } = tok;
    if (rawSkip) continue;

    switch (name) {
      case "title":
        titleOpen = !tok.selfClosing && hiddenCount === 0;
        continue;
      case "script":
      case "style":
      case "textarea":
      case "xmp":
        if (!tok.selfClosing) rawSkip = name;
        continue;
      case "head":
        headDepth++;
        continue;
      case "base": {
        const b = absoluteUrl(attrs.href, pageUrl);
        if (b) base = b;
        continue;
      }
      case "meta": {
        const key = (attrs.name ?? attrs.property ?? "").toLowerCase();
        const content = collapseSpaces(attrs.content ?? "");
        if (!content) continue;
        if (key === "description" && !metaDescription) metaDescription = content;
        else if (key === "og:description" && !ogDescription) ogDescription = content;
        else if (key === "og:title" && !ogTitle) ogTitle = content;
        else if (key === "theme-color" && !themeColor && content.length <= 40) themeColor = content;
        else if (key === "og:image" || key === "og:image:url" || (attrs.property ?? "").toLowerCase() === "og:image") {
          addLogo(absoluteUrl(attrs.content, base), "og_image");
        }
        continue;
      }
      case "link": {
        const rel = (attrs.rel ?? "").toLowerCase().split(/\s+/);
        if (rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed")) addLogo(absoluteUrl(attrs.href, base), "apple_touch_icon");
        else if (rel.includes("icon")) addLogo(absoluteUrl(attrs.href, base), "icon");
        continue;
      }
      case "br":
        if (hiddenCount === 0 && headDepth === 0) emit("\n");
        continue;
      case "img": {
        const hay = `${attrs.src ?? ""} ${attrs.alt ?? ""} ${attrs.class ?? ""} ${attrs.id ?? ""}`;
        if (LOGO_ATTR.test(hay) && hiddenCount === 0) addLogo(absoluteUrl(attrs.src ?? attrs["data-src"], base), "img");
        if (anchor && attrs.alt) anchor.text += ` ${decodeEntities(attrs.alt)}`;
        continue;
      }
      case "a":
        finishAnchor();
        break;
      default:
        break;
    }
    if (VOID_ELEMENTS.has(name)) continue;

    if (name === "a") {
      const href = absoluteUrl(attrs.href, base);
      if (href) anchor = { href, text: "", label: attrs["aria-label"] ?? attrs.title ?? "" };
    }

    // Optional end tags: <li> closes an open <li>, a block closes an open <p>, and so on.
    const closes = CLOSED_BY[name];
    while (closes && stack.length > 0 && closes.has(stack[stack.length - 1].name)) popEntry();

    const hidden =
      DROP_TAGS.has(name) ||
      attrs.hidden !== undefined ||
      (attrs["aria-hidden"] ?? "").toLowerCase() === "true" ||
      HIDDEN_STYLE.test(attrs.style ?? "");
    const cookie =
      !hidden && COOKIE_TAGS.has(name) && (COOKIE_ATTR.test(attrs.id ?? "") || COOKIE_ATTR.test(attrs.class ?? ""));
    if (hidden) hiddenCount++;
    stack.push({ name, hidden, cookie, startSegs: segs.length, startLen: len });

    if (hiddenCount === 0 && headDepth === 0) {
      if (BLOCK_TAGS.has(name)) emit("\n");
      if (name === "tr") rowHasCell = false;
      if (name === "td" || name === "th") {
        if (rowHasCell) emit(" | ");
        rowHasCell = true;
      }
    }
  }
  while (stack.length > 0) popEntry();
  finishAnchor();

  const lines: string[] = [];
  for (const raw of segs.join("").split("\n")) {
    const line = collapseSpaces(raw);
    if (line && line !== lines[lines.length - 1]) lines.push(line);
  }
  const capped = capText(lines.join("\n"));

  // Best logo candidates first: logo-like images, apple-touch-icon, favicon, og:image.
  const order: Record<LogoSource, number> = { img: 0, apple_touch_icon: 1, icon: 2, og_image: 3 };
  const logoCandidates = logos
    .map((l, i) => ({ l, i }))
    .sort((a, b) => order[a.l.source] - order[b.l.source] || a.i - b.i)
    .map((x) => x.l);

  return {
    title,
    ogTitle,
    metaDescription: metaDescription || ogDescription,
    text: capped.text,
    truncated: capped.truncated,
    logoCandidates,
    themeColor,
    links,
  };
}
