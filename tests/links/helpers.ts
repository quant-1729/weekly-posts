import { NextRequest } from "next/server";
import type { MockDb } from "@/lib/db/mock";
import type { Storage } from "@/lib/storage";
import { generateWeek } from "@/lib/weekly/generate";
import { GET as pageGet, POST as pagePost } from "@/app/e/[token]/route";
import { LINK_CSRF_COOKIE } from "@/lib/links/csrf";
import { seedWeeklyBrand, type WeeklyBrandOpts } from "../weekly/helpers";

export const WEEK = "2026-12-21";
export const GEN_NOW = new Date("2026-12-21T08:00:00Z");
export const BASE = "http://localhost:3100";

export interface SeededWeek {
  userId: string;
  brandId: string;
  batchId: string;
  postIds: string[];
}

/** A brand with a generated (fixture) week: 4 posts with three rendered images each. */
export async function seedReadyWeek(db: MockDb, storage: Storage, opts: WeeklyBrandOpts = {}): Promise<SeededWeek> {
  const { userId, brandId } = await seedWeeklyBrand(db, { photos: 2, storage, ...opts });
  const res = await generateWeek({ brandId, weekStart: WEEK, trigger: "cron" }, { now: GEN_NOW, storage });
  if (res.status !== "ready") throw new Error(`seed week failed: ${JSON.stringify(res)}`);
  return { userId, brandId, batchId: res.batchId, postIds: res.posts.map((p) => p.id) };
}

const ctx = (token: string) => ({ params: Promise.resolve({ token }) });

export async function openLink(token: string, cookie?: string) {
  return pageGet(
    new NextRequest(`${BASE}/e/${token}`, { headers: cookie ? { cookie: `${LINK_CSRF_COOKIE}=${cookie}` } : {} }),
    ctx(token),
  );
}

export async function pressLink(token: string, fields: Record<string, string>, cookie?: string) {
  return pagePost(
    new NextRequest(`${BASE}/e/${token}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(cookie ? { cookie: `${LINK_CSRF_COOKIE}=${cookie}` } : {}),
      },
      body: new URLSearchParams(fields),
    }),
    ctx(token),
  );
}

/** The CSRF cookie value a GET response set. */
export function cookieOf(res: Response): string | undefined {
  for (const c of res.headers.getSetCookie()) {
    const m = new RegExp(`^${LINK_CSRF_COOKIE}=([^;]+)`).exec(c);
    if (m) return m[1];
  }
  return undefined;
}

/** The nonce in the first form of a page. */
export function nonceOf(html: string): string {
  const m = /name="nonce" value="([^"]+)"/.exec(html);
  if (!m) throw new Error("no nonce in page");
  return m[1];
}

/** What a person does: open the link, then press the button (with optional extra fields). */
export async function openThenPress(token: string, fields: Record<string, string> = {}) {
  const got = await openLink(token);
  const cookie = cookieOf(got);
  const html = await got.text();
  const posted = await pressLink(token, { nonce: nonceOf(html), ...fields }, cookie);
  return { got, posted, cookie, html, resultHtml: await posted.text() };
}
