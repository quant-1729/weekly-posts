# Stage 4: Prioritization

## Context used

The delivery context was not provided, so these are **working assumptions**. Correct any that are wrong and the ranking may change.

| Item | Assumption |
|---|---|
| Deadline | Hackathon build window of roughly 2-4 weeks |
| Team | You (PM) plus 1-2 builders, or you with AI coding tools |
| Stack | Next.js on Vercel + Supabase (both already connected here) + an LLM API |
| After hackathon | Possible FigitalLabs product if it gets traction |
| Judging | AI-led, demoable, India-relevant, clear user impact (track brief) |
| Impact profile | All options roll out gradually (opt-in users); none forces a sudden change |

## Shortlist

| ID | Candidate | Type | Built from |
|---|---|---|---|
| A | Brand-memory content studio (web app): brand set up once; one input becomes channel- and language-ready posts; one-link approval | Software feature | SOL-9, 10, 7, 13 + Stage 2 core |
| B | WhatsApp-first vernacular content assistant for SMBs: owner sends a photo or offer on WhatsApp, gets ready posts and status creatives in their language, approves in chat | Software feature | Stage 2 core + SOL-4, 7, 22 |
| C | Agency multi-brand workspace: brand memory per client, bulk repurposing, no-login client approval links | Software feature | SOL-9, 10, 13, 15 |
| D | n8n content pipeline: sheet row -> LLM caption -> review form -> auto-post | Automation or no-code workflow | SOL-12 |
| E | SMB content playbook: batching day, customer-FAQ post list, Canva templates, WhatsApp approval group | Process change | SOL-1, 2, 5, 22 |
| F | Vernacular D2C listing and ad-variant generator | Software feature | SOL-17, 18 |

## Analysis

| | A. Brand studio (web) | B. WhatsApp SMB assistant | C. Agency workspace | D. n8n pipeline | E. Process playbook | F. D2C vernacular generator |
|---|---|---|---|---|---|---|
| Delivery fit | Good: standard web app on assumed stack; 2-3 weeks | Medium: same engine + WhatsApp Business API setup and approval (can take days); web fallback possible | Good: web app; multi-tenant adds effort | Very fast: days; template exists | Fastest: a document and templates | Good: narrow generator |
| Owner / ops load | Low | Low-medium: WhatsApp number, message costs | Low | Medium: fragile; someone maintains it | High: depends on SMB discipline | Low |
| Product-sense fit | Strong but looks like many tools | Strongest: meets SMBs where they already are; clear India story | Strong for power users | Weak: plumbing, not a product | Weak: not AI-led; fails track | Medium: crowded (Koro, Adad) |
| Business fit | Broad; unclear first buyer | Huge SMB base; low price per user; distribution via WhatsApp | Clear willingness to pay; small market per seat | No business | No business | Paying segment; strong competitors |
| Stories covered (of 39) | ~24 | ~20 (SMB + shared engine) | ~22 (agency + marketer) | ~8 | ~6 | ~9 |
| Gap it fills (Stage 3) | Brand memory + vernacular + approval in one place | Same, plus no tool targets SMBs on WhatsApp in their language | Repurposr and Planable partly cover it | Already a free template | Free advice exists | Partly served |
| Impact | Gradual | Gradual | Gradual | Gradual | Gradual | Gradual |
| Pros | Flexible; serves all personas | Lowest-friction for SMBs; memorable demo; real gap | Paying users sooner; rich feedback | Proves the flow cheaply | Zero build | Clear ROI story |
| Cons | Hard to stand out; no focused user | WhatsApp API setup risk; SMBs pay little | Less social impact; competes with Planable | Not hackathon-worthy alone | Not AI; doesn't scale | Crowded; D2C only |

## Recommendation: B, built on A's engine

Build the **WhatsApp-first vernacular content assistant for SMB owners**, with the brand-memory engine (A) underneath and a simple web view for setup and the approval link.

**Why, in terms of our context:**
1. **It hits the clearest gap from Stage 3.** No product combines brand memory, Indian-language output and WhatsApp-native approval for SMBs.
2. **It fits a hackathon.** It is AI-led, India-specific and easy to demo live: send a photo on WhatsApp and get Hindi posts back.
3. **It is buildable on the assumed stack.** The engine is a web app on Next.js + Supabase. WhatsApp sits on top. If WhatsApp API approval is slow, the same flow works as a web app with "share to WhatsApp".
4. **It keeps the future open.** The agency workspace (C) is the next wrapper on the same engine, which gives a path to paying users after the hackathon.
5. **The non-software fixes (D, E) don't meet the track.** Their best ideas go into the product instead: weekly batching becomes the weekly plan, the FAQ list becomes post ideas, and the WhatsApp group becomes the approval channel.

**Main risks to test in Stage 5:** whether SMB owners pay or keep using it; quality of Hindi and regional output; WhatsApp API setup time and messaging cost.

**Strong alternative:** pick **C (agency workspace)** if paying users soon matter more than social impact and demo appeal.

## Decision needed

Which one do we carry into Stage 5 (the challenge layer): **B** (recommended), **C**, **A**, or another?
