// The Firestore side of live status. firebase-admin is loaded only here, only by dynamic import, and only when the mode is
// 'firestore': never in mock or off mode and never under vitest. Cloud Run stays keyless: signing a custom token goes through
// IAM signBlob as FIREBASE_SERVICE_ACCOUNT_ID (docs/14-firebase-plan.md §4).

import type { App } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';
import type { LiveWrite } from './mock';

const APP_NAME = 'realtime';

let appPromise: Promise<App> | null = null;
let dbPromise: Promise<Firestore> | null = null;

function adminApp(): Promise<App> {
  appPromise ??= (async () => {
    const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
    if (!projectId) throw new Error('FIREBASE_PROJECT_ID is not set');
    const { applicationDefault, getApps, initializeApp } = await import('firebase-admin/app');
    const existing = getApps().find((a) => a.name === APP_NAME);
    if (existing) return existing;
    const serviceAccountId = process.env.FIREBASE_SERVICE_ACCOUNT_ID?.trim() || undefined;
    return initializeApp({ credential: applicationDefault(), projectId, serviceAccountId }, APP_NAME);
  })();
  // A failed start must not be remembered forever.
  appPromise.catch(() => {
    appPromise = null;
  });
  return appPromise;
}

function firestore(): Promise<Firestore> {
  dbPromise ??= (async () => {
    const app = await adminApp();
    const { initializeFirestore } = await import('firebase-admin/firestore');
    // REST instead of gRPC: smaller image, no long-lived streams on Cloud Run.
    return initializeFirestore(app, { preferRest: true });
  })();
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

/** Writes one sanitised status document: the allow-listed fields plus kind, v, seq, updatedAt and expireAt. */
export async function writeLiveDoc(w: LiveWrite): Promise<void> {
  const [db, { FieldValue, Timestamp }] = await Promise.all([firestore(), import('firebase-admin/firestore')]);
  await db.doc(w.path).set({
    ...w.data,
    kind: w.kind,
    v: w.v,
    seq: w.seq,
    updatedAt: FieldValue.serverTimestamp(),
    expireAt: Timestamp.fromMillis(w.expireAtMs),
  });
}

/** A Firebase custom token for `uid` with exactly the given developer claims. */
export async function createLiveCustomToken(uid: string, claims: Record<string, string | number>): Promise<string> {
  const app = await adminApp();
  const { getAuth } = await import('firebase-admin/auth');
  return getAuth(app).createCustomToken(uid, claims);
}
