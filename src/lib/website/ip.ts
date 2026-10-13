// IP address classification for the safe fetcher (SSRF defence).
// An address is "public" only when it is not in any private, loopback,
// link-local, CGNAT, multicast, reserved, documentation or cloud-metadata range.

import { isIP } from "node:net";

export type IpVerdict = { ok: true; family: 4 | 6 } | { ok: false; reason: string };

// [network, prefix length, label]. 169.254.169.254 (cloud metadata) sits inside 169.254.0.0/16.
const BLOCKED_V4: Array<[string, number, string]> = [
  ["0.0.0.0", 8, "unspecified"],
  ["10.0.0.0", 8, "private"],
  ["100.64.0.0", 10, "carrier-grade NAT"],
  ["127.0.0.0", 8, "loopback"],
  ["169.254.0.0", 16, "link-local or cloud metadata"],
  ["172.16.0.0", 12, "private"],
  ["192.0.0.0", 24, "IETF protocol assignments"],
  ["192.0.2.0", 24, "documentation"],
  ["192.88.99.0", 24, "6to4 relay"],
  ["192.168.0.0", 16, "private"],
  ["198.18.0.0", 15, "benchmarking"],
  ["198.51.100.0", 24, "documentation"],
  ["203.0.113.0", 24, "documentation"],
  ["224.0.0.0", 4, "multicast"],
  ["240.0.0.0", 4, "reserved"],
];

function v4ToInt(a: number[]): number {
  return ((a[0] << 24) | (a[1] << 16) | (a[2] << 8) | a[3]) >>> 0;
}

function parseV4(s: string): number[] | null {
  if (isIP(s) !== 4) return null;
  return s.split(".").map(Number);
}

function classifyV4Bytes(b: number[]): IpVerdict {
  const n = v4ToInt(b);
  for (const [net, bits, label] of BLOCKED_V4) {
    const base = v4ToInt(net.split(".").map(Number));
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((n & mask) >>> 0 === (base & mask) >>> 0) return { ok: false, reason: label };
  }
  return { ok: true, family: 4 };
}

/** Expands an IPv6 literal to 16 bytes. Returns null when it is not valid IPv6. */
export function parseV6(input: string): number[] | null {
  let s = input;
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  if (s.includes("%") || isIP(s) !== 6) return null;
  const dotted = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const q = dotted[2].split(".").map(Number);
    s = `${dotted[1]}${((q[0] << 8) | q[1]).toString(16)}:${((q[2] << 8) | q[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const groups = [...left, ...Array<string>(fill).fill("0"), ...right];
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of groups) {
    const v = parseInt(g, 16);
    if (Number.isNaN(v) || v < 0 || v > 0xffff) return null;
    bytes.push(v >> 8, v & 0xff);
  }
  return bytes;
}

function hasPrefix(bytes: number[], prefix: number[], bits: number): boolean {
  for (let i = 0; i < bits; i += 8) {
    const remaining = Math.min(8, bits - i);
    const mask = (0xff << (8 - remaining)) & 0xff;
    if ((bytes[i / 8] & mask) !== (prefix[i / 8] & mask)) return false;
  }
  return true;
}

function p6(...groups: number[]): number[] {
  const out: number[] = [];
  for (const g of groups) out.push(g >> 8, g & 0xff);
  while (out.length < 16) out.push(0);
  return out;
}

function classifyV6Bytes(b: number[]): IpVerdict {
  // IPv4-mapped (::ffff:a.b.c.d): judge the embedded IPv4 address.
  if (hasPrefix(b, p6(0, 0, 0, 0, 0, 0xffff), 96)) return classifyV4Bytes(b.slice(12));
  // ::/96 covers unspecified (::), loopback (::1) and IPv4-compatible addresses.
  if (hasPrefix(b, p6(), 96)) return { ok: false, reason: "unspecified or loopback" };
  // NAT64 (64:ff9b::/96): judge the embedded IPv4 address. The local-use block is refused.
  if (hasPrefix(b, p6(0x64, 0xff9b), 96)) return classifyV4Bytes(b.slice(12));
  if (hasPrefix(b, p6(0x64, 0xff9b, 1), 48)) return { ok: false, reason: "local-use NAT64" };
  // Only global unicast (2000::/3) can be public. This drops ULA (fc00::/7), link-local
  // (fe80::/10), site-local, multicast (ff00::/8), discard (100::/64) and the rest.
  if (!hasPrefix(b, p6(0x2000), 3)) return { ok: false, reason: "not global unicast" };
  if (hasPrefix(b, p6(0x2001), 23)) return { ok: false, reason: "IETF protocol assignments" };
  if (hasPrefix(b, p6(0x2001, 0xdb8), 32)) return { ok: false, reason: "documentation" };
  if (hasPrefix(b, p6(0x2002), 16)) return { ok: false, reason: "6to4" };
  if (hasPrefix(b, p6(0x3fff), 20)) return { ok: false, reason: "documentation" };
  return { ok: true, family: 6 };
}

/** Decides whether a literal IP address may be connected to. Anything unparseable is refused. */
export function classifyIp(address: string): IpVerdict {
  const v4 = parseV4(address);
  if (v4) return classifyV4Bytes(v4);
  const v6 = parseV6(address);
  if (v6) return classifyV6Bytes(v6);
  return { ok: false, reason: "not an IP address" };
}

/** Hostnames that are refused by name, whatever they resolve to. */
export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".localdomain") ||
    h === "metadata" ||
    h === "instance-data"
  );
}
