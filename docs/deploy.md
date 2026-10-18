# Deploying to Google Cloud (Cloud Run)

How to host Weekly Posts on Cloud Run (C-31), with Cloud Storage for files (C-32) and Gemini on Vertex AI (C-33). It replaces `docs/vercel-deploy.md`. Nothing here has been created yet: no Google Cloud project exists, and the files in the repo (`Dockerfile`, `cloudbuild.yaml`, `scripts/gcp/scheduler.sh`) only describe what to create.

Run the commands in Google Cloud Shell (it has `gcloud` already signed in) or in Git Bash with the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) installed. `.env.local` never leaves your computer, so every setting below has to be given to Cloud Run separately.

## What runs where

| Piece | Service | Notes |
|---|---|---|
| The website and API | **Cloud Run** (one service, `weekly-posts`) | Docker image built by Cloud Build, stored in Artifact Registry |
| Scheduled jobs | **Cloud Scheduler** (six jobs) | Call `/api/cron/weekly`, `/api/cron/reminders`, `/api/cron/queue`, `/api/cron/insights` (hourly), `/api/cron/connections` (daily) and `/api/cron/research` (Mondays 06:00-09:00) with `CRON_SECRET`. Replaces Vercel Cron |
| Files (logos, photos, renders, mascots) | **Cloud Storage** (five private buckets) | `STORAGE_BACKEND=gcs`. Supabase Storage still works if you set `STORAGE_BACKEND=supabase` |
| Database and sign-in | **Supabase** (unchanged) | Sydney, so the app runs in Sydney too |
| Captions, plans, checks | **Gemini on Vertex AI** | Same Google Cloud project |
| Secrets | **Secret Manager** | Cloud Run reads them when an instance starts |
| Email | **Resend** (unchanged) | Needs a verified sending domain |

## Before the first deploy

| Who | What | Why |
|---|---|---|
| You | A Google Cloud project with billing turned on | Everything below lives in it. Use a dedicated project, not the shared Gemini one |
| You | Resend account and a verified sending domain | Without it nobody can sign in |
| You | Supabase project (already exists) | Keep its region in mind, see "Region" at the end |
| Claude | Done: `Dockerfile`, `.dockerignore`, `cloudbuild.yaml`, `scripts/gcp/scheduler.sh`, the Cloud Storage backend | |
| Not done | The image has not been built with Docker yet (no Docker on the build machine). The same build was run with `next build` and the server was started from the standalone output; the first Cloud Build run is the first full Docker build | See "If the first build fails" |

## 1. Create the project and turn on the APIs

1. In the [Google Cloud console](https://console.cloud.google.com) create a project (for example `weekly-posts-prod`) and link a billing account.
2. Set it as the default and enable the APIs:

```bash
export PROJECT_ID=weekly-posts-prod        # your project id
export REGION=australia-southeast1         # Sydney, next to the Supabase database
gcloud config set project $PROJECT_ID

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  storage.googleapis.com \
  aiplatform.googleapis.com \
  iamcredentials.googleapis.com \
  firestore.googleapis.com \
  firebase.googleapis.com \
  firebaserules.googleapis.com \
  identitytoolkit.googleapis.com \
  securetoken.googleapis.com
```

`iamcredentials` is needed for signed image links when the app runs without a key file (section 4). The last five are for live status (section 13); enabling them costs nothing and does nothing until section 13 is done.

Phase 4 (voice, translation, analytics, YouTube) needs these too. Enabling an API costs nothing; turn them on now or when that phase starts:

```bash
gcloud services enable \
  speech.googleapis.com \
  texttospeech.googleapis.com \
  translate.googleapis.com \
  bigquery.googleapis.com \
  youtube.googleapis.com
```

(`youtube.googleapis.com` is the YouTube Data API v3. Publishing to YouTube also needs an OAuth consent screen, set up in phase 3.)

## 2. Service accounts and roles (least privilege)

Two accounts: one the app runs as, one that builds and deploys.

```bash
gcloud iam service-accounts create weekly-posts-run   --display-name="Weekly Posts runtime"
gcloud iam service-accounts create weekly-posts-build --display-name="Weekly Posts Cloud Build"
RUN_SA=weekly-posts-run@$PROJECT_ID.iam.gserviceaccount.com
BUILD_SA=weekly-posts-build@$PROJECT_ID.iam.gserviceaccount.com
```

**Runtime account (`weekly-posts-run`)**, what the running app can do:

| Role | On what | Why |
|---|---|---|
| `roles/aiplatform.user` | the project | Call Gemini (and later Imagen, Veo) on Vertex AI |
| `roles/storage.objectAdmin` | each of the five buckets only (section 3) | Read, write, delete and list files. Not the whole project, and no permission to create or delete buckets |
| `roles/secretmanager.secretAccessor` | each secret only (section 5) | Read its own settings |
| `roles/iam.serviceAccountTokenCreator` | itself | Keyless signed links (section 4, option A). Already granted, and also used to sign the Firebase custom tokens for live status (section 13) |
| `roles/datastore.user` | the project | Write the live status documents to Firestore (section 13). Not needed while live status is off |
| Phase 4 | the project | `roles/speech.client`, `roles/cloudtranslate.user`, `roles/bigquery.jobUser` plus `roles/bigquery.dataEditor` on the one dataset. Text-to-Speech needs no role beyond the API being enabled |

```bash
gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:$RUN_SA --role=roles/aiplatform.user
gcloud iam service-accounts add-iam-policy-binding $RUN_SA --member=serviceAccount:$RUN_SA --role=roles/iam.serviceAccountTokenCreator
gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:$RUN_SA --role=roles/datastore.user   # live status (section 13)
```

**Build account (`weekly-posts-build`)**, what Cloud Build can do:

| Role | On what | Why |
|---|---|---|
| `roles/artifactregistry.writer` | the repository (section 3) | Push images |
| `roles/run.developer` | the project | Deploy the service |
| `roles/iam.serviceAccountUser` | the runtime account only | Allow a deploy "as" the runtime account |
| `roles/logging.logWriter` | the project | Write build logs |

```bash
gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:$BUILD_SA --role=roles/run.developer
gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:$BUILD_SA --role=roles/logging.logWriter
gcloud iam service-accounts add-iam-policy-binding $RUN_SA --member=serviceAccount:$BUILD_SA --role=roles/iam.serviceAccountUser
```

Cloud Scheduler needs no role: the jobs call the public address with the `CRON_SECRET` header.

## 3. Create the image repository and the five buckets

```bash
gcloud artifacts repositories create weekly-posts --repository-format=docker --location=$REGION
gcloud artifacts repositories add-iam-policy-binding weekly-posts --location=$REGION \
  --member=serviceAccount:$BUILD_SA --role=roles/artifactregistry.writer
```

Bucket names are global across all of Google Cloud, so choose a prefix nobody else has; the app adds `-brand-assets`, `-inputs`, `-renders`, `-mascots`, `-photos`. Lower case letters, digits and dashes.

```bash
export GCS_BUCKET_PREFIX=weeklyposts-prod          # your prefix
for b in brand-assets inputs renders mascots photos; do
  gcloud storage buckets create gs://$GCS_BUCKET_PREFIX-$b \
    --location=$REGION --uniform-bucket-level-access --public-access-prevention
  gcloud storage buckets add-iam-policy-binding gs://$GCS_BUCKET_PREFIX-$b \
    --member=serviceAccount:$RUN_SA --role=roles/storage.objectAdmin
done
```

All five are private (uniform access, public access prevention). Files reach owners only through `/api/files/...`, which checks brand membership. For publishing (phase 3), the app hands Meta and YouTube short-lived signed links (`signedUrl`, up to 7 days); signed links work even with public access prevention on.

**Required (seen on the first deploy, 2026-10-14):** Cloud Build needs the build account to read its source upload bucket, otherwise `gcloud builds submit` fails with `storage.objects.get` denied on `gs://<project>_cloudbuild`. Run
`gcloud storage buckets add-iam-policy-binding gs://${PROJECT_ID}_cloudbuild --member=serviceAccount:$BUILD_SA --role=roles/storage.objectViewer`.

## 4. How the app signs in to Google (C-33)

The app reaches Vertex AI and Cloud Storage with Google credentials. Two ways; pick one.

**Option B, a key file (the plan from H-6 and C-33).** Create a key for `weekly-posts-run` in the dedicated project and store its whole contents as the secret `GOOGLE_SERVICE_ACCOUNT_JSON` (section 5). The app already reads it (`serviceAccountCredentials()` in `src/lib/ai/client.ts`) for both Gemini and Cloud Storage, and signed links are signed with the key's private key. This is what `cloudbuild.yaml` does by default.

```bash
gcloud iam service-accounts keys create key.json --iam-account=$RUN_SA
# upload it as a secret (section 5), then delete key.json from your computer
```

Rules for the key: never commit it, never put it in `.env.local` of a shared machine, never use a personal Google login on a server, and rotate it if it leaks. If your organisation blocks key creation (policy `iam.disableServiceAccountKeyCreation`), use option A.

**Option A, no key (recommended by Google).** The runtime account's identity is used automatically (Application Default Credentials). Leave `GOOGLE_SERVICE_ACCOUNT_JSON` unset, and deploy with `_EXTRA_SECRETS=` (empty). Signed links are then signed through the IAM Credentials API, which is why the account has `serviceAccountTokenCreator` on itself.

Either way, `GOOGLE_CLOUD_PROJECT` is set to the project and `GOOGLE_CLOUD_LOCATION=global`, and the shared project and personal login used for development are not used in production.

## 5. Secrets

Create each as a Secret Manager secret with the same name as the setting, then let the runtime account read it.

| Secret | Value |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | From `.env.local` (reset it first, see section 11) |
| `SUPABASE_DB_URL` | From `.env.local`: the pooler connection string, transaction mode. Keep the `%40` in the password as it is |
| `AUTH_SECRET` | New random value, 32+ characters |
| `EMAIL_LINK_SECRET` | New random value |
| `CRON_SECRET` | New random value (also used by the scheduler script) |
| `RESEND_API_KEY` | From Resend, once the domain shows **Verified** |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The whole key file (option B only) |
| `READER_API_KEY` | Optional, Jina Reader key |
| `INSTAGRAM_LOOKUP_TOKEN` | Optional, Meta system-user token for reading public Instagram posts |

Make the random values (new ones for production, not the ones on your computer):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Create the secrets (the value comes from standard input so it never lands in your shell history as an argument):

```bash
make_secret() {   # make_secret NAME   (value read from the next line you paste, then Ctrl-D)
  gcloud secrets create "$1" --replication-policy=automatic --data-file=-
  gcloud secrets add-iam-policy-binding "$1" --member=serviceAccount:$RUN_SA --role=roles/secretmanager.secretAccessor
}
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" | make_secret AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" | make_secret EMAIL_LINK_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" | make_secret CRON_SECRET
make_secret SUPABASE_SERVICE_ROLE_KEY        # paste the value, press Enter, then Ctrl-D
make_secret SUPABASE_DB_URL
make_secret RESEND_API_KEY
make_secret GOOGLE_SERVICE_ACCOUNT_JSON < key.json        # option B only
```

Changing `AUTH_SECRET` signs everyone out; changing `EMAIL_LINK_SECRET` breaks the links in emails already sent. To change a secret later: `gcloud secrets versions add NAME --data-file=-`, then redeploy (secrets are read at instance start and the deploy uses `:latest`).

### Every setting, and where it goes

Plain settings are set by `cloudbuild.yaml` from the substitutions in section 6. The browser-visible ones (`NEXT_PUBLIC_*`) are baked into the image at build time.

| Setting | Goes in | Value |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | build argument and plain | Your public address, no trailing slash |
| `NEXT_PUBLIC_SUPABASE_URL` | build argument and plain | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | build argument and plain | Supabase anon key (public by design) |
| `DATA_BACKEND` | plain (set by the deploy step) | `supabase` |
| `STORAGE_BACKEND` | plain (set by the deploy step) | `gcs` |
| `GCS_BUCKET_PREFIX` | plain | Your bucket prefix |
| `GOOGLE_GENAI_USE_VERTEXAI` | plain (set by the deploy step) | `true` |
| `GOOGLE_CLOUD_PROJECT` | plain (set from the project id) | The project id |
| `GOOGLE_CLOUD_LOCATION` | plain | `global` |
| `EMAIL_FROM` | plain | e.g. `Weekly Posts <hello@yourdomain.com>`, on the verified domain |
| `EMAIL_REPLY_TO` | plain, optional | Where replies go |
| `ADMIN_EMAILS` | plain, optional | Comma-separated sign-in emails allowed to open the read-only `/admin` monitoring page (build substitution `_ADMIN_EMAILS`; commas inside the value are fine because of the `^`+`|`+`^` separator in section 6). Blank means nobody: `/admin` answers 404. Sign in with one of these emails, then open `/admin`. |
| `INSTAGRAM_LOOKUP_USER_ID`, `META_GRAPH_VERSION` | plain, optional | See `.env.example` |
| `REALTIME_BACKEND` | plain (set by the deploy step, only when `_FIREBASE_WEB_API_KEY` is given) | `firestore`. Leave it unset or `off` to keep live status off |
| `FIREBASE_PROJECT_ID` | plain (set by the deploy step, same condition) | `weekly-posts-471203` (the project id) |
| `FIREBASE_WEB_API_KEY` | plain, build substitution `_FIREBASE_WEB_API_KEY` | From `apps:sdkconfig` (section 13). Public by design, so not a secret |
| `FIREBASE_WEB_APP_ID` | plain, build substitution `_FIREBASE_WEB_APP_ID` | From `apps:sdkconfig` (section 13) |
| `FIREBASE_AUTH_DOMAIN` | plain, optional (not set by `cloudbuild.yaml`) | Default `{project id}.firebaseapp.com` |
| `FIREBASE_SERVICE_ACCOUNT_ID` | plain (set by the deploy step, same condition) | `weekly-posts-run@{project id}.iam.gserviceaccount.com`. Read from `process.env` by `src/lib/realtime/firestore.ts`, not through `getEnv()` |
| `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `AUTH_SECRET`, `EMAIL_LINK_SECRET`, `CRON_SECRET`, `RESEND_API_KEY` | **secret** | Section 5 table |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | **secret** | Option B only |
| `READER_API_KEY`, `INSTAGRAM_LOOKUP_TOKEN` | **secret**, optional | Add to `_EXTRA_SECRETS` |
| `PORT` | Cloud Run sets it | 8080 |
| `K_SERVICE` | Cloud Run sets it | When it is present the app counts as hosted production and refuses the mock sign-in |

Leave out: `GOOGLE_APPLICATION_CREDENTIALS` (a file path), `GEMINI_API_KEY`, `AI_MODE` (blank means live AI), `GEMINI_MODEL`, `GEMINI_TRANSCRIBE_MODEL`, `INSTAGRAM_MODE`, `REMOVE_BG_API_KEY`, the five `WHATSAPP_*`, `READER_PROVIDER` (blank is fine), `TWEEN_ENABLED`.

## 6. Build and deploy

From the project folder:

```bash
gcloud builds submit --config cloudbuild.yaml --service-account=projects/$PROJECT_ID/serviceAccounts/$BUILD_SA \
  --substitutions="^|^_NEXT_PUBLIC_APP_URL=https://app.example.com|_NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co|_NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...|_GCS_BUCKET_PREFIX=$GCS_BUCKET_PREFIX|_EMAIL_FROM=Weekly Posts <hello@example.com>"
```

(`^|^` makes `|` the separator between substitutions, so values may contain commas, spaces and `@`. Don't use `@` as the separator: email addresses contain it.) For the very first deploy you may not know the final address yet: use the `.run.app` address Cloud Run prints, then deploy again with the real domain; `NEXT_PUBLIC_APP_URL` is baked in, so a change needs a new build.

**Required once after the first deploy:** the build account (`roles/run.developer`) may deploy but not change who can call the service, so `--allow-unauthenticated` is silently skipped and every page answers 403. Make the service public with your own account:

```bash
gcloud run services add-iam-policy-binding weekly-posts --region=$REGION --member=allUsers --role=roles/run.invoker
```

What the deploy step sets (see `cloudbuild.yaml`): region `australia-southeast1` (override with `_REGION=`), minimum instances 0, maximum 5, 2 vCPU and 2 GiB memory (drawing images is memory and CPU hungry), 10 requests at a time per instance, request timeout 300 seconds (weekly generation can take about 90 seconds and the routes allow up to 300), startup CPU boost, public access (the app signs owners in itself), and the runtime account from section 2.

Optional secrets: add them to the deploy, for example `_EXTRA_SECRETS=GOOGLE_SERVICE_ACCOUNT_JSON=GOOGLE_SERVICE_ACCOUNT_JSON:latest,READER_API_KEY=READER_API_KEY:latest`.

### Trying the image on your own computer (needs Docker)

```bash
docker build -t weekly-posts .
docker run --rm -p 8080:8080 -e DATA_BACKEND=mock -e AUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  -e EMAIL_LINK_SECRET=local-only-secret-32-characters-long -e CRON_SECRET=local weekly-posts
curl -i http://localhost:8080/login          # 200
docker run --rm weekly-posts node smoke-render.mjs      # fonts, wasm shaping, resvg and sharp work
```

The mock backend inside a container forgets everything when it stops. Do not use it for real owners.

### If the first build fails

The image build runs `next build`, then `node smoke-render.mjs` inside the final image. That script checks the fonts, HarfBuzz (wasm), resvg and sharp (native). If it fails, the message says which one is missing. The usual fix is in `next.config.ts` (`serverExternalPackages`, `outputFileTracingIncludes`) or the `COPY` lines in the `Dockerfile`.

## 7. Cloud Scheduler (replaces Vercel Cron)

After the service is deployed:

```bash
export CRON_SECRET='the same value as the CRON_SECRET secret'     # read it with: gcloud secrets versions access latest --secret=CRON_SECRET
bash scripts/gcp/scheduler.sh
```

It creates (or updates, so it is safe to run again) six jobs in `australia-southeast1`:

| Job | Schedule (UTC) | Calls |
|---|---|---|
| `weekly-posts-weekly` | `0 * * * *` (every hour on the hour) | `GET /api/cron/weekly` |
| `weekly-posts-reminders` | `30 * * * *` (every hour at half past) | `GET /api/cron/reminders` |
| `weekly-posts-queue` | `15 * * * *` (every hour at quarter past) | `GET /api/cron/queue`: publishes or emails each queued post whose time has come |
| `weekly-posts-insights` | `45 * * * *` (every hour at quarter to) | `GET /api/cron/insights`: reads how each published Instagram and Facebook post did (about 24 h, 72 h and 7 days after posting) into `post_metrics`; posts already measured are skipped, so a late or repeated call is harmless. Needs the insights permissions on the connection (docs/meta-app-review-insights.md); without them it skips that brand |
| `weekly-posts-connections` | `15 3 * * *` (every day at 03:15) | `GET /api/cron/connections`: renews Instagram tokens that end within 10 days; an expired connection emails the owner once |
| `weekly-posts-research` | `0 6-9 * * 1` (Mondays, hourly 06:00-09:00 UTC; up to 48 brands) | `GET /api/cron/research`: weekly trend research (Ideas) for brands that have it on and have finished setup; at most one weekly run per brand per week, so a late or repeated call skips brands that already ran. Each run is costed (about $0.35) under the brand's own $0.50 weekly research budget. The route allows 300 s and runs 3 brands at a time, at most 12 per call; brands left over wait for the next call or the owner's "Research now" |

Both send `Authorization: Bearer $CRON_SECRET`, which is exactly what the six routes check. The weekly job waits up to 330 seconds for an answer and is not retried (the next hour picks up what is still due). Check them in the console under **Cloud Scheduler**, or run one now:

```bash
gcloud scheduler jobs run weekly-posts-reminders --location=$REGION
```

`vercel.json` is still in the repo and does no harm; **Cloud Run is the primary target**. Do not run both Vercel Cron and Cloud Scheduler against production at the same time: the work is safe to repeat but sends extra calls.

If you ever change `CRON_SECRET`, run `scripts/gcp/scheduler.sh` again so the jobs use the new value.

### Sign-in sessions, device location and retention (ADM-2)

- Every sign-in writes a `user_sessions` row (device type, browser, OS, approximate city and country, a keyed hash of the IP; **never the IP itself**). The admin dashboard lists them and can sign a device out. Activity goes to `app_events`.
- City and country come from the **DB-IP "IP to City Lite"** database, looked up offline. The Dockerfile downloads it at build time (`scripts/fetch-geoip.mjs`; build argument `GEOIP_MONTH=YYYY-MM` pins the month, blank = the current month, falling back to the two months before; a failed download only logs and the build goes on) and sets `GEOIP_DB_PATH=/app/geoip/dbip-city-lite.mmdb`. Without the file, city and country are simply empty. The file is about 127 MB and is read into memory, so give the Cloud Run instance at least 1 GiB. Rebuild the image to refresh the data (DB-IP publishes monthly).
- The licence is CC BY 4.0: "IP geolocation by DB-IP" must stay visible in the privacy text (`/terms`) and the admin dashboard.
- **Retention is 12 months.** The daily `/api/cron/connections` job deletes `user_sessions` that were revoked or last seen more than 12 months ago, and `app_events` older than 12 months (the response reports `purged`).
- Sessions made before this change have no `sid` in their cookie, so everyone signs in once more after the first deploy.

## 8. Logs and health

```bash
gcloud run services logs read weekly-posts --region=$REGION --limit=100
gcloud run services logs tail weekly-posts --region=$REGION          # live (may ask to install a component)
gcloud builds list --limit=5
gcloud scheduler jobs list --location=$REGION
```

Or in the console: **Cloud Run → weekly-posts → Logs**, and **Logs Explorer** with the filter `resource.type="cloud_run_revision" severity>=ERROR`. Scheduler results appear under **Cloud Scheduler** (last run, status).

## 9. Your own domain

Easiest: Cloud Run **domain mappings** (`gcloud beta run domain-mappings create --service weekly-posts --domain app.example.com --region $REGION`), then add the DNS records it prints. Domain mappings are a preview feature and are not offered in every region; if your region is not supported, put a global external Application Load Balancer in front of the service instead (serverless NEGs; Google's guide "Set up a global external Application Load Balancer with Cloud Run"). After the domain works: set `NEXT_PUBLIC_APP_URL` to it and redeploy, and in Supabase set **Authentication → URL Configuration → Site URL** to the same address.

## 10. After the first deploy

**Live (2026-10-14):** project `weekly-posts-471203`, keyless (option A), buckets `weeklyposts-471203-*`, service `https://weekly-posts-526531409571.australia-southeast1.run.app`, 4 Cloud Scheduler jobs, budget alert ₹450/month. First Cloud Build: 3 minutes, image smoke test passed on Linux.


1. Open the site and sign in with your own email (the link arrives through Resend).
2. Complete setup, press **Generate this week's posts**, and check the weekly email arrives.
3. Upload a logo, then check the file appears in the `...-brand-assets` bucket (console → Cloud Storage).
4. Run the manual checks in [email-checklist.md](email-checklist.md) (Gmail, Outlook, real phones).
5. In Supabase, turn off **Authentication → Sign In / Providers → Allow new users to sign up**; the app creates accounts itself.

## 11. Region and other things to know

- **Region.** Cloud Run, Cloud Storage, Artifact Registry and Cloud Scheduler all use `australia-southeast1` (Sydney) because the Supabase database is in Sydney (ap-southeast-2). Every page makes several database calls, so running far from the database makes each one slow. If you would rather host elsewhere, move the Supabase project while it is still empty and change `_REGION` and the bucket location together. Gemini uses `global` and is not affected.
- **`NEXT_PUBLIC_` settings are baked in at build time.** After changing one, build and deploy again.
- **Cold starts.** With minimum instances 0 the first request after a quiet period takes a few extra seconds. Set `--min-instances=1` on the service (about the cost of one small always-on instance) once owners are waiting on it.
- **Local files do not persist** on Cloud Run: that is why files go to Cloud Storage and the database to Supabase. The mock backend must never be used there; the app refuses the mock sign-in whenever `K_SERVICE` is set.
- **Nothing is posted automatically.** The site only emails owners; every post needs the owner's tap.
- **Secrets shared in chat.** The Supabase service role key and database password were shared in chat once. Reset them in Supabase (Database → Settings, and API Keys) before real owners sign up, then update the Secret Manager versions and redeploy.
- Never put `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` or `GOOGLE_SERVICE_ACCOUNT_JSON` in a setting whose name starts with `NEXT_PUBLIC_`: those are visible to every visitor.
- **Costs to keep an eye on.** Cloud Run (pay per use), Cloud Build (the free minutes cover a few builds a day), Artifact Registry (storage of old images; delete old ones now and then), Cloud Storage, Secret Manager (cents), Vertex AI (the real cost; see the AI cost rule in `CLAUDE.md`).

## 12. Checking the Cloud Storage connection (optional, once the buckets exist)

```bash
GCS_BUCKET_PREFIX=weeklyposts-prod GOOGLE_SERVICE_ACCOUNT_JSON="$(cat key.json)" \
  node --import tsx scripts/live-check-gcs.mts
```

It writes, reads, lists, signs and deletes a few small files under a throw-away brand id in all five buckets. It is not part of `npm test`.

## 13. Firebase (live status, optional)

Live status lets open pages update as work happens: the Queue moves from Scheduled to Publishing to Published without a reload, and a Brand Face shows its progress pose by pose. The server writes short-lived, non-sensitive, brand-scoped status documents to Firestore; Supabase stays the system of record (see [14-firebase-plan.md](14-firebase-plan.md) and the decision D11 in [architecture.md](architecture.md)). Nothing in Firestore holds captions, payment IDs, secrets or personal data, and a TTL policy deletes the documents within a day.

It is **off until both `_FIREBASE_WEB_API_KEY` and `_FIREBASE_WEB_APP_ID` are given** to the build. `REALTIME_BACKEND=off` turns it off on the service at any time, and the app then behaves as it did before.

### One-time setup (owner approval needed)

Run these once, in Google Cloud Shell or Git Bash, from the repo root:

```bash
PROJECT_ID=weekly-posts-471203
REGION=australia-southeast1
RUN_SA=weekly-posts-run@$PROJECT_ID.iam.gserviceaccount.com

# 1. APIs (iamcredentials is already on, section 1)
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

# 6. IAM (Token Creator on itself is already granted, section 2)
gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:$RUN_SA --role=roles/datastore.user
gcloud iam service-accounts get-iam-policy $RUN_SA   # confirm Token Creator on itself

# 7. Security rules (repo root: firebase.json and firestore.rules)
npx -y firebase-tools@latest deploy --only firestore:rules --project=$PROJECT_ID

# 8. Console > APIs & Services > Credentials > "Browser key (auto created by Firebase)":
#    HTTP referrers: https://weekly-posts-526531409571.australia-southeast1.run.app/*, http://localhost:3000/*
#    APIs: Identity Toolkit, Token Service, Cloud Firestore
```

Then deploy (section 6) with the two values from step 2 given as substitutions, `_FIREBASE_WEB_API_KEY=...` and `_FIREBASE_WEB_APP_ID=...`, either added to `deploy/main.subs.txt` or passed on the command line (see [SETUP.md](SETUP.md) section 8.2). The deploy step then sets the five settings in the table in section 5. Do not give only the key: the app id is needed too.

### Production checks

- Two devices on `/week`, both signed in to the same brand: "Post now" on one updates the other without a reload.
- Reading another brand's path in the browser gives `permission-denied`.
- No `[live] write failed` in the Cloud Run logs (section 8).
- Firestore usage (Firebase console, Firestore > Usage) stays within the free tier.
- Switching off restores today's behaviour: `gcloud run services update weekly-posts --region=$REGION --update-env-vars=REALTIME_BACKEND=off`.
