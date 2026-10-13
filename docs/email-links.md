# Email links: design (V-14)

Owner: orchestrator. Requirements: Req 14 (signed, expiring no-login links), 16, 20, 24, 25, and PRD §8 (forwarded links). This note also covers the magic-link follow-up from V-2.

## 1. Rule: a link never acts on GET

Mail security scanners (Outlook SafeLinks, Gmail and corporate gateways) and link previewers open every link in an email before the person does. If a GET approves a post, signs in or unsubscribes, scanners will approve, sign in and unsubscribe on the owner's behalf.

So every action link works in two steps:
1. **GET** `/e/{token}` shows a small page: what will happen, the post preview, and one button ("Approve this post", "Sign in", "Pause emails for 2 weeks").
2. **POST** (a form submit with the same token) does the action, then shows the result.

There is one exception. RFC 8058 one-click unsubscribe (`List-Unsubscribe-Post: List-Unsubscribe=One-Click`) is a POST by design, so it acts directly.

The magic link follows the same rule: `/auth/callback` GET shows "Continue to {APP_NAME}", and the POST consumes the `jti` and signs in (built in V-3; the POST also checks a CSRF nonce bound to the browser).

## 2. Token

- **Format:** compact JWS (jose HS256) with the key `EMAIL_LINK_SECRET`. This is a separate secret from `AUTH_SECRET`; in mock mode it falls back to a derived dev value.
- **Claims:**
  - `sub` = brand_id
  - `pid` = post_id (absent for brand-level actions)
  - `act` = one of `view_week`, `approve`, `skip`, `edit`, `checkin`, `pause`, `unsubscribe`, `ready`
  - `wk` = week_start
  - `jti`
  - `iat`
  - `exp` = iat + 14 days (AC 14)
- **Single-use vs reusable:**
  - `approve`, `skip`, `checkin` and `pause` are idempotent rather than single-use. Re-submitting shows the current state ("Already approved, undo?").
  - The magic link is single-use.
- **Scope:** a token acts only on its own post or brand. Every POST re-checks that the post still belongs to `sub`, that the batch is not deleted, and that the brand is not deleted or unsubscribed (for weekly links).
- **Forwarded links (PRD §8):** links are per post and expire. Every action is written to `post_actions` with `via = 'email_link'` and a short hash of the `jti`. The owner sees the history on the dashboard and can undo.
- **Logging:** never log full tokens. Log only `jti` hashes.

## 3. Pages (no login, public paths `/e/*`)

| Action | GET shows | POST does |
|---|---|---|
| `view_week` | All posts of the week, each with Approve / Edit / Skip buttons (each a POST with its own token) | n/a |
| `approve` | Post preview + "Approve" | status → `approved`, `approved_at`; then "Ready to share" link |
| `skip` | Post preview + "Skip this one" | status → `skipped` |
| `edit` | Editor: caption, photo swap (from library), "Rewrite with an instruction" box | saves the edit (owner text is a source), or runs the rewrite (Req 15), saving the instruction to `voice_feedback` |
| `ready` | Approved posts with Share (mobile Web Share) and Download / Copy (desktop), plus "Mark as posted" | marks posted |
| `checkin` | "Did posts bring enquiries this week?" with None / A few / Many | upsert `checkins` |
| `pause` | "Pause emails for 2 weeks?" | sets `email_paused_until` |
| `unsubscribe` | "Stop weekly emails?" | sets `email_unsubscribed_at` |

A post with open "please check" flags can still be approved: the owner sees the flags first, and each must be confirmed or removed before Approve is enabled (R8 in v1; Req 11 now).

## 4. Email content (weekly)

- **Subject:** "Your {n} posts for the week of {date} are ready".
- **Body:**
  1. A one-line intro.
  2. For each post: the image (square PNG, hosted, max 600 px wide in the email), the first 2 lines of the caption, the channel and day, any "please check" note, and buttons [Approve] [Edit] [Skip].
  3. A one-tap check-in row: "Did last week's posts bring enquiries?" None / A few / Many.
  4. A summary line (Req 21) once data exists.
  5. Footer: Pause for 2 weeks, Unsubscribe, and why they get this email.
- **Headers:** `List-Unsubscribe: <https://…/e/{unsub}>, <mailto:…>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- **HTML:** table layout, inline CSS, 600 px wide, system fonts, alt text on every image, buttons as styled links (bulletproof). Include a plain-text version with the same links. No JS, no forms in the email.
- **Images** are served from a public, unguessable URL (`/i/{signed}`), because email clients cannot send our cookie. They are signed with the same 14-day expiry.
