# Weekly Posts admin dashboard

A separate, private Next.js app (its own `package.json`, build and Vercel project) that lets the owner watch the main app:
which devices are signed in, what users did, every AI generation and its cost, and the activity log. It reads the main
app's Supabase Postgres directly and can do one write: sign a device out.

The main app ignores this folder (`tsconfig.json` exclude, `eslint.config.mjs` ignores, `vitest.config.mts` exclude,
`.dockerignore` and `.gcloudignore`), so the Cloud Run build never uploads it.

## Pages

| Path | What it shows |
|---|---|
| `/` | Active sessions now (seen in the last 15 minutes), sign-ins today, users, brands, AI spend today / 7 / 30 days, posts made / published / failed (7 days), research runs (7 days), errors (24 hours) |
| `/devices` | Every sign-in: masked user email, brand, device type, browser, OS, city and country, first and last seen, status. Filters: active only, device type, country, email search. "Sign out" per device (a confirm step opens first) |
| `/users`, `/users/[id]` | Users with sign-up date, last seen, sessions, posts, AI spend. Detail: full email, brands, sessions, AI calls by kind, counts, and a newest-first history (activity events, briefs, AI calls, posts, queue, research runs, faces, emails), paged |
| `/activity` | The `app_events` stream. Filters: kind, ok / failed, user, brand, date range. Keyset paging |
| `/generations` | `usage_events` (time, brand, kind, model, result, cost) with spend per kind and per day (30 days) as simple bars |

Times are UTC. The footer carries the attribution "IP geolocation by DB-IP" (CC BY 4.0).

`usage_events` rows carry kind, model, cost and an ok flag (migration 0022). Older rows have no model and show "—".
The Generations page also has a failed-only filter, a per-model cost total, and failed AI calls count toward "errors, 24 hours".

## Security design

- **Server only.** Every page is a server component (`export const dynamic = "force-dynamic"`), data is read in the
  server with `pg` and `ADMIN_DATABASE_URL`, and nothing is fetched from the browser. There are no browser-exposed
  environment variables. The only client component is the navigation highlight (`src/components/nav-links.tsx`).
- **Sign-in.** Email magic link, only for addresses in `ADMIN_EMAILS`, sent with Resend. Any other address (or a
  rate-limited one) gets the same "check your inbox" answer and no email; the email is sent after the response goes out
  so timing is the same too.
  - The link is a signed token (HMAC-SHA256 with `ADMIN_AUTH_SECRET`) with the email, a 15-minute expiry and a nonce.
  - It works once: used nonces are stored (hashed) in `public.admin_actions` (`action = 'link_used'`), inside a
    transaction with an advisory lock. Opening the link only shows a "Sign in" button, so email scanners cannot use it up.
  - Limits: 5 requests per address per hour and 60 in total per hour, counted in `admin_actions`
    (`action = 'link_requested'`, address stored only as a keyed hash).
  - Session: a second signed token in an `httpOnly`, `Secure`, `SameSite=Strict` cookie (`__Host-admin_session` in
    production), valid 12 hours, and re-checked against `ADMIN_EMAILS` on every request. To lock someone out at once,
    remove the address from `ADMIN_EMAILS`, or rotate `ADMIN_AUTH_SECRET` to end every session.
- **Every page and server action checks the session itself** (`requireAdmin()`); `src/proxy.ts` only adds a quick redirect
  and the Content-Security-Policy nonce.
- **Headers.** HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, a nonce-based CSP (scripts only
  with the per-request nonce and `strict-dynamic`; `style-src` allows inline styles for the framework), `noindex`
  metadata, `X-Robots-Tag`, `robots.txt` that disallows everything, `Cache-Control: no-store`.
- **Never shown, never selected.** Post text and captions, brief notes, face descriptions, payment IDs, tokens, email
  subjects and bodies, phone numbers, user agents and IP hashes. Queries select named columns only
  (`tests/queries.test.ts` checks every SQL statement for forbidden names). `app_events.detail` passes through a filter
  (`safeDetail`) that drops keys like text, caption, note, payment, token and email, and long values. Queue errors are
  cleaned (links, token-like strings and long numbers removed, 160 characters at most). User emails are masked
  (`j***@g***.com`) everywhere except the user detail page.
- **Audit.** Sign-in (`sign_in`, `link_used`), sign-out (`sign_out`) and every device sign-out (`session_revoke`, with
  the admin's email, the session id and the user id) are written to `public.admin_actions`.

## Environment variables

| Name | Purpose |
|---|---|
| `ADMIN_DATABASE_URL` | Postgres connection string of the main app's Supabase project: Project Settings > Database > Connection string > **Transaction pooler** (port 6543). Server only. |
| `ADMIN_DATABASE_CA` | Optional. PEM text of the Supabase CA certificate so the server certificate is verified. Blank = encrypted but not verified. |
| `ADMIN_EMAILS` | Comma-separated sign-in addresses (case does not matter). |
| `ADMIN_AUTH_SECRET` | 32+ random characters. `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `RESEND_API_KEY` | Resend API key. Without it, local development prints the link to the server console; production refuses to send. |
| `EMAIL_FROM` | e.g. `Weekly Posts Admin <admin@your-verified-domain.com>` (the domain must be verified in Resend, with SPF, DKIM and DMARC). |
| `ADMIN_APP_URL` | The public address of this dashboard, no trailing slash. Used in the sign-in link. |

Copy `.env.example` to `.env.local` for local work (`npm run dev` serves on port 3100).

## Deploy on Vercel

1. In Vercel, **Add New > Project**, import the repository, and set **Root Directory** to `admin-dashboard`. Framework
   preset: Next.js (detected). Node.js 22 or later.
2. Add the seven environment variables above under Settings > Environment Variables (Production; Preview only if you
   want preview deployments to work, and then use a different `ADMIN_APP_URL`).
3. **Region.** `vercel.json` pins functions to `syd1` (Sydney), next to the Supabase database in `ap-southeast-2`
   that the Cloud Run service also uses (`cloudbuild.yaml`). If the database is elsewhere, change `regions` to the
   closest Vercel region (for example `iad1` for us-east-1, `fra1` or `lhr1` for Europe, `sin1` for Singapore, `bom1` for Mumbai).
4. **Deployment Protection.** In Settings > Deployment Protection, turn on **Vercel Authentication** for all deployments
   (and, on plans that have it, password protection or trusted IPs for Production). This is an extra layer in front of
   the magic-link sign-in: strangers cannot even reach the login page.
   If Vercel Authentication is on, open the production URL while signed in to Vercel, then use the magic link.
5. Deploy. Open the address, enter an address from `ADMIN_EMAILS`, press the link in the email, then **Sign in**.
6. Set `ADMIN_APP_URL` to the final address (custom domain or `*.vercel.app`) and redeploy if it changed.

The dashboard needs these main-app migrations applied: `0001` to `0022` (it reads `user_sessions`, `app_events`,
`admin_actions` from `0022`).

## Database access: a dedicated role (recommended before real users)

For the first run `ADMIN_DATABASE_URL` may be the service (`postgres`) connection. Before the app has real users, move to
a role that can do only what this dashboard does. Sketch (run once in the Supabase SQL editor; **not** a migration, and
the password must come from a secret store):

```sql
create role admin_dashboard login password '<long random password>';
grant usage on schema public to admin_dashboard;
grant select on public.profiles, public.brands, public.brand_members, public.usage_events, public.post_briefs,
  public.posts, public.queue_items, public.research_runs, public.brand_faces, public.email_log, public.app_events
  to admin_dashboard;
grant select, insert on public.admin_actions to admin_dashboard;
grant usage on sequence public.admin_actions_id_seq to admin_dashboard;
grant select on public.user_sessions to admin_dashboard;
grant update (revoked_at, revoked_by) on public.user_sessions to admin_dashboard;
```

Every table in the main schema has row-level security with no policy for other roles, so this role also needs either
`BYPASSRLS` or one `for select using (true)` policy per table (a schema change, which the project owner must approve).
The connection string for it uses the transaction pooler with the user `admin_dashboard.<project-ref>`.

## Development

```bash
npm install
npm run typecheck   # next typegen && tsc --noEmit
npm run lint
npm test            # vitest; runs the real SQL on PGlite with the main app's migrations
npm run build
```

Tests use PGlite and the migrations in `../supabase/migrations`, so they need the full repository (not just this folder).
They never touch a real database or send email.

## Licences

Runtime dependencies: Next.js, React, `pg` (MIT), `@fontsource-variable/onest` (SIL OFL 1.1, the Onest font). Dev
dependencies: PGlite (Apache-2.0), Vitest, Tailwind CSS (MIT). IP geolocation data used by the main app is by DB-IP (CC BY 4.0).
