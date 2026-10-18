# 14. Firebase plan: Firestore live status for Weekly Posts

Status: proposal for the owner, 2026-10-18. Nothing here is built yet. Supabase Postgres stays the system of record; Firestore holds only short-lived, non-sensitive, brand-scoped status.

## 1. Options compared

| | Real user value | Effort | Risk | Cost | Security | Demo |
|---|---|---|---|---|---|---|
| **A. Firestore live status** | High. The Queue page never updates when the Cloud Scheduler sweep publishes (`queue-screen.tsx` has no refresh). Brand Face poses take minutes (2 tries per pose, plus a 35 s `BUSY_RETRY_PAUSE_MS` pause on a 429) and the card only says "making 2 of 7". `week-view.tsx` polls every 3 s and `research-bar.tsx` every 6 s. | About 1 day | Low: additive, behind a switch; off means today's behaviour | Free tier | Rules mirror RLS (brand claim, read-only) | Strong: two devices update live |
| B. Firebase Hosting in front of Cloud Run | Low (Cloud Run already serves the app) | Half a day | **Breaks the app**: Hosting forwards only the `__session` cookie (ours is `pm_session`), and rewrites to Cloud Run time out at 60 s (our routes run up to 300 s) | Free | Neutral | Weak |
| C. FCM web push | Medium ("post is live", "needs approval") | 1.5 to 2 days: token table (migration), service worker, permission prompt, send path | Medium: iOS web push only for installed web apps; the prompt hurts first run | Free | Needs a device-token store | Medium |
| D. App Check / Analytics | None for users. App Check guards Firebase APIs, not our routes; Analytics adds cookies/consent and conflicts with "no IP stored" | Half a day | Low | Free | Analytics is a privacy cost | Decorative |

**Recommendation: A.** Add-on: in the same task set, move the two existing pollers (weekly generation, Ideas research) onto the same channel, with polling kept as the fallback.

Why:
1. It fixes problems users have today: publishing done by the scheduled sweep is invisible until a reload, and slow Gemini face generation looks frozen.
2. It reuses what is already in place: keyless signing (Token Creator on itself is granted), current-brand selection, the refresh actions. Supabase stays the truth.
3. It costs nothing, fails safe, and makes a clear 20-second demo across two devices.

## 2. Data model

One database: `(default)`, Native mode, `australia-southeast1` (location is permanent). One collection group: `live`.

Path: `brands/{brandId}/live/{docId}`; `brandId` is the Supabase `brands.id` (uuid).

Fields on every doc:

| Field | Type | Notes |
|---|---|---|
| `kind` | `'queue' \| 'queue_touch' \| 'face' \| 'research' \| 'weekly'` | |
| `v` | `1` | Schema version |
| `seq` | number | `Date.now()*1000 + counter`; the client ignores a lower `seq` for the same doc |
| `updatedAt` | server timestamp | |
| `expireAt` | Timestamp | TTL field |

Documents (allow-list per kind; nothing else is ever written):

| docId | kind | Fields | TTL |
|---|---|---|---|
| `q_{queueItemId}` | queue | `itemId, postId, channel, status` (QueueStatus), `mode` (`publish\|deliver`), `attempts`, `slotAt` (ISO) | 24 h |
| `queue_touch` | queue_touch | (`seq` only): an owner action changed the queue on some device | 24 h |
| `face_{faceId}` | face | `faceId, step` (`options\|sheet\|poses`), `state` (`running\|done\|failed`), `pose?`, `tryNo?, tries?, phase?` (`drawing\|checking\|cutting\|waiting\|saved`), `done, total` | 2 h |
| `research` (add-on) | research | `runId, state` (`running\|done\|failed\|capped`), `cards?` | 24 h |
| `weekly_{weekStart}` (add-on) | weekly | `weekStart, state` (`generating\|ready\|failed`) | 24 h |

Never written: captions, headlines, image URLs, permalinks, `last_error` text, platform IDs, emails, payment IDs, tokens. The client reads every detail from Supabase through the existing server actions.

Cleanup: a Firestore TTL policy on `live.expireAt`; the client also ignores expired docs.

## 3. Security rules (`firestore.rules`, repo root)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Live status, written only by the server (Admin SDK bypasses rules).
    // Mirrors our RLS: a signed-in owner reads only their current brand's docs.
    match /brands/{brandId}/live/{docId} {
      allow get, list: if request.auth != null
        && request.auth.token.b == brandId
        && request.auth.token.until is int
        && request.time.toMillis() < request.auth.token.until;
      allow create, update, delete: if false;
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

`firebase.json`: `{ "firestore": { "rules": "firestore.rules" } }`.

## 4. Token flow

1. A client component calls `liveSession(brandId)`, which POSTs to `/api/live/token` (same origin, cookie). `src/proxy.ts` already returns 401 to signed-out callers on non-public `/api/*`.
2. `src/app/api/live/token/route.ts`:
   - `getCurrentUser()` (checks the JWT `sid` against `user_sessions`, so revoked devices are refused);
   - `getCurrentBrand(user.id)` under RLS;
   - a foreign `Origin` header returns 403;
   - mode not `firestore` returns `{ mode: 'off' }`;
   - otherwise `createCustomToken(user.id, { b: brand.id, until: now + 60 min })` (no email or personal data in claims);
   - returns `{ mode: 'firestore', token, brandId, until, config: { apiKey, authDomain, projectId, appId } }` with `Cache-Control: no-store`.
3. Keyless signing: on Cloud Run, firebase-admin signs through IAM `signBlob` as `weekly-posts-run`, which already has `roles/iam.serviceAccountTokenCreator` on itself (deploy.md §2); `iamcredentials` is enabled. `serviceAccountId` comes from `FIREBASE_SERVICE_ACCOUNT_ID`.
4. Browser: lazy `import()` of `firebase/app`, `firebase/auth`, `firebase/firestore`; `initializeApp(config, 'live')`; `initializeAuth(app, { persistence: inMemoryPersistence })`; `signInWithCustomToken`; `getFirestore(app)`.
5. Renewal at `until − 5 min`; a `permission-denied` triggers one new token and resubscribe, then "not live".
6. Brand switch re-mints when `brandId` differs from the token's `b`. Sign-out: the next mint fails; the claim ends within 60 minutes at most.

The config is served at runtime (not `NEXT_PUBLIC_*`): no new Docker build args, same image everywhere, and "off" really means off.

## 5. Server code (new module `src/lib/realtime/`)

New files:
- `config.ts`: `realtimeMode()`: `'mock'` under VITEST; else `REALTIME_BACKEND` if set; else `'firestore'` when `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY`, `FIREBASE_WEB_APP_ID` are set, `'mock'` when `DATA_BACKEND=mock`, otherwise `'off'`. Also `webConfig()`.
- `types.ts`: the `LiveDoc` union, per-kind allow-lists, `sanitize(kind, data)` (drops unknown keys; `brandId` must be a uuid, `docId` must match `/^[a-z0-9_-]{1,80}$/`).
- `firestore.ts`: lazy `initializeApp({ credential, projectId, serviceAccountId }, 'realtime')`, `getFirestore(app)` with `preferRest: true`; `set(docRef, {...data, v, seq, updatedAt: serverTimestamp, expireAt})`.
- `mock.ts`: in-memory recorder (`liveWritesForTests`, `resetLiveForTests`, `setLiveSinkForTests`).
- `index.ts`: `emitLive(brandId, docId, kind, data, ttlMs)`, awaited but capped at 1.5 s, never throws, logs `[live] write failed` at most once a minute. Helpers `emitQueueItem`, `emitQueueTouch`, `emitFaceProgress`, and (add-on) `emitResearch`, `emitWeekly`.
- `token.ts`: `mintLiveToken({userId, brandId, now})` plus `setLiveTokenMinterForTests`.

Changes:
- `src/lib/queue/sweep.ts`: emit after a successful `claim()` (publishing); in `processItem()` `finally`, reload and emit (published, delivered, retry, failed, lost); emit for `closeScheduled()` results (missed, expired, skipped) and for the stale publishing → failed block. "Post now" is covered through `processItem`.
- `src/app/(app)/week/queue-actions.ts`: `emitQueueTouch(me.brandId)` in `done()`.
- `src/lib/faces/generate/steps.ts`: `progress` in `FaceGenDeps` (default `emitFaceProgress`); `waiting` before the busy pause; per-option counts; sheet running/done/failed; per pose try: drawing → checking → cutting → saved; final state.
- Add-on: `src/lib/ideas/run.ts` (research running/final), `src/lib/weekly/generate.ts` (weekly generating/ready/failed).

## 6. UI

New:
- `src/lib/realtime/browser.ts`: `liveSession(brandId)` (one per tab, keeps the token fresh), `watchDoc`, `watchKind` (`where('kind','==',kind)`, automatic single-field index).
- `src/components/live/use-live.ts`: `useLiveDoc` → `{live, doc}`, `useLiveKind` → `{live, docs}`.
- `src/components/live/live-dot.tsx`: small green "Live" dot; nothing when not live.

Changes:
- `src/components/queue/queue-screen.tsx` (new `brandId` prop from `week/page.tsx`): on a newer `seq`, patch the card's status badge, then debounced (400 ms) `refreshQueueAction()`; pulsing publishing badge; LiveDot by "Upcoming".
- `src/components/brand/face-make.tsx` (new `brandId` prop from `face-card.tsx`): show pose, try, phase and the waiting message; on `saved`, call `onChange()` so the pose appears at once; "Option 2 of 4" for options.
- `src/lib/i18n/strings.ts`: `live` section and `faces.card.progress.*`.
- Add-on: `week-view.tsx` and `research-bar.tsx` listen and keep `setInterval` polling only when not live.

## 7. Mock mode

- Vitest: always `mock`; `firebase-admin` never imported (dynamic import); the token route returns `{mode:'off'}` unless a test injects a minter.
- Local dev (`DATA_BACKEND=mock`): `mock`, no network, UI exactly as today.
- `REALTIME_BACKEND=off` switches it off anywhere.
- Optional: Firestore and Auth emulators via `FIRESTORE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST` (not production).

## 8. Environment, secrets, IAM

Plain environment variables (no secrets; the web API key is public by design, guarded by rules and key restrictions):

| Var | Production value |
|---|---|
| `REALTIME_BACKEND` | `firestore` (set by cloudbuild only when the key is given) |
| `FIREBASE_PROJECT_ID` | `weekly-posts-471203` |
| `FIREBASE_WEB_API_KEY` | from `apps:sdkconfig` |
| `FIREBASE_WEB_APP_ID` | from `apps:sdkconfig` |
| `FIREBASE_AUTH_DOMAIN` | optional; default `${projectId}.firebaseapp.com` |
| `FIREBASE_SERVICE_ACCOUNT_ID` | `weekly-posts-run@weekly-posts-471203.iam.gserviceaccount.com` |

- Secret Manager: nothing new; Cloud Run stays keyless.
- `cloudbuild.yaml`: substitutions `_FIREBASE_WEB_API_KEY`, `_FIREBASE_WEB_APP_ID` (default empty); the deploy step adds the env vars only when the key is given.
- `deploy/main.subs.txt`: add the two values. `.env.example`: a "Live status (Firebase)" block.

IAM for `weekly-posts-run`: **new** `roles/datastore.user`; **already granted** Token Creator on itself. A later Firebase Auth record cleanup on account deletion would need `roles/firebaseauth.admin`.

## 9. One-time GCP setup (OWNER APPROVAL REQUIRED)

```bash
PROJECT_ID=weekly-posts-471203
REGION=australia-southeast1
RUN_SA=weekly-posts-run@$PROJECT_ID.iam.gserviceaccount.com

# 1. APIs (iamcredentials is already on)
gcloud services enable firestore.googleapis.com firebase.googleapis.com firebaserules.googleapis.com \
  identitytoolkit.googleapis.com securetoken.googleapis.com --project=$PROJECT_ID

# 2. Add Firebase to the existing project; register the web app
npx -y firebase-tools@latest login
npx -y firebase-tools@latest projects:addfirebase $PROJECT_ID
npx -y firebase-tools@latest apps:create web weekly-posts-web --project=$PROJECT_ID
npx -y firebase-tools@latest apps:sdkconfig web <APP_ID> --project=$PROJECT_ID   # note apiKey and appId

# 3. Firestore (default) database in Sydney. LOCATION IS PERMANENT.
gcloud firestore databases create --database='(default)' --location=$REGION --type=firestore-native --project=$PROJECT_ID

# 4. TTL cleanup on expireAt
gcloud firestore fields ttls update expireAt --collection-group=live --enable-ttl --project=$PROJECT_ID

# 5. Console: Firebase > Build > Authentication > "Get started" (no provider needed for custom tokens)

# 6. IAM
gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:$RUN_SA --role=roles/datastore.user
gcloud iam service-accounts get-iam-policy $RUN_SA   # confirm Token Creator on itself

# 7. Rules (repo root, after T-FB6)
npx -y firebase-tools@latest deploy --only firestore:rules --project=$PROJECT_ID

# 8. Console > APIs & Services > Credentials > "Browser key (auto created by Firebase)":
#    HTTP referrers: https://weekly-posts-526531409571.australia-southeast1.run.app/*, http://localhost:3000/*
#    APIs: Identity Toolkit, Token Service, Cloud Firestore

# 9. Deploy (docs/SETUP.md §8) with _FIREBASE_WEB_API_KEY and _FIREBASE_WEB_APP_ID in deploy/main.subs.txt
```

## 10. npm packages

- `firebase` (browser): only `firebase/app`, `firebase/auth`, `firebase/firestore` (full SDK; lite has no `onSnapshot`). About 150 KB gzipped, loaded by `import()` only on /week and /brand when live. First-load JS of every route must not grow (check `next build`).
- `firebase-admin` (server): `firebase-admin/app`, `/auth`, `/firestore`; add `firebase-admin` and `@google-cloud/firestore` to `serverExternalPackages`. About 20 to 40 MB more in the image; `preferRest: true` avoids gRPC.

## 11. Test plan

Unit tests (vitest, mock mode, in `npm test`):
1. `tests/realtime/config.test.ts`: mode resolution matrix.
2. `tests/realtime/emit.test.ts`: allow-list drops unknown keys (`lastError`, `caption`, `permalink`); bad ids refused; `expireAt` = now + TTL; a throwing sink does not throw; a slow sink gives up at 1.5 s.
3. `tests/realtime/token.test.ts`: signed out 401; foreign Origin 403; off → `{mode:'off'}`; injected minter gets uid = user id and claims exactly `{b, until: now+3600000}`, no email, `no-store`; brand switch changes `b`.
4. `tests/queue/live.test.ts`: publishing → published; retry → scheduled with attempts 1; final failure → failed; missed/expired/skipped/stale each write; path `brands/{brandId}/live/q_{itemId}`; a throwing sink changes no sweep outcome; Post now writes.
5. `tests/faces/generate/progress.test.ts`: drawing → checking → cutting → saved per try, then done; 429 emits waiting; options emit 1 to 4.
6. Existing queue, faces, ideas, weekly suites pass unchanged.

Optional rules tests with `@firebase/rules-unit-testing` (`npm run test:rules`, needs Java): signed out denied; brand A token reads A, not B; expired `until` denied; any client write denied; `/other/x` denied.

Production checks: two devices on /week, "Post now" on one updates the other live; reading another brand's path gives `permission-denied`; no `[live] write failed` in logs; usage within the free tier; `REALTIME_BACKEND=off` restores today's behaviour.

## 12. Tasks

| ID | Task | Files | Acceptance |
|---|---|---|---|
| T-FB1 | Server realtime module | `src/lib/realtime/{config,types,firestore,mock,index,token}.ts`, `next.config.ts`, `package.json`, `.env.example` | §7 modes; `emitLive` never throws, 1.5 s cap; allow-list; tests 1-2; no firebase-admin in mock mode |
| T-FB2 | Token route | `src/app/api/live/token/route.ts` | §4; test 3; claims exactly `{b, until}`; no-store |
| T-FB3 | Browser client and hooks | `src/lib/realtime/browser.ts`, `src/components/live/*`, `package.json`, strings | Lazy import; in-memory persistence; renewal; one retry; `live=false` when off; no first-load growth |
| T-FB4 | Queue wiring and UI | `sweep.ts`, `queue-actions.ts`, `queue-screen.tsx`, `week/page.tsx` | Test 4; live badge then debounced refresh; LiveDot; identical when off |
| T-FB5 | Face progress wiring and UI | `steps.ts`, `face-make.tsx`, `face-card.tsx`, strings | Test 5; face tests unchanged; pose/try/phase/waiting shown; saved pose appears at once |
| T-FB6 | Rules and config files | `firestore.rules`, `firebase.json`, optional `tests/rules/*` | §3 rules; emulator tests where Java exists |
| T-FB7 (add-on) | Replace pollers | `ideas/run.ts`, `weekly/generate.ts`, `week-view.tsx`, `research-bar.tsx` | No `setInterval` when live; polling when not |
| T-FB8 (helper) | Deploy config and docs | `cloudbuild.yaml`, `deploy/main.subs.txt`, `docs/deploy.md`, `docs/architecture.md`, `docs/HANDOFF.md` | Match §8 and §9 |
| T-FB9 (owner) | One-time setup, deploy, verify | §9 | §11 production checks pass; only then update `docs/submission/brief-description.md` with §15 |

Estimate: about 8 to 9 hours of builder time plus about 45 minutes of owner setup. If short of time, drop T-FB7 first.

## 13. Risks

1. Revocation lag: a signed-out device can read its brand's status docs for up to 60 minutes. Status only, in-memory persistence; re-mint checks `sid`.
2. Firebase Auth user records (keyed by internal uuid, no email): mention in privacy notes; delete on account deletion later.
3. Cold start: the 1.5 s cap means it never blocks publishing or face generation.
4. Out-of-order or lost writes are harmless: Firestore is a doorbell; the client re-reads Supabase.
5. A leaked field: the sanitiser and its test prevent it; review T-FB4/T-FB5 diffs.
6. Bundle size: keep Firebase in a lazy chunk.
7. Blocked networks fall back to "not live" (today's behaviour).
8. Firestore location is permanent: `australia-southeast1` only.
9. The browser API key is visible by design: restrict by referrer and API; the rules are the real guard.
10. Cost: tens to hundreds of writes a day against a free tier of 20k writes / 50k reads a day; the ₹450 budget alert covers surprises.
11. Submission honesty: do not claim Firebase until it is deployed.

## 14. Demo video (about 20 to 25 s)

1. Split screen: laptop on /week with the "Live" dot, phone signed in to the same brand. "Post now" on the phone; the laptop card goes Scheduled → Publishing (pulsing) → Published with no reload. Cut to the post on Instagram.
2. Brand Face: the card reads "Waving: try 1 of 2, drawing" → "checking it matches (Gemini)" → "cutting out"; the pose drops into the grid when saved.
3. Firebase console, 3 s: the Firestore viewer with `brands/<id>/live/q_…` changing, then the Rules tab.
4. Optional: devtools reading another brand's path → "Missing or insufficient permissions".

Use a demo brand; never show a token or an email on screen.

## 15. Submission text (use only after T-FB9 passes)

Supabase Postgres with row-level security stays our system of record. Firebase gives owners a live view of work that happens out of sight. When the Cloud Scheduler sweep on Cloud Run publishes a post, or Gemini on Vertex AI draws and checks a Brand Face pose by pose, the server writes a tiny brand-scoped status document to Firestore with firebase-admin (for example scheduled → publishing → published, or "pose 3 of 7: checking it matches"). The browser signs in to Firebase Authentication with a short-lived custom token, which our Cloud Run service mints without a key file, through IAM, for the signed-in owner's current brand. It then listens with onSnapshot, so the Queue and Brand Face screens update the moment something happens, on every device, without polling. Firestore security rules mirror our database rules: a browser can read only its own brand's documents, only while its claim is valid, and can never write. The documents hold no captions, payment IDs, secrets or personal data, and a TTL policy deletes them within a day.
