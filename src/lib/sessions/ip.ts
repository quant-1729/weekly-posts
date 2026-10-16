import { createHmac } from "node:crypto";
import { getEnv } from "@/lib/env";

/**
 * The client's address is used for two things only: the offline city lookup and a keyed hash (so the admin can
 * tell "same network" from "different network" without ever seeing an address). The raw address is never stored.
 */

/** The first hop of x-forwarded-for (Cloud Run puts the real client there), else x-real-ip. Null when absent or not an address. */
export function clientIpFromHeaders(h: { get(name: string): string | null }): string | null {
  const raw = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "";
  if (!raw || raw.length > 64) return null;
  // IPv4, IPv6 (incl. ::ffff:1.2.3.4) or a bracketed/ported form: keep the address only.
  const bare = raw.replace(/^\[([^\]]+)\](?::\d+)?$/, "$1").replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, "$1");
  return /^[0-9a-fA-F:.]+$/.test(bare) && /[.:]/.test(bare) ? bare : null;
}

/** HMAC-SHA256 of the address under a key derived from AUTH_SECRET, cut to 32 hex characters. Null for no address. */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const key = createHmac("sha256", getEnv().authSecret).update("weekly-posts/ip-hash/v1").digest();
  return createHmac("sha256", key).update(ip.trim().toLowerCase()).digest("hex").slice(0, 32);
}
