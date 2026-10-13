// A small, forgiving HTML tokenizer and entity decoder. No HTML parser is installed
// and none may be added, so this covers what the website reader needs: tags with
// attributes, text, comments, and raw-text elements (script, style, ...).

export type HtmlToken =
  | { t: "text"; v: string }
  | { t: "open"; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { t: "close"; name: string };

const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "plaintext"]);

/** Elements that never have content or an end tag. */
export const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function isNameStart(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
}

/** Reads a tag starting after "<" (and "/" for closing tags). Returns the end index (after ">"). */
function readTag(html: string, start: number): { name: string; attrs: Record<string, string>; selfClosing: boolean; end: number } {
  let i = start;
  while (i < html.length && !/[\s/>]/.test(html[i])) i++;
  const name = html.slice(start, i).toLowerCase();
  const attrs: Record<string, string> = {};
  let selfClosing = false;

  while (i < html.length) {
    while (i < html.length && /[\s]/.test(html[i])) i++;
    if (i >= html.length) break;
    const c = html[i];
    if (c === ">") return { name, attrs, selfClosing, end: i + 1 };
    if (c === "/") {
      if (html[i + 1] === ">") selfClosing = true;
      i++;
      continue;
    }
    const ns = i;
    while (i < html.length && !/[\s=/>]/.test(html[i])) i++;
    const attr = html.slice(ns, i).toLowerCase();
    while (i < html.length && /\s/.test(html[i])) i++;
    let value = "";
    if (html[i] === "=") {
      i++;
      while (i < html.length && /\s/.test(html[i])) i++;
      const q = html[i];
      if (q === '"' || q === "'") {
        const close = html.indexOf(q, i + 1);
        const stop = close < 0 ? html.length : close;
        value = html.slice(i + 1, stop);
        i = close < 0 ? html.length : close + 1;
      } else {
        const vs = i;
        while (i < html.length && !/[\s>]/.test(html[i])) i++;
        value = html.slice(vs, i);
      }
    }
    if (attr && !(attr in attrs)) attrs[attr] = decodeEntities(value);
  }
  return { name, attrs, selfClosing, end: html.length };
}

export function tokenize(html: string): HtmlToken[] {
  const out: HtmlToken[] = [];
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      out.push({ t: "text", v: html.slice(i) });
      break;
    }
    if (lt > i) out.push({ t: "text", v: html.slice(i, lt) });
    i = lt;

    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (html.startsWith("<![CDATA[", i)) {
      const end = html.indexOf("]]>", i + 9);
      out.push({ t: "text", v: html.slice(i + 9, end < 0 ? n : end) });
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (html[i + 1] === "!" || html[i + 1] === "?") {
      const end = html.indexOf(">", i + 2);
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (html[i + 1] === "/") {
      if (!isNameStart(html[i + 2] ?? "")) {
        // "</ " or "</>": drop up to ">"
        const end = html.indexOf(">", i + 2);
        i = end < 0 ? n : end + 1;
        continue;
      }
      const tag = readTag(html, i + 2);
      out.push({ t: "close", name: tag.name });
      i = tag.end;
      continue;
    }
    if (!isNameStart(html[i + 1] ?? "")) {
      out.push({ t: "text", v: "<" });
      i += 1;
      continue;
    }
    const tag = readTag(html, i + 1);
    out.push({ t: "open", name: tag.name, attrs: tag.attrs, selfClosing: tag.selfClosing });
    i = tag.end;

    if (RAW_TEXT.has(tag.name) && !tag.selfClosing) {
      const closer = new RegExp(`</${tag.name}[\\s/>]`, "ig");
      closer.lastIndex = i;
      const m = closer.exec(html);
      const stop = m ? m.index : n;
      // Title and textarea text is data; script and style bodies are dropped by the caller.
      if (stop > i) out.push({ t: "text", v: html.slice(i, stop) });
      i = stop;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  shy: "",
  zwnj: "",
  zwj: "",
  pound: "£",
  euro: "€",
  yen: "¥",
  cent: "¢",
  curren: "¤",
  copy: "©",
  reg: "®",
  trade: "™",
  sect: "§",
  para: "¶",
  middot: "·",
  bull: "•",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  laquo: "«",
  raquo: "»",
  lsaquo: "‹",
  rsaquo: "›",
  deg: "°",
  plusmn: "±",
  times: "×",
  divide: "÷",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  sup1: "¹",
  sup2: "²",
  sup3: "³",
  micro: "µ",
  iexcl: "¡",
  iquest: "¿",
  szlig: "ß",
  aelig: "æ",
  AElig: "Æ",
  oslash: "ø",
  Oslash: "Ø",
  eth: "ð",
  ETH: "Ð",
  thorn: "þ",
  THORN: "Þ",
  rarr: "→",
  larr: "←",
  check: "✓",
  hearts: "♥",
  star: "☆",
  starf: "★",
};

// Accented Latin letters (eacute, Ntilde, ccedil ...), composed from base letter + combining mark.
const MARKS: Record<string, string> = { acute: "́", grave: "̀", circ: "̂", uml: "̈", tilde: "̃", cedil: "̧", ring: "̊" };
for (const letter of "AEIOUYaeiouyNnCc") {
  for (const [name, mark] of Object.entries(MARKS)) {
    const composed = (letter + mark).normalize("NFC");
    if (composed.length === 1) NAMED[letter + name] = composed;
  }
}

// Entities browsers accept without the trailing semicolon.
const LEGACY = new Set(["amp", "lt", "gt", "quot", "nbsp", "copy", "reg", "pound", "yen", "cent", "deg", "plusmn", "times", "divide", "middot", "laquo", "raquo", "sect", "para"]);

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*)(;?)/g, (whole, body: string, semi: string) => {
    if (body[0] === "#") {
      if (!semi && body.length < 3) return whole;
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
      return String.fromCodePoint(code);
    }
    if (body in NAMED && (semi || LEGACY.has(body))) return NAMED[body];
    return whole;
  });
}
