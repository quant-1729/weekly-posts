// The browser side of live status (docs/14-firebase-plan.md §4, §6): the pure filtering, the renewal timing, the "off" path
// and the session and listener behaviour, with fetch and the three firebase packages mocked. No network is used.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => {
  const listeners: { target: unknown; next: (snap: unknown) => void; error: (e: { code: string }) => void; unsub: ReturnType<typeof vi.fn> }[] = [];
  return {
    listeners,
    initializeApp: vi.fn((config: unknown, name: string) => ({ name, config })),
    getApps: vi.fn((): { name: string }[] => []),
    initializeAuth: vi.fn(() => ({ kind: "auth" })),
    getAuth: vi.fn(() => ({ kind: "auth" })),
    signInWithCustomToken: vi.fn(async () => ({})),
    inMemoryPersistence: { type: "NONE" },
    getFirestore: vi.fn(() => ({ kind: "db" })),
    doc: vi.fn((_db: unknown, ...path: string[]) => ({ kind: "doc", path: path.join("/") })),
    collection: vi.fn((_db: unknown, ...path: string[]) => ({ kind: "collection", path: path.join("/") })),
    where: vi.fn((field: string, op: string, value: unknown) => ({ kind: "where", field, op, value })),
    query: vi.fn((col: unknown, ...clauses: unknown[]) => ({ kind: "query", col, clauses })),
    onSnapshot: vi.fn((target: unknown, next: (snap: unknown) => void, error: (e: { code: string }) => void) => {
      const unsub = vi.fn();
      listeners.push({ target, next, error, unsub });
      return unsub;
    }),
  };
});
vi.mock("firebase/app", () => ({ initializeApp: sdk.initializeApp, getApps: sdk.getApps }));
vi.mock("firebase/auth", () => ({
  initializeAuth: sdk.initializeAuth,
  getAuth: sdk.getAuth,
  signInWithCustomToken: sdk.signInWithCustomToken,
  inMemoryPersistence: sdk.inMemoryPersistence,
}));
vi.mock("firebase/firestore", () => ({
  getFirestore: sdk.getFirestore,
  doc: sdk.doc,
  collection: sdk.collection,
  where: sdk.where,
  query: sdk.query,
  onSnapshot: sdk.onSnapshot,
}));

import {
  MIN_RENEW_DELAY_MS,
  NEGATIVE_TTL_MS,
  RENEW_BEFORE_MS,
  liveSession,
  reduceLive,
  renewDelayMs,
  resetLiveBrowserForTests,
  watchDoc,
  watchKind,
  type LiveEntry,
  type LiveRecord,
} from "@/lib/realtime/browser";

const BRAND_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BRAND_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONFIG = { apiKey: "key-1", authDomain: "proj-1.firebaseapp.com", projectId: "proj-1", appId: "1:2:web:3" };
const HOUR = 60 * 60 * 1000;

const fetchMock = vi.fn();
const answer = (body: unknown, ok = true) => fetchMock.mockResolvedValueOnce({ ok, json: async () => body });
const firestoreAnswer = (brandId: string, until: number, token = "tok") => answer({ mode: "firestore", token, brandId, until, config: CONFIG });

const ts = (ms: number) => ({ toMillis: () => ms });
const queueData = (seq: number, extra: Record<string, unknown> = {}) => ({
  kind: "queue",
  v: 1,
  seq,
  updatedAt: ts(1),
  expireAt: ts(Date.now() + HOUR),
  itemId: "i1",
  postId: "p1",
  channel: "instagram",
  status: "published",
  mode: "publish",
  attempts: 1,
  slotAt: "2026-10-18T10:00:00.000Z",
  ...extra,
});
const entry = (id: string, data: Record<string, unknown>): LiveEntry => ({ id, data });
const snapDoc = (id: string, data: Record<string, unknown>) => ({ id, exists: () => true, data: () => data });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  for (const k of ["initializeApp", "initializeAuth", "getAuth", "signInWithCustomToken", "getFirestore", "doc", "collection", "where", "query", "onSnapshot"] as const) {
    sdk[k].mockClear();
  }
  sdk.listeners.length = 0;
  sdk.getApps.mockReturnValue([]);
  resetLiveBrowserForTests();
});
afterEach(() => {
  resetLiveBrowserForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("renewDelayMs", () => {
  it("renews five minutes before the claim ends", () => {
    expect(renewDelayMs(1_000_000 + HOUR, 1_000_000)).toBe(HOUR - RENEW_BEFORE_MS);
  });
  it("never renews sooner than the minimum delay, even for a token that is nearly over", () => {
    expect(renewDelayMs(1_000_000 + 60_000, 1_000_000)).toBe(MIN_RENEW_DELAY_MS);
    expect(renewDelayMs(1_000_000 - 5, 1_000_000)).toBe(MIN_RENEW_DELAY_MS);
  });
});

describe("reduceLive", () => {
  const NOW = Date.now();
  const rec = (seq: number): LiveRecord => ({ kind: "queue_touch", id: "queue_touch", seq }) as LiveRecord;

  it("keeps the fields and the id and seq, and leaves the timestamps and version behind", () => {
    const out = reduceLive(new Map(), [entry("q_1", queueData(5, { expireAt: ts(NOW + HOUR) }))], NOW);
    const r = out.get("q_1") as unknown as Record<string, unknown>;
    expect(r).toMatchObject({ id: "q_1", seq: 5, kind: "queue", status: "published", channel: "instagram" });
    expect(r).not.toHaveProperty("updatedAt");
    expect(r).not.toHaveProperty("expireAt");
    expect(r).not.toHaveProperty("v");
  });

  it("ignores a document whose expireAt has passed (Timestamp, Date or number)", () => {
    const out = reduceLive(
      new Map(),
      [
        entry("a", queueData(1, { expireAt: ts(NOW - 1) })),
        entry("b", queueData(1, { expireAt: new Date(NOW) })),
        entry("c", queueData(1, { expireAt: NOW - 1000 })),
        entry("d", queueData(1, { expireAt: ts(NOW + 1) })),
      ],
      NOW,
    );
    expect([...out.keys()]).toEqual(["d"]);
  });

  it("ignores a lower seq than the one already seen for the same doc, and keeps what was known", () => {
    const first = reduceLive(new Map(), [entry("q_1", queueData(10, { status: "published" }))], NOW);
    const late = reduceLive(first, [entry("q_1", queueData(9, { status: "publishing" }))], NOW);
    expect(late.get("q_1")).toBe(first.get("q_1"));
    expect((late.get("q_1") as unknown as { status: string }).status).toBe("published");
  });

  it("takes an equal or higher seq", () => {
    const first = reduceLive(new Map(), [entry("q_1", queueData(10, { status: "publishing" }))], NOW);
    const same = reduceLive(first, [entry("q_1", queueData(10, { status: "published" }))], NOW);
    const higher = reduceLive(same, [entry("q_1", queueData(11, { status: "failed" }))], NOW);
    expect((same.get("q_1") as unknown as { status: string }).status).toBe("published");
    expect((higher.get("q_1") as unknown as { status: string }).status).toBe("failed");
    expect(higher.get("q_1")?.seq).toBe(11);
  });

  it("treats seq per document, drops documents that left the snapshot, and ignores ones with no seq or kind", () => {
    const prev = new Map([["gone", rec(99)], ["q_2", rec(50)]]);
    const out = reduceLive(prev, [entry("q_2", queueData(1)), entry("q_3", queueData(2)), entry("bad1", { kind: "queue" }), entry("bad2", { seq: 3 })], NOW);
    expect([...out.keys()]).toEqual(["q_2", "q_3"]);
    expect(out.get("q_2")).toBe(prev.get("q_2")); // lower seq than 50: the known one stays
    expect(out.has("gone")).toBe(false);
  });
});

describe("liveSession when live status is off", () => {
  it("answers null for { mode: 'off' }, loads no firebase code, and does not ask again straight away", async () => {
    answer({ mode: "off" });
    expect(await liveSession(BRAND_A)).toBeNull();
    expect(await liveSession(BRAND_A)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/live/token", expect.objectContaining({ method: "POST", credentials: "same-origin", cache: "no-store" }));
    expect(sdk.initializeApp).not.toHaveBeenCalled();
    expect(sdk.signInWithCustomToken).not.toHaveBeenCalled();
  });

  it("asks again once the wait after a negative answer has passed", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    answer({ mode: "off" });
    await liveSession(BRAND_A);
    await vi.advanceTimersByTimeAsync(NEGATIVE_TTL_MS + 1);
    firestoreAnswer(BRAND_A, Date.now() + HOUR);
    expect(await liveSession(BRAND_A)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("answers null for a refused call, a failed fetch and an odd body", async () => {
    answer({ ok: false, code: "signed_out" }, false);
    expect(await liveSession(BRAND_A)).toBeNull();
    resetLiveBrowserForTests();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await liveSession(BRAND_A)).toBeNull();
    resetLiveBrowserForTests();
    answer({ mode: "firestore", token: 5 });
    expect(await liveSession(BRAND_A)).toBeNull();
    expect(sdk.initializeApp).not.toHaveBeenCalled();
  });

  it("is not live when the token is for a different brand than asked", async () => {
    firestoreAnswer(BRAND_B, Date.now() + HOUR);
    expect(await liveSession(BRAND_A)).toBeNull();
    expect(sdk.signInWithCustomToken).not.toHaveBeenCalled();
  });

  it("reports onLive(false) to a watcher and never listens", async () => {
    answer({ mode: "off" });
    const onLive = vi.fn();
    const cb = vi.fn();
    watchDoc(BRAND_A, "queue_touch", cb, onLive);
    await vi.waitFor(() => expect(onLive).toHaveBeenCalledWith(false));
    expect(sdk.onSnapshot).not.toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("liveSession when live status is on", () => {
  it("signs in once with an in-memory app named live, and shares the session", async () => {
    const until = Date.now() + HOUR;
    firestoreAnswer(BRAND_A, until, "tok-1");
    const [one, two] = await Promise.all([liveSession(BRAND_A), liveSession(BRAND_A)]);
    expect(one).not.toBeNull();
    expect(two).toBe(one);
    expect(one?.until).toBe(until);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sdk.initializeApp).toHaveBeenCalledWith(CONFIG, "live");
    expect(sdk.initializeAuth).toHaveBeenCalledWith(expect.objectContaining({ name: "live" }), { persistence: sdk.inMemoryPersistence });
    expect(sdk.signInWithCustomToken).toHaveBeenCalledWith({ kind: "auth" }, "tok-1");
  });

  it("asks for a new token when the brand differs from the current token's brand, keeping one app", async () => {
    firestoreAnswer(BRAND_A, Date.now() + HOUR, "tok-a");
    const a = await liveSession(BRAND_A);
    firestoreAnswer(BRAND_B, Date.now() + HOUR, "tok-b");
    const b = await liveSession(BRAND_B);
    expect(b?.brandId).toBe(BRAND_B);
    expect(b?.gen).toBeGreaterThan(a!.gen);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sdk.initializeApp).toHaveBeenCalledTimes(1);
    expect(sdk.signInWithCustomToken).toHaveBeenLastCalledWith({ kind: "auth" }, "tok-b");
  });

  it("renews the token five minutes before it ends, and again for the next one", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    firestoreAnswer(BRAND_A, Date.now() + HOUR, "tok-1");
    await liveSession(BRAND_A);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    firestoreAnswer(BRAND_A, Date.now() + HOUR + HOUR, "tok-2");
    await vi.advanceTimersByTimeAsync(HOUR - RENEW_BEFORE_MS - 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sdk.signInWithCustomToken).toHaveBeenLastCalledWith({ kind: "auth" }, "tok-2");

    // The new claim ends two hours from the start; the next renewal is five minutes before that, an hour after the last.
    firestoreAnswer(BRAND_A, Date.now() + HOUR, "tok-3");
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sdk.initializeApp).toHaveBeenCalledTimes(1);
  });

  it("stops renewing once the session is reset", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    firestoreAnswer(BRAND_A, Date.now() + HOUR);
    await liveSession(BRAND_A);
    resetLiveBrowserForTests();
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("watchDoc and watchKind", () => {
  it("watchDoc listens to brands/{brandId}/live/{docId}, reports live on the first answer, and delivers the document", async () => {
    firestoreAnswer(BRAND_A, Date.now() + HOUR);
    const cb = vi.fn();
    const onLive = vi.fn();
    watchDoc(BRAND_A, "q_1", cb, onLive);
    await vi.waitFor(() => expect(sdk.listeners).toHaveLength(1));
    expect(sdk.doc).toHaveBeenCalledWith({ kind: "db" }, "brands", BRAND_A, "live", "q_1");
    expect(onLive).not.toHaveBeenCalled();

    sdk.listeners[0]!.next(snapDoc("q_1", queueData(7)));
    expect(onLive).toHaveBeenCalledWith(true);
    expect(cb).toHaveBeenLastCalledWith(expect.objectContaining({ id: "q_1", seq: 7, status: "published" }));

    // A late, lower seq does not replace it; a missing document gives null.
    sdk.listeners[0]!.next(snapDoc("q_1", queueData(6, { status: "publishing" })));
    expect(cb).toHaveBeenLastCalledWith(expect.objectContaining({ seq: 7, status: "published" }));
    sdk.listeners[0]!.next({ id: "q_1", exists: () => false, data: () => undefined });
    expect(cb).toHaveBeenLastCalledWith(null);
    expect(onLive).toHaveBeenCalledTimes(1);
  });

  it("watchDoc ignores an expired document", async () => {
    firestoreAnswer(BRAND_A, Date.now() + HOUR);
    const cb = vi.fn();
    watchDoc(BRAND_A, "q_1", cb);
    await vi.waitFor(() => expect(sdk.listeners).toHaveLength(1));
    sdk.listeners[0]!.next(snapDoc("q_1", queueData(7, { expireAt: ts(Date.now() - 1) })));
    expect(cb).toHaveBeenLastCalledWith(null);
  });

  it("watchKind queries the live collection with where('kind', '==', kind) and delivers the list", async () => {
    firestoreAnswer(BRAND_A, Date.now() + HOUR);
    const cb = vi.fn();
    watchKind(BRAND_A, "queue", cb);
    await vi.waitFor(() => expect(sdk.listeners).toHaveLength(1));
    expect(sdk.collection).toHaveBeenCalledWith({ kind: "db" }, "brands", BRAND_A, "live");
    expect(sdk.where).toHaveBeenCalledWith("kind", "==", "queue");
    expect(sdk.query).toHaveBeenCalledTimes(1);

    sdk.listeners[0]!.next({ docs: [snapDoc("q_1", queueData(3)), snapDoc("q_2", queueData(4, { itemId: "i2" })), snapDoc("q_3", queueData(5, { expireAt: ts(1) }))] });
    expect(cb.mock.lastCall![0].map((d: LiveRecord) => d.id)).toEqual(["q_1", "q_2"]);
  });

  it("unsubscribes on request, and a late answer after that is not delivered", async () => {
    firestoreAnswer(BRAND_A, Date.now() + HOUR);
    const cb = vi.fn();
    const stop = watchKind(BRAND_A, "queue", cb);
    await vi.waitFor(() => expect(sdk.listeners).toHaveLength(1));
    stop();
    expect(sdk.listeners[0]!.unsub).toHaveBeenCalledTimes(1);
    sdk.listeners[0]!.next({ docs: [snapDoc("q_1", queueData(3))] });
    expect(cb).not.toHaveBeenCalled();
  });

  it("does not listen at all when unsubscribed before the session is ready", async () => {
    firestoreAnswer(BRAND_A, Date.now() + HOUR);
    const stop = watchKind(BRAND_A, "queue", vi.fn());
    stop();
    await liveSession(BRAND_A);
    await Promise.resolve();
    expect(sdk.onSnapshot).not.toHaveBeenCalled();
  });

  it("on permission-denied asks for one new token and listens again; a second refusal gives up", async () => {
    firestoreAnswer(BRAND_A, Date.now() + HOUR, "tok-1");
    const onLive = vi.fn();
    watchKind(BRAND_A, "queue", vi.fn(), onLive);
    await vi.waitFor(() => expect(sdk.listeners).toHaveLength(1));

    firestoreAnswer(BRAND_A, Date.now() + HOUR, "tok-2");
    sdk.listeners[0]!.error({ code: "permission-denied" });
    expect(sdk.listeners[0]!.unsub).toHaveBeenCalled();
    await vi.waitFor(() => expect(sdk.listeners).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sdk.signInWithCustomToken).toHaveBeenLastCalledWith({ kind: "auth" }, "tok-2");
    expect(onLive).not.toHaveBeenCalled();

    sdk.listeners[1]!.error({ code: "permission-denied" });
    expect(onLive).toHaveBeenCalledWith(false);
    await Promise.resolve();
    expect(sdk.listeners).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("two listeners refused together share one new token", async () => {
    firestoreAnswer(BRAND_A, Date.now() + HOUR, "tok-1");
    watchKind(BRAND_A, "queue", vi.fn());
    watchDoc(BRAND_A, "queue_touch", vi.fn());
    await vi.waitFor(() => expect(sdk.listeners).toHaveLength(2));

    firestoreAnswer(BRAND_A, Date.now() + HOUR, "tok-2");
    sdk.listeners[0]!.error({ code: "permission-denied" });
    sdk.listeners[1]!.error({ code: "permission-denied" });
    await vi.waitFor(() => expect(sdk.listeners).toHaveLength(4));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up straight away on any other error", async () => {
    firestoreAnswer(BRAND_A, Date.now() + HOUR);
    const onLive = vi.fn();
    watchKind(BRAND_A, "queue", vi.fn(), onLive);
    await vi.waitFor(() => expect(sdk.listeners).toHaveLength(1));
    sdk.listeners[0]!.error({ code: "unavailable" });
    expect(onLive).toHaveBeenCalledWith(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
