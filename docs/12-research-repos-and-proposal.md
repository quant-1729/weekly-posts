# Research: open-source references and proposal (2026-10-15)

Background for `docs/10-plan-research-and-brand-face.md`. All repos were checked on GitHub on 2026-10-15. **We borrow patterns, not code**, unless the licence is permissive and the code fits the stack.

## A. Trend research / post ideas

| Repo | Licence | What we take from it |
|---|---|---|
| [google-gemini/gemini-fullstack-langgraph-quickstart](https://github.com/google-gemini/gemini-fullstack-langgraph-quickstart) | Apache-2.0 | **Our base pattern.** Gemini with Google Search grounding: generate queries, search, ask "what's missing?" and search again (at most 2 loops), then write with citations. Same stack as ours. |
| [mvanhorn/last30days-skill](https://github.com/mvanhorn/last30days-skill) | MIT | The method, not the scrapers: pick the targets first (handles, subreddits, keywords), merge the same story across sources into one card, rank by recency, engagement and relevance, keep a 30-day window, write a cited brief. Its Reddit, X and Instagram scraping breaks platform terms, so we don't use it. |
| [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher) | Apache-2.0 | A reviewer and reviser step: a critic rejects any card without a dated source. |
| [langchain-ai/social-media-agent](https://github.com/langchain-ai/social-media-agent) | MIT | A business-context gate (is this trend relevant to this brand?), post rules plus few-shot examples, and human approval before scheduling. |
| [mvanhorn/printing-press-library](https://github.com/mvanhorn/printing-press-library) (Instagram) | per-folder licence | The official Graph API approach: `business_discovery` competitor snapshots compared over time, best posting time and best format from the brand's own insights. |
| [liyedanpdx/reddit-ai-trends](https://github.com/liyedanpdx/reddit-ai-trends) | MIT | The official Reddit API, plus comparing with last week's stored snapshot to find what is new or rising. |
| [ericciarla/trendFinder](https://github.com/ericciarla/trendFinder) | MIT (stale) | Competitor-site monitoring and alerts. |
| crewAI-examples `instagram_post` | none (archived) | Prompt ideas only: product analysis, competitor analysis, campaign ideas, copy. |

**Commercial products to compare with:** Predis.ai (themes of competitors' Instagram posts and how well they do), Hootsuite OwlyGPT (ideas from social listening), Exploding Topics (labels trends "rising" or "peaked").

**Lessons learned by those projects:**
- The date window must be set in code, never by the LLM; models drift towards stale data.
- Drop any source without a date.
- "Velocity" (how fast a trend is rising) must come from our own weekly snapshots, not from the model's guesses.
- Use official APIs only.
- Cache results per brand per week.
- The X free tier is useless for this; Google Trends via pytrends is unofficial and breaks.

## B. Brand Face (consistent character)

**Managed on Vertex AI is the way to go; we would host no GPUs.**

**Models:**
- Imagen 3 subject customization is **discontinued**. Gemini 2.5 Flash Image retires on 2027-03-15.
- Build on **Gemini 3.1 Flash Image**: about $0.067 per 1K image, several reference images per call, and C2PA content credentials.
- Use **Gemini 3 Pro Image** (about $0.134 per image, up to 14 references) only if quality needs it.

**Self-hosted (CPU only):** [danielgatis/rembg](https://github.com/danielgatis/rembg) (MIT) with the [BiRefNet](https://github.com/ZhengPeng7/BiRefNet) model (MIT), for transparent cut-outs. It runs on Cloud Run without a GPU.

**Ruled out by licence (non-commercial):**
- InstantID, InfiniteYou, ConsiStory, BRIA RMBG-2.0 (also rembg's `bria-rmbg` option);
- anything that needs FLUX.1-dev or InsightFace face models;
- LivePortrait's animal mode.

**GPU-only, not now:** IP-Adapter, StoryDiffusion, OmniGen2, ControlNet, SadTalker, EchoMimic. Talking clips, if we do them later, use Veo.

**Pipeline for making a pose set:**
1. 4 master options; the owner picks one, which is then frozen with its version and prompt.
2. A character sheet showing front, three-quarter and side views; the owner approves it.
3. 8 poses, generated 2 at a time, with the master and the sheet as references, plus an optional stick-figure pose drawn from our SVG rig.
4. Gemini compares each pose with the master: palette, outfit, no text, no extra limbs.
5. rembg with BiRefNet produces the transparent PNG.
6. The pose set is stored with its provenance and reused at no cost.

**Cost:** about 22 images × $0.067 ≈ **$1.50 once per face**, so the owner approves the price first.

**Safety:**
- Keep the C2PA and SynthID metadata.
- Set Meta's "AI info" disclosure on realistic people.
- No realistic AI person for health, medical, pharmacy, weight-loss or finance brands.
- No face shown as a professional, in a testimonial or in a before-and-after; no minors; no real or famous people.
- The owner's own photo needs consent and must be their own face.

## C. Proposal

See the chat summary of 2026-10-15. The decisions are in `docs/10-plan-research-and-brand-face.md` §4.
