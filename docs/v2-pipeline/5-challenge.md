# Stage 5: Challenge layer (global version)

Decision gate. The user confirms the solution passes, or sends it back to Stage 4.

## Solution under challenge

**A: Brand-memory content assistant** (Software feature). For SMB owners, globally. Brand memory built from the owner's website and social profile; weekly plan; ready posts with image and caption; one-link approval; trackable link per post with a "what worked" summary. Stack: Next.js + Supabase + Vercel + LLM. Build window: 2-4 weeks.

## Why this kind of solution exists

Tools like Predis, Ocoya, ContentStudio and Canva's Magic Write were built on these assumptions:

| Their assumption | What it encodes | What reviews show |
|---|---|---|
| Generating content is the bottleneck | A dashboard where the owner asks for posts | Output still needs "significant" edits; the bottleneck moved to voice and trust |
| The owner returns to the tool every week | Retention depends on the owner remembering | SMB owners stop after 2-3 weeks (Stage 1, US-6 source) |
| Auto-posting through platform APIs is expected | Scheduler built in | Failed and half-published posts, token errors, missing platforms |
| A short voice guideline is enough | Brand voice as a text box (Canva caps it at 500 characters) | "Never really seemed to work"; repetitive copy |

## New cases surfaced

1. **The return problem.** A web dashboard needs the owner to come back. The persona's core habit is to stop. The weekly loop has to come to the owner (email), not wait for them.
2. **Thin or missing web presence.** Many SMBs have no website, or only an Instagram page. Auto-built brand memory then has nothing to read.
3. **Social profiles can't be scraped.** Instagram and Facebook block scraping and forbid it in their terms. Only the website (and what the owner pastes or uploads) is safe to read.
4. **Fake images break trust.** An AI picture of "your bakery" or "your dish" that isn't real misleads customers. Local businesses sell real things.
5. **Invented facts.** The AI may invent prices, offers, opening hours or claims (for example, health claims for a clinic). That is a legal and trust risk.
6. **"What worked" can mislead.** Instagram captions don't allow clickable links, and most SMB enquiries arrive by DM, phone or walk-in. Click counts will undercount, and a confident summary built on them would be wrong.
7. **Who approves?** For a solo owner, "approval" is the owner reviewing their own posts. A separate approver flow is only needed when staff or a freelancer drafts, which is out of scope.
8. **Global occasions.** Holidays and local moments differ by country and region. A single calendar won't work.
9. **Regulated categories.** Clinics, finance, alcohol and similar businesses face advertising rules.
10. **Cost per user.** LLM and image costs must fit an SMB price of roughly $10-30 per month.

## Challenge

| Weak point | Discarded option that handles it better | Change to A |
|---|---|---|
| Owner doesn't return (cases 1, 7) | **PostMitra** (WhatsApp push, a different channel); **D** (weekly batching ritual) | Make the core loop a **weekly email**: "Your 5 posts for next week are ready." Approve, edit or skip from the email or one no-login link. The dashboard is secondary |
| Thin web presence (cases 2, 3) | **B** (a human would just ask) | Fallback **5-question setup** plus upload of 3-5 past posts or photos. Website reading is optional. No social scraping |
| Fake images (case 4) | **D** (owner uses their own photos) | **Owner's photos first**, placed in branded templates with text overlays. AI-generated images only for generic backgrounds, never as the product itself |
| Invented facts (cases 5, 9) | **B** (a human checks) | **Fact guardrail**: posts may only use facts stored in brand memory. New claims are flagged for the owner. Regulated categories get a stricter prompt and a reminder |
| Misleading results (case 6) | **SOL-24** (plain UTM practice is honest about its limits) | Short link where clicks are possible, plus a **one-tap weekly check-in**: "Did you get enquiries from posts this week?" The summary states what is measured and what isn't |
| Voice not better than rivals | **B** (human tuning on real businesses) | Ground voice in **real examples** (the owner's past posts, website copy, reviews). Save edit feedback ("less salesy") to memory. Test blind against a generic tool with 3-5 owners during the build |
| Publishing fails (Stage 3 reviews) | **D** (manual posting is reliable) | **No auto-posting in the MVP.** One-tap share on mobile and download, so nothing silently fails. Buffer or Meta API is future scope |
| Global occasions (case 8) | None | Owner picks country and region at setup; posts use a public holiday dataset plus owner-added dates |
| Cost (case 10) | **C** (cheap) | Generate a week's batch in one call, limit image generation, cache brand memory |

## Stage 2 assumptions, re-checked

| # | Assumption | Status after challenge |
|---|---|---|
| 1 | Time cost is context and reformatting, not ideas | Holds for SMBs, plus a new one: remembering to come back |
| 2 | Brand memory makes output on-brand | Unproven. Needs real examples and a blind test |
| 3 | Localisation good enough | Lower priority for global English-first; keep as a setting |
| 4 | Approvers act on a no-login link | Holds; the approver is the owner, via email |
| 5 | Trackable link is a credible ROI signal | Weak. Add the check-in and be honest about limits |
| 6 | One engine, many wrappers | Moot; one persona now |
| 7 | Owner spends 10-15 minutes on setup | Reduced by website reading plus a 5-question fallback |
| 8 | No auto-posting needed at first | Holds, and avoids the top failure in reviews |

## Verdict: passes, with changes

A survives. No discarded option beats it overall. But it borrows from four of them:
- the weekly push from PostMitra and D;
- photo-first, fact-checked output from B and D;
- honest measurement from SOL-24;
- reliable manual posting from D.

The product shifts from "a content dashboard" to **"a weekly content email that a small business owner approves in two minutes."**

Confirm it passes, or send it back to Stage 4.
