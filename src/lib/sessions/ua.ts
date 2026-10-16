/**
 * A compact user-agent reader: browser, OS and device type, enough for "Chrome 130 on Windows, desktop".
 * Hand-written (no library) so there is no licence to carry. Values are short and never empty text: unknown
 * parts are null. The raw string is stored separately (cut to 400 characters) for support.
 */

export type DeviceType = "desktop" | "mobile" | "tablet" | "bot" | "unknown";

export interface ParsedUserAgent {
  browser: string | null;
  os: string | null;
  deviceType: DeviceType;
}

const BOT_RE = /bot\b|bot[/;_ -]|crawl|spider|slurp|headless|lighthouse|curl\/|wget\/|python-requests|python-urllib|go-http-client|okhttp\/|node-fetch|undici|axios\/|java\/|libwww|httpclient|monitor|preview|facebookexternalhit|whatsapp\/|telegrambot/i;

const major = (v: string | undefined) => (v ? v.split(".")[0] : "");
const label = (name: string, version: string | undefined) => {
  const m = major(version);
  return m ? `${name} ${m}` : name;
};
const cut = (v: string | null) => (v === null ? null : v.slice(0, 40));

function parseBrowser(ua: string): string | null {
  let m: RegExpMatchArray | null;
  if ((m = /\bEdg(?:e|A|iOS)?\/([\d.]+)/.exec(ua))) return label("Edge", m[1]);
  if ((m = /\b(?:OPR|Opera)\/([\d.]+)/.exec(ua))) return label("Opera", m[1]);
  if ((m = /\bSamsungBrowser\/([\d.]+)/.exec(ua))) return label("Samsung Internet", m[1]);
  if ((m = /\b(?:Firefox|FxiOS)\/([\d.]+)/.exec(ua))) return label("Firefox", m[1]);
  if ((m = /\bCriOS\/([\d.]+)/.exec(ua))) return label("Chrome", m[1]);
  if ((m = /\bChrome\/([\d.]+)/.exec(ua))) return label("Chrome", m[1]);
  if ((m = /\bVersion\/([\d.]+).*\bSafari\//.exec(ua))) return label("Safari", m[1]);
  if (/\bSafari\//.test(ua)) return "Safari";
  if ((m = /\bMSIE ([\d.]+)/.exec(ua)) || (m = /\bTrident\/.*rv:([\d.]+)/.exec(ua))) return label("Internet Explorer", m[1]);
  return null;
}

function parseOs(ua: string): string | null {
  let m: RegExpMatchArray | null;
  if (/\bWindows NT\b/.test(ua)) return "Windows";
  if ((m = /\bAndroid[ /]?([\d.]+)?/.exec(ua))) return label("Android", m[1]);
  if ((m = /\b(?:iPhone|CPU) OS ([\d_]+)/.exec(ua)) && /iPhone|iPad|iPod/.test(ua)) return label("iOS", m[1].replace(/_/g, "."));
  if (/\b(?:iPhone|iPad|iPod)\b/.test(ua)) return "iOS";
  if (/\bCrOS\b/.test(ua)) return "ChromeOS";
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) return "macOS";
  if (/\bLinux\b|\bX11\b/.test(ua)) return "Linux";
  return null;
}

function parseDevice(ua: string, browser: string | null, os: string | null): DeviceType {
  if (BOT_RE.test(ua)) return "bot";
  if (/\biPad\b|\bTablet\b|\bKindle\b|\bSilk\b/.test(ua)) return "tablet";
  if (/\bAndroid\b/.test(ua)) return /\bMobile\b/.test(ua) ? "mobile" : "tablet";
  if (/\biPhone\b|\biPod\b|\bMobile\b|\bWindows Phone\b/.test(ua)) return "mobile";
  if (os === "Windows" || os === "macOS" || os === "Linux" || os === "ChromeOS") return "desktop";
  return browser || os ? "desktop" : "unknown";
}

/** Never throws; a missing or odd string gives { null, null, "unknown" } (or "bot" for known crawlers). */
export function parseUserAgent(raw: string | null | undefined): ParsedUserAgent {
  const ua = (raw ?? "").slice(0, 1000).trim();
  if (!ua) return { browser: null, os: null, deviceType: "unknown" };
  const browser = parseBrowser(ua);
  const os = parseOs(ua);
  return { browser: cut(browser), os: cut(os), deviceType: parseDevice(ua, browser, os) };
}
