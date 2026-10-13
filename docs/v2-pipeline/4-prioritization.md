# Stage 4: Prioritization (global version)

Decision gate. The user picks the solution.

## Our context

| Item | Value |
|---|---|
| Persona | SMB owner / founder only (user decision, 2026-10-13). Global, not India-specific |
| Stories in scope | US-1 to US-9. The other 30 stories move out of scope for this version |
| Stack | Next.js on Vercel + Supabase + an LLM API (same as PostMitra) |
| Builder | Product manager at FigitalLabs, building with AI coding agents |
| Timeline | Not confirmed. Assumed: a hackathon window of 2-4 weeks |
| Judging | AI-led, demoable, clear user impact (track brief) |
| Impact profile | Every option rolls out gradually to opt-in users; none forces a sudden change |
| Overlap | PostMitra already targets SMB owners (WhatsApp, India, vernacular). This version must differ clearly, or the two compete with each other |

## Shortlist

| ID | Candidate | Type | Built from | Stories |
|---|---|---|---|---|
| A | Brand-memory content assistant (web app). Brand memory built automatically from the owner's website and social profile; weekly plan; ready posts with image and caption; one-link approval; trackable link per post with a plain-language "what worked" summary | Software feature | Stage 2 core; SOL-8, 11, 20, 24 | US-1, 2, 3, 4, 5, 6, 8, 9 |
| B | Concierge done-for-you service: you deliver weekly posts to 5-10 SMBs using AI tools by hand | Vendor/service (manual) | SOL-6, SOL-3 | US-1, 3, 4, 6, 9 |
| C | No-code autopilot template: Google Sheet + LLM + Buffer via Make/n8n, with a review column | Automation | SOL-7 | US-1, 3, 6 |
| D | Owner's content kit: weekly batching playbook, voice document template, calendar of occasions, UTM link guide | Process change | SOL-1, 2, 24 | US-1, 2, 4, 8 |
| E | Local presence agent: option A plus Google Business Profile posts and AI review replies | Software feature | A + SOL-26 | US-1 to US-9 (all) |

## Analysis

| | A: Content assistant | B: Concierge service | C: No-code template | D: Content kit | E: Local presence agent |
|---|---|---|---|---|---|
| Delivery fit | Good. Fits the stack; scope is controllable | No build. Needs your time every week | Low build. Fragile across third-party tools | Hours to make | Weak. Google Business Profile API needs Google approval, which can take weeks; review replies add risk |
| Effort | Medium | Low build, high ongoing time | Low | Very low | High |
| Product-sense fit | Strong. Owner wants it done; AI does it in their voice | Strong for the owner, but it is not a product | Weak. SMB owners won't run Make/n8n | Weak. Asks the owner for discipline they lack | Strong; most complete for local businesses |
| Business fit | Good. Path to SaaS; clear demo | Good for validation and early revenue; poor hackathon demo | Template sale at most | Lead magnet only | Strongest long-term, too big for now |
| Differentiation | Auto-built brand memory and outcome summary address the top complaints in reviews: generic copy and "is it working?" | Human touch | None | None | Combines content with reputation, which few cheap tools do |
| Impact | Gradual | Gradual | Gradual | Gradual | Gradual |
| Main con | Crowded space (Predis, Ocoya, Canva); must prove voice quality is better | Doesn't scale; no AI demo | Breaks; not for non-technical users | No AI; low impact | Scope and API-access risk inside a short window |
| Overlap with PostMitra | Different channel (web, email), market (global) and positioning. Clear enough if kept web-first | Low | Low | Low | Same as A |

## Recommendation: A, with E's review replies as a stretch goal

- It is the only option that is AI-led, demoable within the stack, and usable by a non-technical owner.
- It targets the two weaknesses that come up most in Stage 3 reviews: generic, off-voice output and no proof that posting works. Most cheap SMB tools don't solve either.
- Auto-building brand memory from the owner's site removes the 10-15 minute setup risk from Stage 2.
- Keep B alongside it as a validation tactic: run the MVP by hand for 5 SMB owners during the build, to check voice quality on real businesses.
- Avoid E for the MVP because of the Google Business Profile API approval risk. Review replies could be added later as copy-and-paste text, with no API needed.

## Decide

Pick one, or redirect:
1. **A**: brand-memory content assistant (recommended).
2. **A + B**: build A and run the concierge pilot alongside it to validate.
3. **E**: the full local presence agent, accepting the scope and API risk.
4. **Something else**: B, C, D, or a mix.

Also confirm: the real timeline, and whether this version and PostMitra are both being entered, or this one replaces it.
