# 15. Demo login for judges

Owner decision, 2026-10-18: judges of the AI Builder Cup reach the working prototype without email. Sign-in email only
reaches the addresses the sending provider currently allows, so a judge's own email would never get a link.

## Behaviour

- Page `/demo` (public): one field "Access code" and a "Try the demo" button. Short copy: you are signed in to a real
  demo business; nothing is published without approval.
- `POST /api/demo/login`: compares the code with `DEMO_ACCESS_CODE` in constant time. Wrong code: generic error, and at
  most 10 attempts per IP hash per 15 minutes (reuse the app's existing rate-limit helper if there is one). Right code:
  starts a normal session for the user whose email is `DEMO_LOGIN_EMAIL`, with `user_sessions.demo = true` and a
  `demo: true` claim in the session JWT, then redirects to `/home`. If either env var is empty the page says the demo
  is not available and the route returns 404.
- Demo sessions last 12 hours (normal sessions are 30 days).
- A small "Demo" pill sits in the app header during a demo session.

## Refused in a demo session (server side, in the action or route, never only hidden in the UI)

Account delete and data export; signing other devices out; connecting or disconnecting Instagram, Facebook or YouTube;
creating, editing or confirming a payment QR; changing account email or admin-only pages; starting a new Brand Face
generation (any paid face step). Each refusal shows: "Not available in the demo."

Allowed: everything else, including creating, editing, approving, scheduling and publishing posts (owner decision:
real publishing is allowed; nothing is published without approval), Plan a week, Ideas, brand edits.

## AI budget

During judging the demo user's brands get a weekly AI cap of `DEMO_WEEKLY_USD_CAP` (owner approved $5) instead of
`WEEKLY_USD_CAP` ($0.50). If the daily call cap would block a busy demo, raise it the same way with
`DEMO_DAILY_CALL_CAP`. Unset means the normal caps.

## Settings

| Var | Where | Notes |
|---|---|---|
| `DEMO_LOGIN_EMAIL` | plain env (cloudbuild substitution `_DEMO_LOGIN_EMAIL`) | The account judges enter |
| `DEMO_ACCESS_CODE` | Secret Manager | Shared with judges in the submission |
| `DEMO_WEEKLY_USD_CAP`, `DEMO_DAILY_CALL_CAP` | plain env | Optional |

Migration: `0026_demo_sessions.sql`.
