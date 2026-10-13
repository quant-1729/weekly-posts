# Stage 7: QA map

Every Stage 1 user story mapped to the PRD ([6-prd.md](6-prd.md)).

**Status key:**
- **Covered:** the PRD meets it.
- **Out of scope (accepted):** left out on purpose because Stage 4 chose the SMB persona.

## Summary

| Status | Count |
|---|---|
| Covered | 21 |
| Out of scope (accepted) | 19 |
| Total | 40 |

## Map

| Story | Requirement (brief) | Covered in spec | Status | Action |
|---|---|---|---|---|
| US-1 | SMB: know what to post | R3 weekly plan | Covered | |
| US-2 | SMB: content tied to a goal | R3 (owner's goal) | Covered | |
| US-3 | SMB: create without skill or time | R2, R4, R6 | Covered | |
| US-4 | SMB: consistent look | R6, R7, R15 | Covered | |
| US-5 | SMB: local language | R5 | Covered | |
| US-6 | SMB: post regularly across channels | R3, R4, R12 (manual posting) | Covered | F1 applied to R3 |
| US-7 | SMB: Google profile and reviews | R4 gives GBP update text only | Out of scope (accepted) | Review replies out of scope |
| US-8 | SMB: see if posts bring enquiries | R11 | Covered | |
| US-9 | SMB: visible results for spend | R11 weekly summary | Covered | |
| US-10 | Marketer: volume with small team | R4 engine; no marketer workflow | Out of scope (accepted) | Marketer persona not in MVP |
| US-11 | Marketer: planning and approvals in one place | R10 approvals only; no team calendar | Out of scope (accepted) | Team calendar later |
| US-12 | Marketer: one brand voice and look | R2, R6 | Covered | |
| US-13 | Marketer: one asset into many | R4 | Covered | |
| US-14 | Marketer: on-brand, accurate AI output | R2, R8, R9 | Covered | |
| US-15 | Marketer: one message adapted per channel | R4 | Covered | |
| US-16 | Marketer: regional campaign versions | R5 (Hindi, Hinglish, English only) | Out of scope (accepted) | Decide: add one regional language as stretch? |
| US-17 | Marketer: reporting across channels | R11 clicks only | Out of scope (accepted) | Channel analytics later |
| US-18 | Marketer: prove ROI | R11 click signal | Covered | Basic level only |
| US-19 | Marketer: fewer overlapping tools | Not addressed | Out of scope (accepted) | Not a product feature |
| US-20 | Agency: clear client briefs | Not addressed | Out of scope (accepted) | Agency wrapper later |
| US-21 | Agency: client contexts kept separate | R14 data model; no UI | Out of scope (accepted) | Agency wrapper later |
| US-22 | Agency: fewer revision rounds, one place | R10 comments per post | Covered | |
| US-23 | Agency: more output, same headcount | R4 | Covered | |
| US-24 | Agency: formatting per platform | R4 | Covered | |
| US-25 | Agency: sign-off without chasing | R10 (no nudge) | Covered | F2 applied to R10 |
| US-26 | Agency: reports without copying | R11 summary (in-app only) | Covered | F3 applied to R11 |
| US-27 | Agency: show clients value | R11 summary (in-app only) | Covered | F3 applied to R11 |
| US-28 | Agency: control and bill extra changes | Not addressed | Out of scope (accepted) | Out of scope |
| US-29 | Agency: position against "AI can do this" | Not addressed | Out of scope (accepted) | Not a product feature |
| US-30 | D2C: content for large catalogue | No bulk mode | Out of scope (accepted) | D2C persona not in MVP |
| US-31 | D2C: accurate product descriptions | Not addressed | Out of scope (accepted) | D2C persona not in MVP |
| US-32 | D2C: fresh ad variants | R4 regenerate only | Out of scope (accepted) | Ad testing later |
| US-33 | D2C: UGC and rights | Out of scope | Out of scope (accepted) | Out of scope |
| US-34 | D2C: visuals without shoots | R7 clean-up only | Out of scope (accepted) | Out of scope |
| US-35 | D2C: marketplace formats | R4 covers social only | Out of scope (accepted) | Marketplace formats later |
| US-36 | D2C: vernacular listings and ads | R5 for social only | Out of scope (accepted) | Later |
| US-37 | D2C: attribution to ROAS/CAC | Out of scope | Out of scope (accepted) | Out of scope |
| US-38 | D2C: fast creative insights | R11 top post only | Out of scope (accepted) | Later |
| US-39 | D2C: volume without losing brand | R2, R6 | Covered | |
| US-40 | SMB: brand mascot | R15 | Covered | |

## Fixes applied

| Fix | Change to PRD | Stories |
|---|---|---|
| F1 | R3: each plan idea gets a suggested posting day; opt-in WhatsApp reminder on that day (approved template). | US-6 |
| F2 | R10: "Nudge" button resends the approval link to the approver via WhatsApp share. | US-25 |
| F3 | R11: weekly summary can be shared as an image or a no-login link. | US-26, US-27 |

All three are small and fit in week 2-3 of the build order.

## Status

Pipeline closed. F1-F3 are applied to the PRD. The 19 out-of-scope stories are listed in PRD section 5 as the backlog for the agency and D2C wrappers. Regional languages (US-16) stay future, a stretch only after R1-R15.
