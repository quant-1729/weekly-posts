// "Me (my own photos)" (F-6): consent with an email confirmation like a payment ID, then photos cut out by the matting
// service (a fake here), approved pose by pose. No AI is called anywhere in this file.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/f/[token]/route";
import { isPublicPath } from "@/lib/auth/public-paths";
import { resetRateLimits } from "@/lib/auth/rate-limit";
import type { MockDb } from "@/lib/db/mock";
import { listOutbox } from "@/lib/email/outbox";
import { FACE_CONSENT_TTL_MS, confirmFaceConsent, peekFaceConsent, requestFaceConsent } from "@/lib/faces/consent";
import { FACE_CSRF_COOKIE, faceNonce } from "@/lib/faces/consent-link";
import { FaceError } from "@/lib/faces/errors";
import { FaceGenError } from "@/lib/faces/generate/errors";
import { addOwnerPhoto } from "@/lib/faces/photos";
import { approveFace, approvePose, createDraftFace, getFace, listPoses } from "@/lib/faces/service";
import { loadFaceCard } from "@/lib/faces/card";
import { FACE_POSES } from "@/lib/faces/types";
import { setStorageForTests, type Storage } from "@/lib/storage";
import { createMockStorage } from "@/lib/storage/mock";
import { closeDb, makeOwner, openDb, type Owner } from "../helpers/details";
import { poseFixture } from "./helpers";

let db: MockDb;
let a: Owner;
let b: Owner;
let storage: Storage;
let dir: string;

const BASE = "http://localhost:3000";
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

beforeAll(async () => {
  db = await openDb();
  dir = mkdtempSync(path.join(os.tmpdir(), "pm-face-owner-"));
  storage = createMockStorage(dir);
  setStorageForTests(storage);
  a = await makeOwner(db, { name: "Corner Bakery" });
  b = await makeOwner(db, { name: "Other Shop" });
});
afterAll(async () => {
  setStorageForTests(null);
  rmSync(dir, { recursive: true, force: true });
  await closeDb(db);
});
beforeEach(() => resetRateLimits());
afterEach(() => vi.unstubAllEnvs());

const draft = (o: Owner = a) => createDraftFace(o.userId, o.brandId, { kind: "owner_photo", name: "Asha" });
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof FaceError ? e.code : e instanceof FaceGenError ? `gen:${e.code}` : `other:${String(e)}`;
  }
};
const consentOf = async (faceId: string) => (await db.withAdmin((tx) => tx.query<{ consent: Record<string, string> | null }>("select consent from public.brand_faces where id = $1", [faceId])))[0].consent;

async function lastLink() {
  const e = (await listOutbox())[0];
  const m = /https?:\/\/[^\s"'<>]+\/f\/([A-Za-z0-9_-]{43})/.exec(e.text)!;
  return { entry: e, token: m[1], url: m[0] };
}
const open = (token: string, cookie?: string) => GET(new NextRequest(`${BASE}/f/${token}`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ token }) });
const press = (token: string, nonce: string | undefined, cookie?: string) => {
  const body = new URLSearchParams();
  if (nonce !== undefined) body.set("nonce", nonce);
  return POST(new NextRequest(`${BASE}/f/${token}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) }, body }), { params: Promise.resolve({ token }) });
};
async function browser(token: string) {
  const res = await open(token);
  const html = await res.text();
  const secret = res.cookies.get(FACE_CSRF_COOKIE)?.value;
  return { res, html, cookie: secret ? `${FACE_CSRF_COOKIE}=${secret}` : undefined, nonce: /name="nonce" value="([^"]+)"/.exec(html)?.[1] };
}

/** A stand-in for the matting service: a transparent PNG, and a record of what it was sent. */
function fakeCutout() {
  const sent: Buffer[] = [];
  return {
    sent,
    fn: async (photo: Buffer) => {
      sent.push(photo);
      return poseFixture();
    },
  };
}
const photo = () => sharp({ create: { width: 800, height: 1200, channels: 3, background: "#7a8" } }).jpeg().toBuffer();

describe("the consent", () => {
  it("needs the box ticked: without it nothing is saved and no email is sent", async () => {
    const f = await draft();
    const before = (await listOutbox()).length;
    expect(await code(requestFaceConsent({ userId: a.userId, brandId: a.brandId, faceId: f.id, agreed: false }))).toBe("consent_missing");
    expect(await code(requestFaceConsent({ userId: a.userId, brandId: a.brandId, faceId: f.id, agreed: undefined }))).toBe("consent_missing");
    expect(await consentOf(f.id)).toBeNull();
    expect((await listOutbox()).length).toBe(before);
  });

  it("ticked: saves who and when, keeps only the token hash, and emails a face_consent link", async () => {
    const f = await draft();
    const t0 = new Date();
    const r = await requestFaceConsent({ userId: a.userId, brandId: a.brandId, faceId: f.id, agreed: true, now: t0 });
    expect(new Date(r.expiresAt).getTime() - t0.getTime()).toBe(FACE_CONSENT_TTL_MS);

    const { entry, token, url } = await lastLink();
    expect(entry.kind).toBe("face_consent");
    expect(entry.to).toMatch(/^owner-.*@example\.com$/);
    expect(entry.text).toContain("Corner Bakery");
    expect(entry.text).toContain("If this wasn't you, ignore this email; nothing changes.");
    expect(entry.html).toContain(url);
    const c = (await consentOf(f.id))!;
    expect(c).toMatchObject({ user_id: a.userId, text_version: "v1", token_hash: sha(token) });
    expect(c.email_confirmed_at).toBeUndefined();
    expect(JSON.stringify(c)).not.toContain(token);
    const log = await db.withAdmin((tx) => tx.query("select 1 from public.email_log where kind = 'face_consent' and brand_id = $1", [a.brandId]));
    expect(log.length).toBeGreaterThanOrEqual(1);
    // The card sees "asked, not confirmed" and never the token hash.
    const card = await loadFaceCard(a.userId, a.brandId);
    expect(card.faces.find((x) => x.id === f.id)!.consent).toEqual({ asked: true, confirmed: false, expired: false });
    expect(JSON.stringify(card)).not.toContain(sha(token));
  });

  it("is refused for another brand's face, for a face that is not the owner's own, and for a retired one", async () => {
    const f = await draft();
    expect(await code(requestFaceConsent({ userId: b.userId, brandId: b.brandId, faceId: f.id, agreed: true }))).toBe("not_found");
    const drawn = await createDraftFace(a.userId, a.brandId, { kind: "illustrated", name: "Mia", description: "A baker in a green apron", style: "flat" });
    expect(await code(requestFaceConsent({ userId: a.userId, brandId: a.brandId, faceId: drawn.id, agreed: true }))).toBe("bad_status");
    expect(await code(requestFaceConsent({ userId: a.userId, brandId: a.brandId, faceId: "not-a-uuid", agreed: true }))).toBe("not_found");
  });

  it("limits the emails to five an hour", async () => {
    const f = await draft();
    for (let i = 0; i < 5; i++) await requestFaceConsent({ userId: a.userId, brandId: a.brandId, faceId: f.id, agreed: true });
    expect(await code(requestFaceConsent({ userId: a.userId, brandId: a.brandId, faceId: f.id, agreed: true }))).toBe("consent_rate_limited");
  });

  it("GET shows the consent and changes nothing; POST with the nonce confirms, once", async () => {
    const f = await draft();
    await requestFaceConsent({ userId: a.userId, brandId: a.brandId, faceId: f.id, agreed: true });
    const { token } = await lastLink();

    const page = await browser(token);
    expect(page.res.status).toBe(200);
    expect(page.html).toContain("These are photos of me and I agree to appear in my posts.");
    expect(page.html).toContain("Asha");
    expect((await consentOf(f.id))!.email_confirmed_at).toBeUndefined(); // a mail scanner opening the link changes nothing

    expect((await press(token, undefined, page.cookie)).status).toBe(403); // no nonce
    const secret = "S".repeat(43);
    expect((await press(token, "wrong", `${FACE_CSRF_COOKIE}=${secret}`)).status).toBe(403);
    expect((await consentOf(f.id))!.email_confirmed_at).toBeUndefined();

    const done = await press(token, page.nonce, page.cookie);
    expect(done.status).toBe(200);
    expect(await done.text()).toContain("you are confirmed");
    expect((await getFace(a.userId, a.brandId, f.id)).consent?.emailConfirmedAt).toBeTruthy();
    expect((await consentOf(f.id))!.expires_at).toBeUndefined();

    const again = await press(token, page.nonce, page.cookie);
    expect(again.status).toBe(410);
    expect(await again.text()).toContain("already used");
    expect((await open(token)).status).toBe(410);
    expect(await confirmFaceConsent(token)).toEqual({ state: "used" });
  });

  it("an expired, a replaced and a made-up link are refused", async () => {
    const f = await draft();
    const old = new Date(Date.now() - 2 * 3600_000);
    await requestFaceConsent({ userId: a.userId, brandId: a.brandId, faceId: f.id, agreed: true, now: old });
    const { token } = await lastLink();
    expect((await open(token)).status).toBe(410);
    const secret = "S".repeat(43);
    expect((await press(token, faceNonce(token, secret), `${FACE_CSRF_COOKIE}=${secret}`)).status).toBe(410);
    expect(await peekFaceConsent(token)).toEqual({ state: "expired" });
    expect((await consentOf(f.id))!.email_confirmed_at).toBeUndefined();
    const card = await loadFaceCard(a.userId, a.brandId);
    expect(card.faces.find((x) => x.id === f.id)!.consent).toEqual({ asked: true, confirmed: false, expired: true });

    // A new email replaces the old link.
    await requestFaceConsent({ userId: a.userId, brandId: a.brandId, faceId: f.id, agreed: true });
    expect(await peekFaceConsent(token)).toEqual({ state: "invalid" });
    expect((await open("A".repeat(43))).status).toBe(404);
    expect((await open("short")).status).toBe(404);
  });

  it("the link page is public (no sign-in) like the payment link", () => {
    expect(isPublicPath(`/f/${"A".repeat(43)}`)).toBe(true);
  });
});

describe("photos of the owner", () => {
  async function confirmed(o: Owner = a) {
    const f = await draft(o);
    await requestFaceConsent({ userId: o.userId, brandId: o.brandId, faceId: f.id, agreed: true });
    const { token } = await lastLink();
    expect((await confirmFaceConsent(token)).state).toBe("confirmed");
    return f;
  }

  it("are refused before the consent is confirmed", async () => {
    const f = await draft();
    const cut = fakeCutout();
    expect(await code(addOwnerPhoto({ userId: a.userId, brandId: a.brandId, faceId: f.id, poses: ["wave"], photo: await photo(), deps: { cutout: cut.fn, storage } }))).toBe("needs_consent");
    await requestFaceConsent({ userId: a.userId, brandId: a.brandId, faceId: f.id, agreed: true });
    expect(await code(addOwnerPhoto({ userId: a.userId, brandId: a.brandId, faceId: f.id, poses: ["wave"], photo: await photo(), deps: { cutout: cut.fn, storage } }))).toBe("needs_consent");
    expect(cut.sent).toHaveLength(0);
    expect(await listPoses(a.userId, a.brandId, f.id)).toEqual([]);
  });

  it("without the cut-out service say 'Background removal isn't set up yet' and keep the card usable", async () => {
    vi.stubEnv("CUTOUT_URL", "");
    const f = await confirmed();
    expect(await code(addOwnerPhoto({ userId: a.userId, brandId: a.brandId, faceId: f.id, poses: ["wave"], photo: await photo(), deps: { storage } }))).toBe("gen:cutout_not_configured");
    const card = await loadFaceCard(a.userId, a.brandId);
    expect(card.cutoutConfigured).toBe(false);
    expect(card.faces.find((x) => x.id === f.id)!.consent).toEqual({ asked: true, confirmed: true, expired: false });
    expect(await listPoses(a.userId, a.brandId, f.id)).toEqual([]);
    vi.stubEnv("CUTOUT_URL", "https://cutout.example.com/cut");
    expect((await loadFaceCard(a.userId, a.brandId)).cutoutConfigured).toBe(true);
  });

  it("are cut out with the matting mode, saved as unapproved poses, and one photo can fill several poses; the original is not kept", async () => {
    const f = await confirmed();
    const modes: string[] = [];
    const cut = async (p: Buffer, mode: string) => {
      modes.push(mode);
      return poseFixture();
    };
    const saved = await addOwnerPhoto({ userId: a.userId, brandId: a.brandId, faceId: f.id, poses: ["wave", "talk", "wave"], photo: await photo(), deps: { cutout: cut as never, storage } });
    expect(saved.map((p) => p.pose)).toEqual(["wave", "talk"]);
    expect(modes).toEqual(["matting"]); // one cut-out for both poses
    const poses = await listPoses(a.userId, a.brandId, f.id);
    expect(poses.every((p) => p.approvedAt === null)).toBe(true);
    const files = await storage.list("mascots", `${a.brandId}/faces/${f.id}`);
    expect(files.sort()).toEqual([`${a.brandId}/faces/${f.id}/talk.png`, `${a.brandId}/faces/${f.id}/wave.png`]);
  });

  it("need all seven poses approved and the confirmed consent before the face can be approved", async () => {
    const f = await confirmed();
    const cut = fakeCutout();
    await addOwnerPhoto({ userId: a.userId, brandId: a.brandId, faceId: f.id, poses: [...FACE_POSES], photo: await photo(), deps: { cutout: cut.fn, storage } });
    expect(cut.sent).toHaveLength(1);
    expect(await code(approveFace(a.userId, a.brandId, f.id))).toBe("needs_poses");
    for (const pose of FACE_POSES) await approvePose(a.userId, a.brandId, f.id, pose);
    expect((await approveFace(a.userId, a.brandId, f.id)).status).toBe("approved");
  });

  it("without a confirmed consent the face cannot be approved even with all poses (the database checks too)", async () => {
    const f = await draft();
    const cut = fakeCutout();
    await db.withAdmin((tx) => tx.query("update public.brand_faces set consent = '{\"user_id\":\"x\"}'::jsonb where id = $1", [f.id]));
    for (const pose of FACE_POSES) {
      const png = await poseFixture();
      const { savePoseImage } = await import("@/lib/faces/service");
      await savePoseImage({ userId: a.userId, brandId: a.brandId, faceId: f.id, pose, png, storage });
      await approvePose(a.userId, a.brandId, f.id, pose);
    }
    expect(cut.sent).toHaveLength(0);
    expect(await code(approveFace(a.userId, a.brandId, f.id))).toBe("needs_consent");
    await expect(db.withAdmin((tx) => tx.query("update public.brand_faces set status = 'approved' where id = $1", [f.id]))).rejects.toThrow();
  });

  it("are refused for another brand's face", async () => {
    const f = await confirmed();
    const cut = fakeCutout();
    expect(await code(addOwnerPhoto({ userId: b.userId, brandId: b.brandId, faceId: f.id, poses: ["wave"], photo: await photo(), deps: { cutout: cut.fn, storage } }))).toBe("not_found");
    expect(cut.sent).toHaveLength(0);
  });
});

describe("consent can't be confirmed by the owner directly (DB guard)", () => {
  it("a signed-in member setting consent.email_confirmed_at is refused; the server role may", async () => {
    const o = a;
    const [face] = await db.withUser(o.userId, (tx) =>
      tx.query<{ id: string }>("insert into public.brand_faces (brand_id, kind, name) values ($1, 'owner_photo', 'Me') returning id", [o.brandId]),
    );
    await expect(
      db.withUser(o.userId, (tx) => tx.query(`update public.brand_faces set consent = '{"email_confirmed_at":"2026-10-15T00:00:00Z"}'::jsonb where id = $1`, [face.id])),
    ).rejects.toThrow(/confirmed by email/);
    await db.withService((tx) => tx.query(`update public.brand_faces set consent = '{"email_confirmed_at":"2026-10-15T00:00:00Z"}'::jsonb where id = $1`, [face.id]));
  });
});
