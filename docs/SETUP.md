# Setting up Weekly Posts on a new machine

This guide gets a fresh computer from nothing to a running local copy, and, optionally, to deploying. Commands are given for **Windows (PowerShell)** and **macOS/Linux (bash)**. For the project's state and open decisions, read `docs/HANDOFF.md`.

**Never commit secrets.** `.env*` files are git-ignored, except the `.env.example` templates. Production secrets live in Google Secret Manager (project `weekly-posts-471203`), and a local copy never needs them.

---

## 1. Install the tools

| Tool | Version | Check |
|---|---|---|
| Git | any recent | `git --version` |
| Node.js | **24** (22 or newer works; `.nvmrc` says 24) | `node -v` |
| GitHub CLI (optional, makes sign-in easy) | any | `gh --version` |
| Google Cloud SDK (only for live AI or deploying) | any recent | `gcloud --version` |
| Claude Code (to continue the work with Claude) | latest | `claude --version` |

On Windows, PowerShell's execution policy blocks `gcloud.ps1`. Either call `gcloud.cmd` instead of `gcloud` (the commands below do), or allow scripts once for your user:
```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## 2. Get the code

The repository is private: `https://github.com/quant-1729/weekly-posts`. Sign in to GitHub with an account that has access (`quant-1729`, or one added as a collaborator):
```bash
gh auth login
gh auth setup-git
git clone https://github.com/quant-1729/weekly-posts.git
cd weekly-posts
```

## 3. Install packages

```bash
npm ci
cd admin-dashboard && npm ci && cd ..
```
The admin dashboard is a separate app with its own `package.json`.

## 4. Create `.env.local`

You don't copy the old machine's `.env.local`. A script writes a new one with fresh local-only secrets.

**Option A: offline (recommended first run).** Uses canned AI answers, a local database and fake email. You need no Google account and spend no money.
```bash
node scripts/setup/make-env-local.mjs
```

**Option B: with live AI** (real Gemini and Imagen on Vertex AI; costs money; see the cost rule in `CLAUDE.md`):
```bash
node scripts/setup/make-env-local.mjs --live-ai --project=<PROJECT_ID> --location=global
```
Then set up Google sign-in as in section 5.

What the generated file does:

| Setting | Local value | Meaning |
|---|---|---|
| `DATA_BACKEND`, `STORAGE_BACKEND` | `mock` | Local PGlite database and files in `.data/`. They are created on first start, and every migration in `supabase/migrations` is applied automatically. |
| `RESEND_API_KEY` | blank | No real email is sent. Sign-in links and other emails appear at **http://localhost:3000/dev/outbox**. |
| `AI_MODE` | `fixture` or `live` | Canned answers, or real Vertex AI. |
| `AUTH_SECRET`, `EMAIL_LINK_SECRET`, `CRON_SECRET`, `TOKEN_ENCRYPTION_KEY` | random | Local only; different from production. |
| `ADMIN_EMAILS` | the two admin emails | Who can open `/admin` locally. |

Every other setting is described in `.env.example`. Only fill in the ones you are testing, such as Meta connect, YouTube or the cut-out service.

## 5. Google Cloud sign-in (only for live AI or deploying)

**Projects:**
- `weekly-posts-471203` is **production**: Cloud Run, Cloud Build, Secret Manager, Scheduler and Storage. It runs as the `weekly-posts-run` service account and uses no key files.
- The old development machine called Vertex AI on project `project-ca7324a2-c8dd-49f3-8a9`, through a personal credential file kept *outside* the repo. You don't need that file on a new machine.

**Recommended for a new machine: Application Default Credentials with your own Google account.**
```bash
gcloud auth login                                   # for gcloud commands (deploys, secrets, logs)
gcloud auth application-default login               # for the app's own Vertex AI calls
gcloud config set project weekly-posts-471203
gcloud auth application-default set-quota-project <PROJECT_ID>   # the project used for live AI
```
- Your account needs the role **Vertex AI User** (`roles/aiplatform.user`) on `<PROJECT_ID>`.
- Leave `GOOGLE_APPLICATION_CREDENTIALS` blank in `.env.local`; the Google library finds the login by itself.
- To use production's project for local AI, use `--project=weekly-posts-471203` in step 4, and ask the project owner for the Vertex AI User role.

**Alternative: a credential file.** Copy it over a private channel (a password manager or an encrypted drive), never through Git or chat. Keep it outside the repo, then point `.env.local` at it:
```
GOOGLE_APPLICATION_CREDENTIALS=C:/Users/<you>/keys/vertex-dev.json
```

## 6. Run it

```bash
npm run dev            # http://localhost:3000
```
1. Open http://localhost:3000, enter any email, tick the box, then press "Send me a link".
2. Open http://localhost:3000/dev/outbox and click the sign-in link.
3. The setup wizard runs the first time.

**Checks** (all should pass before a deploy):
```bash
npm run typecheck
npm run lint
npm test               # about 4,500 tests; a few timing tests can be slow under load, so rerun them alone if they time out
npx next build
```
- To recreate the local database, stop the server and delete `.data/` (this also deletes local uploads and the outbox).
- The **admin dashboard** needs a real Postgres connection, so it doesn't run against the local mock database. Use the deployed one (section 8). To work on it, see `admin-dashboard/README.md`.

## 7. Continue with Claude Code

- `CLAUDE.md` (project rules and how work is split) is in the repo, and Claude reads it automatically.
- Start with `docs/HANDOFF.md`: current state, decisions and pending questions.
- Claude's personal memory notes from the old machine are not in Git. They live in `C:\Users\RITS\.claude\projects\C--Users-RITS-Projects-Post\memory\` on the old machine. To carry them over, copy that folder to the same place under the new machine's user folder. The folder name comes from the project path: a path like `C:\Users\you\Projects\Post` becomes `C--Users-you-Projects-Post`. `docs/HANDOFF.md` repeats everything important from them.

## 8. Deploying (production)

Every deploy needs `gcloud auth login` with an account that can use Cloud Build in `weekly-posts-471203`, plus your explicit decision to deploy.

**8.1 Database changes first**, if `supabase/migrations/` has new files. This needs `SUPABASE_DB_URL` in `.env.local`. Copy it from Secret Manager into your *local* file only:
```bash
gcloud secrets versions access latest --secret=SUPABASE_DB_URL --project=weekly-posts-471203
```
Put the value in `.env.local` as `SUPABASE_DB_URL=...`, then:
```bash
npm run db:migrate              # trial run: applies, checks, rolls back
npm run db:migrate -- --commit  # really applies
```
Afterwards, remove `SUPABASE_DB_URL` from `.env.local` again if you prefer.

**8.2 The main app** (about 8 to 10 minutes). The deploy settings are in `deploy/main.subs.txt`. They are not secret: the Supabase anon key is public by design, and `_EXTRA_SECRETS` only names Secret Manager entries.

PowerShell:
```powershell
gcloud.cmd builds submit --config cloudbuild.yaml --project=weekly-posts-471203 --region=australia-southeast1 --service-account=projects/weekly-posts-471203/serviceAccounts/weekly-posts-build@weekly-posts-471203.iam.gserviceaccount.com --substitutions="$((Get-Content 'deploy\main.subs.txt' -Raw).Trim())"
```
bash:
```bash
gcloud builds submit --config cloudbuild.yaml --project=weekly-posts-471203 --region=australia-southeast1 --service-account=projects/weekly-posts-471203/serviceAccounts/weekly-posts-build@weekly-posts-471203.iam.gserviceaccount.com --substitutions="$(cat deploy/main.subs.txt)"
```
Live app: https://weekly-posts-526531409571.australia-southeast1.run.app

**8.3 The admin dashboard** (its own Cloud Run service). Run this from `admin-dashboard/`:
```powershell
gcloud.cmd builds submit --config cloudbuild.yaml --project=weekly-posts-471203 --region=australia-southeast1 --service-account=projects/weekly-posts-471203/serviceAccounts/weekly-posts-build@weekly-posts-471203.iam.gserviceaccount.com --substitutions='^#^_ADMIN_EMAILS=priyanshuagrawal1729@gmail.com,shuklabhavan28@gmail.com#_EMAIL_FROM=Weekly Posts <hello@zerochills.in>'
```
Live: https://weekly-posts-admin-526531409571.australia-southeast1.run.app. Sign-in is an email link, for the two admin emails only.

**8.4 Scheduled jobs**, once and after adding jobs. Run in bash (Git Bash on Windows) from the repo root. The cron secret comes from Secret Manager and is never shown:
```bash
export PROJECT_ID=weekly-posts-471203 && export CRON_SECRET="$(gcloud secrets versions access latest --secret=CRON_SECRET --project=weekly-posts-471203)" && bash scripts/gcp/scheduler.sh
```
This sets up six jobs: weekly, reminders, queue, insights (hourly), connections (daily) and research (Mondays 06:00 to 09:00 UTC).

**After a deploy:** reload any open tab before using it. Old pages call server actions that no longer exist and show "Something went wrong".

More detail: `docs/deploy.md` (one-time cloud setup, roles, secrets, troubleshooting).

## 9. Pushing to GitHub

```bash
git status                       # review what changed
git add -A
git commit -m "Describe the change"
git push origin main
```
If `git push` says **"Repository not found"**, you're signed in to GitHub as an account without access (`gh auth status` shows which). Fix it with one of:
- `gh auth login`, choosing the `quant-1729` account, then `gh auth setup-git`; or
- on github.com, have `quant-1729` add your account under Settings → Collaborators.
