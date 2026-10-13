# Stage 7: QA map (global version)

Maps the Stage 6 PRD back to every in-scope user story (US-1 to US-9) and constraint. The pipeline is done when every row reads Covered.

## User stories

| Story | Requirement | Covered in PRD | Status | Action |
|---|---|---|---|---|
| US-1 | Know what to post each day | Req 7 (weekly plan of 3-5 posts with occasions), Req 8 | Covered | Weekly, not daily, by design: weekly is the most common sustainable SMB rhythm (Stage 3, SOL-1) |
| US-2 | Content tied to a goal like leads or footfall | Req 2 (goal at setup), Req 7, Req 8 (call to action matched to goal) | Covered | None |
| US-3 | Create posts without skills or extra time | Req 7-10 (posts and images generated), Req 14 (approve from email), Req 17 (one-tap share); Goal: review in under 5 minutes | Covered | None |
| US-4 | Posts look consistent | Req 5 (colours, logo), Req 9 (branded templates), Req 13 (voice checks) | Covered | None |
| US-5 | Content in the language and tone customers use | Req 2 (tone, post language), Req 5 (voice from past posts), Req 15 (feedback saved) | Covered | None |
| US-6 | Post regularly across social channels, messaging status and Google Business Profile | Req 7 (weekly), Req 10 (formats incl. messaging status), Req 17 (share to social and status), Req 18 (mark posted), Req 25 (posting reminder); Edge case: missed emails | Covered | Fixed in Stage 7 |
| US-7 | Google Business Profile and reviews kept up to date and answered | Req 8, 10 (GBP post text and format), Req 26 (stretch: review replies by copy-paste). Profile updates via API are Future (Section 5) | Covered | Fixed in Stage 7; API part deliberately deferred |
| US-8 | See whether posts bring enquiries or sales | Req 19 (short links), Req 20 (check-in), Req 21 (summary with "not measured" line) | Covered | Limits stated honestly by design (Stage 5) |
| US-9 | Clear, visible results for what I spend | Req 2 (minutes per post), Req 21 (month-over-month posts, clicks, enquiries, time saved). Pilot is free; billing is future | Covered | Fixed in Stage 7 |

## Constraints

| ID | Constraint | Covered in PRD | Status |
|---|---|---|---|
| C-1 | AI-led, demoable MVP for the hackathon track | Goal (demo under 3 minutes), Acceptance "Demo" row, Section 10 | Covered |
| C-2 | Persona scope (narrowed to SMB owner at Stage 4) | Section 5 (other personas out) | Covered |
| C-3 | Global, not India-focused | Req 2 (country, region), Req 7 (holidays by country), timezone Cron | Covered |
| C-4 | Builder is a PM with AI coding agents; 2-4 weeks | Section 10 with a 2-week fallback | Covered |
| C-5 | Pains are unvalidated hypotheses | Goal table (pilot with 3-5 owners, blind test) | Covered |
| C-6 | Separate from PostMitra | Section 5 (WhatsApp out), Section 9 (separate Vercel and Supabase projects) | Covered |

## Fixes applied (2026-10-13)

| Gap | Fix applied in PRD |
|---|---|
| US-6 (a) | Req 10 and Req 17 now name messaging status (WhatsApp, Messenger) as a format and share target |
| US-6 (b) | New Req 25: one reminder if approved posts aren't marked Posted within 3 days |
| US-7 | New stretch Req 26: review replies in the owner's voice, copy-paste, no API |
| US-9 | Req 2 asks minutes per post; Req 21 adds month-over-month posts and estimated time saved |

## Result

Every story and constraint reads Covered. The PRD ([6-prd.md](6-prd-v2.md)) is final.
