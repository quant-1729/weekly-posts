> Superseded by [docs/deploy.md](deploy.md) (Cloud Run); kept for reference.

# Deploying to Vercel

How to set up the Vercel project for Weekly Posts (repo `quant-1729/weekly-posts`). `.env.local` never leaves your computer, so Vercel needs its own copy of the settings.

## Before the first deploy

These must be done first, or the deploy will fail or won't work:

| Who | What | Why |
|---|---|---|
| Claude | ✅ Done: the app runs on Supabase (H-7) | The local stand-in (PGlite, local files) cannot run on Vercel |
| Claude | ✅ Done: `GOOGLE_SERVICE_ACCOUNT_JSON` support (tested live) | Locally, Gemini logs in with a key *file path*. Vercel has no files, so the key's contents go in a setting instead |
| Claude | ✅ Done: `vercel.json` with the hourly jobs and the Sydney region | Weekly post generation and reminders run from Vercel Cron |
| You | Resend account and a verified sending domain | Without it the site cannot send email on Vercel, so nobody can sign in |
| You | Dedicated Google Cloud project for Gemini, with a **service account key** | The shared project fails on about 1 in 5 calls, and its login on this computer is a personal Google login, which should not go on a server |

Claude's three items are done. You can deploy once you have Resend and the Google service account key.

## 1. Create the project

1. Sign in at [vercel.com](https://vercel.com) and connect GitHub.
2. **Add New → Project**, then import `quant-1729/weekly-posts`.
3. Framework: Next.js (detected automatically). Leave the build settings as they are.
4. Add the environment variables below **before** the first deploy.
5. Optional: **Settings → Domains** to add your own domain.

## 2. Environment variables

Go to **Project → Settings → Environment Variables**. Tick **Production** and **Preview** for each one.

**Shortcut:** the file `.env.vercel` in the project folder (on your computer only; it is git-ignored and never committed) already has the real values filled in, plus newly generated secrets. Replace the `REPLACE_ME` lines, then paste the whole file into the Key field: Vercel splits it into separate variables.

### Required

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Your site address, e.g. `https://weekly-posts.vercel.app` or your own domain. No trailing slash |
| `DATA_BACKEND` | `supabase` |
| `NEXT_PUBLIC_SUPABASE_URL` | Copy from `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Copy from `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | Copy from `.env.local` |
| `SUPABASE_DB_URL` | Copy from `.env.local`. Keep the `%40` in the password exactly as it is (it stands for `@`) |
| `AUTH_SECRET` | New random value (see section 3) |
| `EMAIL_LINK_SECRET` | New random value |
| `CRON_SECRET` | New random value |
| `GOOGLE_GENAI_USE_VERTEXAI` | `true` |
| `GOOGLE_CLOUD_PROJECT` | Your Google Cloud project ID (the new dedicated one, once you have it) |
| `GOOGLE_CLOUD_LOCATION` | `global` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The whole contents of the Google service account key file (`.json`), pasted as one value |
| `RESEND_API_KEY` | From Resend → API Keys, once your domain shows **Verified** |
| `EMAIL_FROM` | e.g. `Weekly Posts <hello@yourdomain.com>` (must be on the verified domain) |

### Optional

| Variable | Value |
|---|---|
| `EMAIL_REPLY_TO` | An address where owners' replies should go |

### Leave out

| Variable | Why |
|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | A file path; it does nothing on Vercel (use `GOOGLE_SERVICE_ACCOUNT_JSON`) |
| `GEMINI_API_KEY` | The AI Studio key is blocked; Vertex is used instead |
| `AI_MODE` | Blank means live AI, which is what production needs |
| `GEMINI_MODEL`, `GEMINI_TRANSCRIBE_MODEL` | Blank uses the tested default model |
| `REMOVE_BG_API_KEY` | Not used in v2 |
| `WHATSAPP_*` (all five) | Not used in v2 |

## 3. Making the random secrets

Run this once for each of `AUTH_SECRET`, `EMAIL_LINK_SECRET` and `CRON_SECRET`, and paste each result into Vercel:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Use new values, not the ones on your computer, so nothing on this machine can be used to fake production sign-ins or email links. Don't change them later without a reason: changing `AUTH_SECRET` signs everyone out, and changing `EMAIL_LINK_SECRET` breaks the links in emails already sent.

## 4. Things to know

- **`NEXT_PUBLIC_` settings are baked in at build time.** After changing any of them, redeploy (Deployments → ⋯ → Redeploy).
- **Other settings** take effect on the next deploy too, so redeploy after any change.
- **Hourly jobs:** once `vercel.json` is in the repo, Vercel runs `/api/cron/weekly` and `/api/cron/reminders` every hour and sends `CRON_SECRET` with each call automatically. Check them under **Settings → Cron Jobs**.
- **Region:** `vercel.json` runs the app in Sydney (`syd1`), next to your Supabase database (ap-southeast-2). Every page makes several database calls, so running far from the database makes each one slow. If you ever move the database, change the region to match.
- **Plan:** hourly jobs need the **Pro** plan. On the free Hobby plan, Vercel Cron runs at most once a day, which breaks "posts at the owner's local time". Hobby is fine for trying the site out; switch to Pro before the pilot.
- **Function time:** generating a week of posts can take up to about a minute and a half (the app asks for up to 5 minutes). If a generation ever times out, check the limits under **Settings → Functions**.
- **Nothing is posted automatically.** The site only emails owners; every post needs the owner's tap.

## 5. After the first deploy

1. Open the site and sign in with your own email (the link arrives through Resend).
2. Complete setup, press **Generate this week's posts**, and check the weekly email arrives.
3. Run the manual checks in [email-checklist.md](email-checklist.md) (Gmail, Outlook, real phones).
4. In Supabase, **Authentication → URL Configuration**: set the Site URL to your `NEXT_PUBLIC_APP_URL`.

## 6. Security reminders

- The Supabase service role key and database password were shared in chat once. Reset them in Supabase (Database → Settings, and API Keys) before real owners sign up, then update both `.env.local` and Vercel.
- In Supabase, turn off **Authentication → Sign In / Providers → Allow new users to sign up**. The app creates accounts itself.
- Never put `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` or `GOOGLE_SERVICE_ACCOUNT_JSON` in a setting whose name starts with `NEXT_PUBLIC_`: those are visible to every visitor.
