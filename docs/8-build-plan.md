# Build plan — PostMitra MVP

Turns the PRD ([6-prd.md](6-prd.md)) into tasks, each owned by one model.

## Roles

| Role | Model | Does | Never does |
|---|---|---|---|
| Orchestrator | Opus (your main Claude Code session) | Architecture, DB schema, AI prompt design, breaking work into tasks, reviewing each task against PRD acceptance criteria, integration | Writes bulk feature code itself |
| Builder | Sonnet (`builder` subagent) | Implements one task at a time: pages, API routes, components, integrations, tests | Changes scope or schema without the orchestrator |
| Helper | Haiku (`helper` subagent) | Data files, test sets, copy and translations stubs, running tests and summarising failures, docs, lint fixes | Feature logic or architecture |

## Tasks

Order follows PRD section 10. "AC" means the PRD acceptance criteria for that requirement.

### Week 1 — core engine and web flow

| ID | Task | Req | Owner | Done when |
|---|---|---|---|---|
| T-1 | Architecture note, folder structure, Supabase schema (users, brands, brand_members, brand_memory, posts, outputs, approvals, clicks, mascots) with row-level security | R14, all | Opus | Schema migrated; RLS blocks cross-brand reads |
| T-2 | Next.js app scaffold, Supabase client, phone OTP sign-in, mobile layout | R1 | Sonnet | R1 AC — **Done 2026-10-12** (mock backend; Supabase stubs) |
| T-3 | Brand setup by chat; voice note upload and transcription; editable profile screen | R2 | Sonnet | R2 AC — **Done 2026-10-13** (live Hindi voice note → correct profile; typed path ~2 min in browser; real-phone mic test pending) |
| T-4 | Prompt design: brand memory -> captions per channel and language; output JSON schema | R4, R5 | Opus | Prompt passes a 10-input dry run — **Done 2026-10-12** (10/10, ~$0.05; `test-data/results/t4-dry-run*.json`) |
| T-5 | Generate endpoint: one input -> 4 outputs (IG feed, status, FB, GBP text) | R4 | Sonnet | R4 AC — **Done 2026-10-13** (live: text 17.9 s, photo 8.0 s, Hindi voice 16.9 s; all < 60 s) |
| T-6 | Language and script switch per output | R5 | Sonnet | R5 AC (speed part) — **Done 2026-10-13** (live prompt 2-4 s; AI calls now time-limited, see risk note) |
| T-7 | Image templates (3 per format) rendered by code with Noto fonts, brand colours and logo | R6 | Sonnet | R6 AC — **Done 2026-10-13** (6 templates; HarfBuzz shaping; 40/40 Devanagari strings checked by eye) |
| T-8 | Test sets: 30 mixed-language inputs, Devanagari render strings, sample brands | R5, R6 | Haiku | Files in `/test-data` — **Done 2026-10-12** |

### Week 2 — plan, guardrail, review, mascot

| ID | Task | Req | Owner | Done when |
|---|---|---|---|---|
| T-9 | Indian festival and occasion calendar as JSON (next 12 months) | R3 | Haiku | Reviewed by Opus for dates — **Done 2026-10-13** (74 entries; 30 dates corrected against Drik Panchang/Calendarific) |
| T-10 | Weekly plan with suggested posting day per idea | R3, F1 | Sonnet | R3 AC |
| T-11 | Photo clean-up: crop, brighten, optional background removal | R7 | Sonnet | R7 AC |
| T-12 | Facts-only guardrail design (fact extraction + check) | R8 | Opus | Design note and prompt — **Done 2026-10-13** (`docs/guardrail.md`, `prompts/fact-check.ts`; live 3/3) |
| T-13 | Guardrail implementation; block download until confirmed; regulated-category warnings | R8 | Sonnet | R8 AC |
| T-14 | Planted-fact test set (made-up prices, dates, claims) | R8 | Haiku | 30 cases in `/test-data` — **Done 2026-10-13** |
| T-15 | Review/edit screen, regenerate, download, share to WhatsApp | R9 | Sonnet | R9 AC |
| T-16 | Post history per brand; brand switcher | R13, R14 | Sonnet | R13, R14 AC — **Done 2026-10-13** |
| T-17 | Mascot design: eligibility rules, concept prompt, character-sheet approach, blocked-figure list | R15 | Opus | Design note — **Done 2026-10-13** (`docs/mascot.md`, eligibility + blocklist code, concepts prompt) |
| T-18 | Mascot flow: eligibility, 3 concepts, 8-pose sheet, placement in templates, on/off per post | R15 | Sonnet | R15 AC |
| T-19 | 20-brand eligibility test set | R15 | Haiku | File in `/test-data` — **Done 2026-10-13** (20/20 pass eligibility rules) |

### Week 3 — sharing, tracking, WhatsApp, demo

| ID | Task | Req | Owner | Done when |
|---|---|---|---|---|
| T-20 | No-login approval link, comments, status, Nudge button | R10, F2 | Sonnet | R10 AC |
| T-21 | Click-to-WhatsApp short links, click counting, weekly summary, shareable summary | R11, F3 | Sonnet | R11 AC |
| T-22 | WhatsApp layer: inbound photo/text/voice -> outputs + review link; opt-in weekly template and reminders | R12, F1 | Sonnet | R12 AC |
| T-23 | Meta/BSP setup checklist, template message drafts, AI-chatbot policy check | R12 | Haiku drafts, you submit | Templates submitted |
| T-24 | Run all test sets; summarise failures by requirement | All | Haiku | Report in `/test-data/results.md` |
| T-25 | Final review against every AC; fix list; demo script | All | Opus | All AC pass or are listed as known gaps |

## Start-up checklist (you, before T-1)

1. Repo folder is `Post/` with `CLAUDE.md`, `.claude/agents/` and `docs/` already in place. Run `git init` there.
2. Keep the PRD and this plan in `docs/`; mark tasks done in the tables as they pass review.
3. Create a Supabase project and a Vercel project; keep keys in `.env.local` (never commit).
4. Get API keys: LLM, speech-to-text (Indian languages), background removal.
5. Start Meta Business verification and WhatsApp number setup on day 1; it can take days.
