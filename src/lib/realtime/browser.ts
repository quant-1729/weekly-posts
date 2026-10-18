// Live status in the browser (docs/14-firebase-plan.md §4 and §6). Browser only. Firebase is NEVER imported at the top of this
// file: the three SDK parts are loaded with import() once /api/live/token has answered "firestore", so a screen that is not
// live (the switch is off, the owner is offline, the token call fails) downloads nothing extra and behaves as before.
//
// One session per tab: it asks the server for a short-lived custom token for the current brand, signs in with it (in memory
// only, nothing is stored on the device), renews it five minutes before it ends, and asks for a new one when the brand
// changes. The documents are a doorbell: they say "something changed"; the screen re-reads the details through server actions.

import type { Firestore, Query, DocumentReference, FirestoreError, QuerySnapshot, DocumentSnapshot } from 'firebase/firestore';
import type { LiveDataByKind, LiveKind } from './types';

type FirestoreModule = typeof import('firebase/firestore');

/** What the server's /api/live/token route sends when live status is on. */
export interface LiveTokenResponse {
  mode: 'firestore';
  token: string;
  brandId: string;
  /** Epoch ms when the token's claim ends. */
  until: number;
  config: { apiKey: string; authDomain: string; projectId: string; appId: string };
}

/** A signed-in Firestore connection for one brand. */
export interface LiveSession {
  brandId: string;
  /** Epoch ms when the token's claim ends. */
  until: number;
  /** Counts up with every new token; lets a listener ask for a new one only if nobody else already has. */
  gen: number;
  db: Firestore;
  fs: FirestoreModule;
}

type LiveMeta = { id: string; seq: number };
/** A status document as the screens see it: its fields, its doc id and its `seq`. */
export type LiveRecordOf<K extends LiveKind> = { kind: K } & LiveMeta & (LiveDataByKind[K] extends Record<string, never> ? unknown : LiveDataByKind[K]);
export type LiveRecord = { [K in LiveKind]: LiveRecordOf<K> }[LiveKind];

/** One document as read from Firestore, before filtering. */
export interface LiveEntry {
  id: string;
  data: Record<string, unknown>;
}

/** The token is renewed this long before its claim ends. */
export const RENEW_BEFORE_MS = 5 * 60 * 1000;
/** Never renew sooner than this after (re)connecting, so a short token cannot cause a tight loop. */
export const MIN_RENEW_DELAY_MS = 15 * 1000;
/** After a failed or "off" answer, the next try waits this long (an "off" server stays off until the page is loaded again). */
export const NEGATIVE_TTL_MS = 60 * 1000;

/** How long to wait before renewing a token whose claim ends at `until`: at `until − 5 min`, but not sooner than 15 s. */
export function renewDelayMs(until: number, now: number): number {
  return Math.max(MIN_RENEW_DELAY_MS, until - RENEW_BEFORE_MS - now);
}

/** A Firestore Timestamp, Date or number as epoch ms; undefined when it is none of those. */
function toMs(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v instanceof Date) return v.getTime();
  if (v && typeof v === 'object' && typeof (v as { toMillis?: unknown }).toMillis === 'function') {
    const ms = (v as { toMillis: () => number }).toMillis();
    return Number.isFinite(ms) ? ms : undefined;
  }
  return undefined;
}

/**
 * Folds one snapshot into what the screen already knows. A document whose `expireAt` has passed is ignored (the server's TTL
 * policy deletes it later); a document with a lower `seq` than the one already seen is ignored, so an old write arriving late
 * cannot undo a newer one; a document with no `seq` or `kind` is ignored. Documents no longer in the snapshot are dropped.
 */
export function reduceLive(prev: ReadonlyMap<string, LiveRecord>, entries: readonly LiveEntry[], now: number): Map<string, LiveRecord> {
  const next = new Map<string, LiveRecord>();
  for (const { id, data } of entries) {
    const expires = toMs(data.expireAt);
    if (expires !== undefined && expires <= now) continue;
    const seq = data.seq;
    if (typeof seq !== 'number' || !Number.isFinite(seq) || typeof data.kind !== 'string') continue;
    const seen = prev.get(id);
    if (seen && seq < seen.seq) {
      next.set(id, seen);
      continue;
    }
    // Plain fields only: the Timestamps (updatedAt, expireAt) and the schema version stay behind.
    const fields: Record<string, unknown> = { ...data, id, seq };
    delete fields.updatedAt;
    delete fields.expireAt;
    delete fields.v;
    next.set(id, fields as LiveRecord);
  }
  return next;
}

// ---- The session (one per tab) ------------------------------------------------------------------------------------------

interface Sdk {
  app: typeof import('firebase/app');
  auth: typeof import('firebase/auth');
  fs: FirestoreModule;
}
interface Client {
  db: Firestore;
  auth: import('firebase/auth').Auth;
}
interface State {
  brandId: string;
  gen: number;
  promise: Promise<LiveSession | null>;
  /** undefined while the token call is still going. */
  settled?: { session: LiveSession | null; at: number };
  timer?: ReturnType<typeof setTimeout>;
}

let sdkPromise: Promise<Sdk> | null = null;
let client: Client | null = null;
let state: State | null = null;
let generation = 0;

/** Test helper: forget the session, the loaded SDK and any renewal timer. */
export function resetLiveBrowserForTests(): void {
  if (state?.timer) clearTimeout(state.timer);
  state = null;
  client = null;
  sdkPromise = null;
  generation = 0;
}

function loadSdk(): Promise<Sdk> {
  sdkPromise ??= Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')])
    .then(([app, auth, fs]) => ({ app, auth, fs }))
    .catch((e: unknown) => {
      sdkPromise = null;
      throw e;
    });
  return sdkPromise;
}

function readToken(body: unknown): LiveTokenResponse | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Partial<LiveTokenResponse>;
  const c = b.config;
  if (b.mode !== 'firestore' || typeof b.token !== 'string' || typeof b.brandId !== 'string' || typeof b.until !== 'number') return null;
  if (!c || typeof c.apiKey !== 'string' || typeof c.authDomain !== 'string' || typeof c.projectId !== 'string' || typeof c.appId !== 'string') return null;
  return b as LiveTokenResponse;
}

/** The one Firebase app named 'live', with in-memory sign-in (nothing stored, no popup/redirect resolver). */
function getClient(sdk: Sdk, config: LiveTokenResponse['config']): Client {
  if (client) return client;
  const app = sdk.app.getApps().find((a) => a.name === 'live') ?? sdk.app.initializeApp(config, 'live');
  let auth: Client['auth'];
  try {
    auth = sdk.auth.initializeAuth(app, { persistence: sdk.auth.inMemoryPersistence });
  } catch {
    auth = sdk.auth.getAuth(app); // already initialised (for example after a hot reload)
  }
  client = { auth, db: sdk.fs.getFirestore(app) };
  return client;
}

async function connect(brandId: string, gen: number): Promise<LiveSession | null> {
  let token: LiveTokenResponse | null;
  try {
    const res = await fetch('/api/live/token', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return null;
    token = readToken(await res.json());
  } catch {
    return null;
  }
  // "off", an odd answer, or the server's current brand is not the one asked about: not live.
  if (!token || token.brandId !== brandId) return null;
  try {
    const sdk = await loadSdk();
    const c = getClient(sdk, token.config);
    await sdk.auth.signInWithCustomToken(c.auth, token.token);
    return { brandId, until: token.until, gen, db: c.db, fs: sdk.fs };
  } catch {
    return null;
  }
}

function usable(cur: State, now: number): boolean {
  if (!cur.settled) return true;
  const { session, at } = cur.settled;
  return session ? session.until > now : now - at < NEGATIVE_TTL_MS;
}

/** Starts a new token call for `brandId`, replacing the current state and its renewal timer. */
function start(brandId: string): State {
  if (state?.timer) clearTimeout(state.timer);
  const gen = ++generation;
  const next: State = { brandId, gen, promise: Promise.resolve(null) };
  state = next;
  next.promise = connect(brandId, gen).then((session) => {
    next.settled = { session, at: Date.now() };
    // Renew before the claim ends, unless a newer call has replaced this one.
    if (session && state === next) {
      next.timer = setTimeout(() => {
        if (state === next) void ensureSession(brandId, gen);
      }, renewDelayMs(session.until, Date.now()));
    }
    return session;
  });
  return next;
}

/**
 * The tab's session for `brandId`. Shared by everything on the page. Asks the server for a token only when there is none for
 * this brand, it is about to end, or `staleGen` says the one in use was refused (and nobody has renewed it since).
 */
function ensureSession(brandId: string, staleGen?: number): Promise<LiveSession | null> {
  const cur = state;
  if (cur && cur.brandId === brandId && cur.gen !== staleGen && usable(cur, Date.now())) return cur.promise;
  return start(brandId).promise;
}

/**
 * The live session for `brandId`, or null when live status is off, the token call failed, or Firebase could not load. One
 * session per tab; asking again returns the same one. A different brand gets a new token.
 */
export function liveSession(brandId: string): Promise<LiveSession | null> {
  return ensureSession(brandId);
}

// ---- Listening ---------------------------------------------------------------------------------------------------------

/**
 * Listens to something under the session and keeps the filtered records. On `permission-denied` it asks for one new token and
 * listens again; a second refusal, or any other failure, gives up (`onLive(false)`). Returns the unsubscribe.
 */
function listen(
  brandId: string,
  attach: (s: LiveSession, next: (entries: LiveEntry[]) => void, error: (e: FirestoreError) => void) => () => void,
  onRecords: (records: LiveRecord[]) => void,
  onLive?: (live: boolean) => void,
): () => void {
  let stopped = false;
  let retried = false;
  let announced = false;
  let detach: (() => void) | null = null;
  let known: Map<string, LiveRecord> = new Map();

  const giveUp = () => {
    if (!stopped) onLive?.(false);
  };

  const begin = async (staleGen?: number) => {
    const session = await ensureSession(brandId, staleGen);
    if (stopped) return;
    if (!session) return giveUp();
    try {
      detach = attach(
        session,
        (entries) => {
          if (stopped) return;
          known = reduceLive(known, entries, Date.now());
          onRecords([...known.values()]);
          if (!announced) {
            announced = true;
            onLive?.(true);
          }
        },
        (error) => {
          if (stopped) return;
          detach?.();
          detach = null;
          if (error.code === 'permission-denied' && !retried) {
            retried = true;
            void begin(session.gen);
          } else {
            giveUp();
          }
        },
      );
    } catch {
      giveUp();
    }
  };
  void begin();

  return () => {
    stopped = true;
    detach?.();
    detach = null;
  };
}

/**
 * Listens to one status document, `brands/{brandId}/live/{docId}`. `cb` gets the document, or null while it does not exist
 * (or has expired). `onLive(true)` comes with the first answer from Firestore, `onLive(false)` when live status is off or the
 * listener gave up. Returns the unsubscribe.
 */
export function watchDoc(brandId: string, docId: string, cb: (doc: LiveRecord | null) => void, onLive?: (live: boolean) => void): () => void {
  return listen(
    brandId,
    ({ db, fs }, next, error) => {
      const ref: DocumentReference = fs.doc(db, 'brands', brandId, 'live', docId);
      return fs.onSnapshot(
        ref,
        (snap: DocumentSnapshot) => next(snap.exists() ? [{ id: snap.id, data: snap.data() as Record<string, unknown> }] : []),
        error,
      );
    },
    (records) => cb(records[0] ?? null),
    onLive,
  );
}

/**
 * Listens to every status document of one `kind` for the brand. `cb` gets all current ones (newest `seq` per document,
 * expired ones left out). Same `onLive` and unsubscribe as watchDoc.
 */
export function watchKind(brandId: string, kind: LiveKind, cb: (docs: LiveRecord[]) => void, onLive?: (live: boolean) => void): () => void {
  return listen(
    brandId,
    ({ db, fs }, next, error) => {
      const q: Query = fs.query(fs.collection(db, 'brands', brandId, 'live'), fs.where('kind', '==', kind));
      return fs.onSnapshot(
        q,
        (snap: QuerySnapshot) => next(snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))),
        error,
      );
    },
    cb,
    onLive,
  );
}
