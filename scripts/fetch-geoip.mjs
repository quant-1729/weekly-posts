// Downloads the DB-IP "IP to City Lite" database (MMDB, CC BY 4.0: "IP geolocation by DB-IP") at Docker build time.
//
//   node scripts/fetch-geoip.mjs <output-file> [YYYY-MM]
//
// Tries the given month (default: the current month in UTC), then the previous month, then the one before.
// DB-IP publishes each month's file early in that month, so the first days of a month fall back to the last one.
// It NEVER fails the build: if nothing can be downloaded it says so and exits 0. The app then runs without
// the file (GEOIP_DB_PATH points at a missing file) and sign-in sessions simply have no city or country.
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

const out = process.argv[2];
if (!out) {
  console.error("[geoip] usage: node fetch-geoip.mjs <output-file> [YYYY-MM]");
  process.exit(0);
}

function months(start) {
  const m = /^(\d{4})-(\d{2})$/.exec(start ?? "");
  const now = new Date();
  let y = m ? Number(m[1]) : now.getUTCFullYear();
  let mo = m ? Number(m[2]) : now.getUTCMonth() + 1;
  const list = [];
  for (let i = 0; i < 3; i++) {
    list.push(`${y}-${String(mo).padStart(2, "0")}`);
    mo -= 1;
    if (mo === 0) {
      mo = 12;
      y -= 1;
    }
  }
  return list;
}

async function download(month) {
  const url = `https://download.db-ip.com/free/dbip-city-lite-${month}.mmdb.gz`;
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const tmp = `${out}.part`;
  await pipeline(Readable.fromWeb(res.body), createGunzip(), createWriteStream(tmp));
  const { size } = await stat(tmp);
  if (size < 1_000_000) throw new Error(`file too small (${size} bytes)`);
  await rename(tmp, out);
  return size;
}

try {
  await mkdir(path.dirname(out), { recursive: true });
  let done = false;
  for (const month of months(process.argv[3])) {
    try {
      const size = await download(month);
      console.log(`[geoip] downloaded dbip-city-lite-${month} (${size} bytes) to ${out}`);
      done = true;
      break;
    } catch (e) {
      console.warn(`[geoip] ${month} not available: ${e?.message ?? e}`);
      await rm(`${out}.part`, { force: true }).catch(() => undefined);
    }
  }
  if (!done) console.warn("[geoip] no database downloaded; the app will run without city/country lookup.");
} catch (e) {
  console.warn(`[geoip] skipped: ${e?.message ?? e}`);
}
process.exit(0);
