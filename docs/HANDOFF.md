# Handoff: state of Weekly Posts (2026-10-16)

Read this first on a new machine or in a new Claude session. Setup: `docs/SETUP.md`. Rules: `CLAUDE.md`.

## Where things are

| | |
|---|---|
| Live app | https://weekly-posts-526531409571.australia-southeast1.run.app (Cloud Run `weekly-posts`, revision 00008 on 2026-10-16) |
| Admin dashboard | https://weekly-posts-admin-526531409571.australia-southeast1.run.app (Cloud Run `weekly-posts-admin`, email-link sign-in for the 2 admins) |
| Cloud project | `weekly-posts-471203`, region `australia-southeast1`; Supabase Postgres (Sydney) |
| Repo | https://github.com/quant-1729/weekly-posts (private). The owner commits and pushes; Claude never does. |
| Specs | `docs/6-prd-v3.md`, `docs/9-changes-v3.md` (sections 16 and later: owner changes), `docs/10-plan-research-and-brand-face.md`, `docs/12-research-repos-and-proposal.md`, `docs/mascot-inspiration.md`, design `docs/design/` |
| Task list | `docs/8-build-plan-v3.md` (Phase 6 = Ideas and Brand Face) |

## Built (all tests passing, about 4,500)

- **Create a post:** details first (description, multiple post types with a "Main" one, Select all), then "On the post", Design, Review, Schedule. Formats: **Post**, **Carousel** (3-10 slides) and **Reel** (shown as "Coming soon").
- **Design:**
  - The owner's photo is the hero.
  - Filters (warm, cool, vivid, soft, black and white, vintage) change only the photo and background.
  - The 3 options are different compositions.
  - Characters take roles in posts: presenter, sign-holder, pointer, peeker, percher, celebrator, narrator.
  - The right panel is styled like the sidebar.
- **Characters:** 13 code-drawn characters (Tween plus the Figital kit; Laltain excluded; shown by object name). One shared rig gives all 41 actions. Source kit: `vendor/figital-mascots`.
- **Brand Face:** mascot, illustrated character, the owner's own photo, or a realistic AI person. The owner approves the price before anything is made (about $1.32 per face, with a $2 cap).
- **Review:** caption editing, compact checks, Undo all, a single Share icon. **Schedule:** a themed calendar where any free time can be picked.
- **Ideas:** weekly trend research with Google-grounded search, competitor sites and YouTube. It has its own budget of $0.50 per brand per week, plus "Make this post".
- **Post results:** an hourly insights job. It waits on the Meta App Review permissions; the drafts are in `docs/meta-app-review-insights.md`.
- **Sign-in sessions:** device, browser and city are recorded, never the IP address. The admin dashboard can sign a device out. Activity and AI usage are logged with model and ok/failed.
- **Redesign:** the Fish-style theme (Onest font, cream background, near-black pill buttons). The approved prototype is `docs/design/prototype-fish-theme.html`.

## Not deployed yet (local only)

- Carousels (migrations `0023_content_format.sql`, `0024_character_column_fixup.sql`) and everything built after revision 00008. Deploy with `docs/SETUP.md` §8: migrations first, then the app.

## Waiting for the owner's decision

1. **Carousel fixes:** shrink the empty panels on bubble and sign slides; make the cover character bigger; let the owner edit slide text in Review.
2. **Seven prompt changes** (from `docs/mascot-inspiration.md`):
   - two voices (the bubble holds a feeling, facts never only in the bubble);
   - a silent mascot mode;
   - a personality per character;
   - a recipe per design option (about 1 cent more per post);
   - humour guardrails;
   - topical posts in the Amul style;
   - series and carousel plans.
3. **Four mascot visual fixes:** drop the tiny accent size; festive decoration for festivals; a bigger offer sign; more variety in which side the character stands.
4. Before submitting to Meta: mention insights in the terms; decide on the BigQuery benchmarks and the `business_management` permission.

## Owner to do

- Run the scheduler script once (`docs/SETUP.md` §8.4). As of 2026-10-16, only 4 of the 6 jobs exist; insights and research are missing.
- **Rotate the secrets that were pasted into chat early on:** the Supabase service key and database password, the Meta and Instagram app secrets, and the Resend key. Rotate them in their consoles, update Secret Manager, then redeploy.
- Trademark search for "Parchi" before public use.

## Working rules (see `CLAUDE.md` for all)

- **Owner decisions.** The orchestrator (Opus) owns migrations, shared types and prompts, and delegates code to the builder agents. Anything new goes to the owner as a question first.
- **Approvals first.** Ask before anything outward-facing or hard to undo (deploys, sending, spending, deleting), and before any AI run estimated over $0.50.
- **Secrets.** Never ask for secrets in chat; only name the `.env.local` variables. Never commit.
- **Facts.** Posts state only facts from the owner's brief or profile. Payment IDs are never sent to AI.
- **Migrations.** Never edit a migration after it has been applied anywhere; add a new numbered file instead. Lesson from 0022 and 0024.
