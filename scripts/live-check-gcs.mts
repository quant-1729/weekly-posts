// Live check for the Cloud Storage backend (C-32). Opt-in: needs real buckets, so it is NOT part of npm test.
// Writes, reads, lists, signs and deletes a few small files under a throw-away brand id, then removes them.
//
// Needs (in .env.local or the environment):
//   GCS_BUCKET_PREFIX             the five buckets <prefix>-brand-assets / -inputs / -renders / -mascots / -photos must exist
//   GOOGLE_SERVICE_ACCOUNT_JSON   or GOOGLE_APPLICATION_CREDENTIALS / gcloud application-default login
//   GOOGLE_CLOUD_PROJECT          optional when the key file names its project
//
// Run: node --env-file=.env.local --import tsx scripts/live-check-gcs.mts
// Cost: a few Cloud Storage operations (well under $0.01). No AI calls.
import { randomUUID } from "node:crypto";
import { createGcsStorage } from "@/lib/storage/gcs";
import { BUCKETS } from "@/lib/storage/types";

const storage = createGcsStorage();
const brand = randomUUID();
const bytes = (s: string) => new TextEncoder().encode(s);
let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

try {
  for (const bucket of BUCKETS) {
    const p = `${brand}/live-check/${bucket}.txt`;
    await storage.put(bucket, p, bytes(`hello ${bucket}`), "text/plain");
    const got = await storage.get(bucket, p);
    check(`${bucket}: put then get`, new TextDecoder().decode(got?.bytes ?? new Uint8Array()) === `hello ${bucket}` && got?.contentType === "text/plain");
  }

  const bucket = "renders";
  const p = `${brand}/live-check/renders.txt`;
  await storage.put(bucket, p, bytes("second version"), "text/plain");
  const again = await storage.get(bucket, p);
  check("replace is visible at once", new TextDecoder().decode(again?.bytes ?? new Uint8Array()) === "second version");

  check("missing file is null", (await storage.get(bucket, `${brand}/live-check/nope.txt`)) === null);

  for (let i = 0; i < 5; i++) await storage.put(bucket, `${brand}/many/f${i}.txt`, bytes(String(i)), "text/plain");
  const listed = await storage.list(bucket, brand);
  check("list sees every file under the brand", listed.length === 6, `${listed.length} files`);

  const url = await storage.signedUrl?.(bucket, p, 300);
  check("signedUrl returns a URL", Boolean(url), url ? url.split("?")[0] : "not implemented");
  if (url) {
    const res = await fetch(url);
    check("the signed URL downloads without sign-in", res.status === 200 && (await res.text()) === "second version", `HTTP ${res.status}`);
    const bare = await fetch(url.split("?")[0]);
    check("the same address without the signature is refused", bare.status === 403 || bare.status === 401 || bare.status === 400, `HTTP ${bare.status}`);
  }

  const removed = await storage.removePrefix(bucket, brand);
  check("removePrefix removes the files", removed === 6, `${removed} removed`);
  check("removePrefix twice removes nothing", (await storage.removePrefix(bucket, brand)) === 0);
} finally {
  for (const bucket of BUCKETS) {
    try {
      await storage.removePrefix(bucket, brand);
    } catch (e) {
      console.warn(`cleanup of ${bucket} failed: ${(e as Error).message}`);
    }
  }
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
