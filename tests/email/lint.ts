/**
 * Lints an email's HTML against the known-safe rules for Gmail and Outlook (AC 14). We cannot run
 * Litmus here, so this checks the rules that cause most rendering breakage. Returns problems, [] when clean.
 */
export function lintEmailHtml(html: string): string[] {
  const problems: string[] = [];
  const bad = (msg: string) => problems.push(msg);

  if (!/^<!doctype html>/i.test(html.trim())) bad("missing <!doctype html>");
  if (!/<meta charset="utf-8">/i.test(html)) bad("missing meta charset");
  if (!/<title>[^<]+<\/title>/i.test(html)) bad("missing <title>");
  if (!/display:none;max-height:0;overflow:hidden/.test(html)) bad("missing hidden preheader text");
  if (Buffer.byteLength(html) > 100_000) bad("over 100 KB: Gmail clips long emails");

  // Elements and features that email clients drop or break on.
  for (const re of [/<style/i, /<script/i, /<form/i, /<input/i, /<button/i, /<svg/i, /<iframe/i, /<video/i, /<audio/i, /<link /i, /<object/i, /<embed/i]) {
    if (re.test(html)) bad(`forbidden element ${re.source}`);
  }
  if (/\son[a-z]+\s*=/i.test(html)) bad("inline event handler");
  if (/javascript:/i.test(html)) bad("javascript: URL");

  // CSS checks run without URL attribute values: a random token in a signed link (href or src) can
  // contain anything, such as "3rem", and must not trip a CSS rule (H-13). The unit check applies only
  // inside style="..." attributes.
  const noUrls = html.replace(/(\s(?:href|src)=)"[^"]*"/gi, '$1""');
  const styleAttrs = [...html.matchAll(/\sstyle="([^"]*)"/gi)].map((m) => m[1]).join(";");
  for (const re of [/display:\s*(inline-)?(flex|grid)/i, /position:\s*(absolute|fixed|sticky|relative)/i, /float:/i, /calc\(/i, /var\(--/i, /background-image/i, /@media/i, /@import/i, /@font-face/i]) {
    if (re.test(noUrls)) bad(`unsafe CSS ${re.source}`);
  }
  if (/\d(rem|vw|vh)\b/i.test(styleAttrs)) bad(`unsafe CSS ${/\d(rem|vw|vh)\b/i.source}`);

  // Layout tables.
  for (const t of html.match(/<table\b[^>]*>/gi) ?? []) {
    for (const attr of ['role="presentation"', "cellpadding=", "cellspacing=", "border="]) {
      if (!t.includes(attr)) bad(`table without ${attr}: ${t}`);
    }
  }
  if (!/<table[^>]*width="600"/.test(html)) bad("no 600 px wide container table");
  for (const m of html.matchAll(/\swidth="(\d+)"/g)) {
    if (Number(m[1]) > 600) bad(`width attribute over 600: ${m[1]}`);
  }

  // Images: absolute URL, explicit size, alt text.
  for (const img of html.match(/<img\b[^>]*>/gi) ?? []) {
    if (!/\ssrc="https?:\/\//.test(img)) bad(`img without absolute src: ${img}`);
    if (!/\swidth="\d+"/.test(img) || !/\sheight="\d+"/.test(img)) bad(`img without width and height attributes: ${img}`);
    if (!/\salt="[^"]+"/.test(img)) bad(`img without alt text: ${img}`);
    if (!/display:block/.test(img)) bad(`img without display:block: ${img}`);
  }

  // Links: absolute, coloured inline, and white text only on a background colour.
  for (const a of html.match(/<a\b[^>]*>/gi) ?? []) {
    if (!/\shref="https?:\/\//.test(a)) bad(`link without absolute href: ${a}`);
    if (!/style="[^"]*\bcolor:#/.test(a)) bad(`link without inline colour: ${a}`);
  }
  for (const tag of html.match(/<[a-z][^>]*style="[^"]*"[^>]*>/gi) ?? []) {
    const style = /style="([^"]*)"/.exec(tag)![1];
    const whiteText = /(?:^|;)\s*color:\s*(#fff(?:fff)?|white)\b/i.test(style);
    if (whiteText && !/background-color:\s*#/i.test(style)) bad(`white text without a background colour: ${tag}`);
  }
  // Every colour is explicit on text: paragraphs and cells with text carry a colour.
  for (const p of html.match(/<p\b[^>]*>/gi) ?? []) {
    if (!/\bcolor:#/.test(p)) bad(`paragraph without colour (dark mode could invert it): ${p}`);
    if (!/font-family:/.test(p)) bad(`paragraph without font-family: ${p}`);
  }
  return problems;
}
