# Plan: Trend Research and Brand Face (APPROVED by the owner, 2026-10-15)

Two new features the owner asked for. Nothing here is built yet; section 4 lists the decisions needed first. Estimates are builder-days. Prices are approximate and get re-checked before each piece is built.

---

## 1. Trend Research ("Ideas")

### What the owner gets
- An **Ideas** page with a few **trend cards** each week. Each card has:
  - what is trending, and why it matters for this business;
  - links to the sources it came from, and how fresh and how sure it is;
  - 2-3 post ideas for it.
- **"Make this post"** on an idea opens Create a post with the description already written. The owner edits it and carries on as usual.
- A **Growth report** on the Results page:
  - which topics, post types, themes, channels and posting times got the most reach;
  - how the posts made from trends did;
  - what to try next.
- The weekly run fills the **Queue** with suggested posts made from the best ideas (the open item "weekly suggestions filling the queue", C-24). They still need the owner's approval, as today.

### Where the research comes from

| Source | How | Cost | v1? |
|---|---|---|---|
| The open web (news, blogs, forums, and Reddit and X pages that Google has indexed) | Gemini on Vertex AI with **Google Search grounding**: it searches and returns the source links it used | about $0.035 per grounded request | Yes |
| Competitors' websites | The owner lists up to 5 competitors. We read their public pages with our existing website reader, which respects robots.txt | Gemini reading tokens, a few cents | Yes |
| Competitors' Instagram | The **Instagram Business Discovery API**: the recent posts of public business accounts, with like and comment counts | Free; needs the Facebook-login path and a Meta App Review addition | Yes, after review |
| YouTube | YouTube Data API search for the category and country | Free quota | Yes |
| Reddit | Official Reddit Data API. Commercial use needs Reddit's agreement and may be paid | Unknown until we apply | Later; v1 sees Reddit through Google search |
| X (Twitter) | X API Basic tier | about $200 a month for a small read allowance | Later, only if worth it |
| Instagram hashtags | `ig_hashtag_search` (30 hashtags per 7 days per account) | Free; needs App Review | Later |
| Google Trends | Official API, still in limited alpha | Free if accepted | Apply now; use when granted |

### How a research run works
1. **Plan the searches** from the brand profile: category, city and country, language, products and competitors. This gives about 6-10 searches. Health, finance and legal brands get filtered searches (no treatments, cures or returns).
2. **Gather**: grounded searches, competitor pages, competitor Instagram and YouTube, all in parallel with time limits.
3. **Make the trend cards**: Gemini groups what it found into 3-5 trends. Each trend has its sources, a date and a confidence level, and nothing goes on a card without a source link.
4. **Write the ideas**: for each trend, 2-3 ideas, each with a post type and a ready-to-edit description.
5. **Check**: the existing guardrail runs on every idea, plus the rules in "Safety rules" below.

The run happens once a week per brand through Cloud Scheduler, plus a **"Research now"** button limited to 2 a week. Each run's cost is recorded and shown on the admin dashboard.

### Safety rules (they follow CLAUDE.md)
- **Research is never a fact about the brand.** Idea descriptions may not contain prices, numbers, statistics, ratings or claims. Code removes them, and they are flagged "from research, please check".
  - This matters because a description becomes an owner fact once it is saved.
  - The owner adds their own real offer.
- **Sources are kept as a link, a title, a site and a date**, with our own short summary. We store no copied posts or comments.
- **No personal data.** We don't store Reddit or X usernames or profiles of private individuals, and we don't build profiles of people. Competitors are businesses the owner named.
- **No copying competitors.** An idea can say "competitors are pushing weekend bundles". It can never reuse their wording or images.
- **Regulated brands**: no health, finance or legal trends that would lead to a promise of results.

### Analytics loop ("what helps the brand grow")
- **Own results:**
  - We have QR scans and link clicks today (C-29).
  - We add each published post's **reach, impressions, likes, comments, saves, shares and video views** from the Instagram and Facebook Insights APIs. This needs `instagram_business_manage_insights` for Instagram and `read_insights` for Facebook in Meta App Review, so we add both to the submission.
  - Insights are fetched at 24 hours, 72 hours and 7 days after a post goes out.
- **Benchmarks:** BigQuery (C-30) holds anonymised results by category and country, so the report can say "posts like this in your category usually get…". It shows nothing from another brand by name.
- **Weekly Growth report:**
  - Gemini Flash turns the numbers into 3-5 plain suggestions, using only the numbers it is given and no new statistics.
  - It costs about $0.01 a week per brand.
  - The suggestions also steer next week's research and queue suggestions, for example more of the topics that worked and better posting times.

### Database changes (orchestrator-owned migrations, row-level security on each)
- `competitors`: brand_id, name, website, instagram_handle, youtube_handle.
- `research_runs`: brand_id, started_at, finished_at, status, cost_usd, sources_count, error.
- `trend_cards`: brand_id, run_id, title, summary, why_it_matters, sources jsonb (`[{url, title, site, published_at}]`), confidence, expires_at, status (new, used, dismissed).
- `post_ideas`: trend_card_id, brand_id, post_type, description, flags, status, brief_id once used.
- `post_metrics`: publication_id, brand_id, fetched_at, reach, impressions, likes, comments, saves, shares, views.

### Cost per brand
- **Weekly research run:** about 8 grounded searches ($0.28) plus Gemini Flash for reading and writing ($0.03-0.05). That is about **$0.33**, under the $0.50 approval limit.
- **Growth report:** about $0.01.
- **Caps:** a new weekly research cap per brand, and the existing weekly cap still applies.

### Tasks

| ID | Task | Days |
|---|---|---|
| R-1 | Schema plus the competitors card on the Brand page | 1 |
| R-2 | Search planner and grounded search through Vertex AI, with cost recorded and caps | 2 |
| R-3 | Competitor reading: websites through the existing reader; Instagram Business Discovery behind a switch until App Review | 2 |
| R-4 | YouTube search source | 0.5 |
| R-5 | Trend cards and ideas: prompts (orchestrator), validator, numbers and claims removed, guardrail | 2 |
| R-6 | Ideas page (desktop and 375 px) and "Make this post" into Create a post | 1.5 |
| R-7 | Weekly run on Cloud Scheduler, "Research now", ideas into the Queue as suggestions | 1.5 |
| R-8 | Insights fetch (Instagram and Facebook) into `post_metrics`; Meta App Review texts | 2 |
| R-9 | Growth report on the Results page; BigQuery benchmarks (with C-30) | 2 |
| R-10 | Admin dashboard: research runs, cost and failures | 0.5 |

**Total: about 15 days.** It can ship in two parts: R-1 to R-7 is Ideas, about 10 days, and R-8 to R-10 is Growth, about 5 days.

---

## 2. Brand Face (ambassador; the mascot becomes one kind of it)

### The idea
A brand chooses one **Brand Face**: a consistent character who appears in its posts. The face can be one of these kinds:

| Kind | What it is | How it's made | Risk |
|---|---|---|---|
| **Mascot** | Tween in the brand's colours (today's feature) | Code-drawn rig, no AI | Low |
| **Illustrated character** | A drawn person or figure (flat, 3D-cartoon or line-art style) in the brand's colours | Generated once by AI from the owner's description, then a fixed set of poses | Low to medium |
| **Owner as the face** | The owner themselves | The owner's own photos with the background removed, so no AI faces. Optionally a stylised illustrated version of the owner, with their consent | Medium; consent needed |
| **Realistic AI person** | A photorealistic person who does not exist | Generated once by AI, then a fixed pose set | **High**: it can mislead customers |

- Tween stays the **in-app guide** for everyone. Only the face in posts changes.
- For a healthcare brand, the mascot stays off as today. An illustrated character or the owner as the face would be offered instead.

### How it works
1. **Brand page, Face card.** The owner picks a kind and describes the character: style, rough age, clothing in brand colours, mood and a name. A drawn character is offered 4 options; the owner keeps one or asks again.
2. **Pose set.** From the chosen look we make 6-8 poses once: wave, point, present, think, celebrate, talk and idle, the same poses as Tween. This uses Imagen or Gemini image generation with the chosen image as the reference, so the face stays consistent. Each pose gets its background removed and is checked by:
   - Gemini vision: same character, no text in the image, no logos, no products or premises, nothing that implies credentials;
   - the owner, who approves each pose.
3. **In posts.** The design engine places the face like the mascot today:
   - the copy prompt picks a pose and writes a short speech-bubble line;
   - text, logo and QR are still drawn by code;
   - **no AI image work happens per post, so each post costs nothing extra.**
4. **Settings:** face on or off, which post types it appears on, preferred side and size, and phrases it must never say.
5. **Later (stretch, with C-21 and C-35):** a short talking clip of the face. This would use Veo with the face as the reference, plus a Text-to-Speech voice, and would always ask for approval because it costs more than $0.50 a clip.

### Safety rules (new, need the owner's OK)
- **No real people other than the consenting owner.**
  - "Owner as the face" needs a consent tick plus an email confirmation, the same way payment IDs work.
  - There is no "make it look like a celebrity" or "use this photo of someone else".
  - Requests that name a real person are refused.
- **A realistic AI person always shows a small "AI avatar" tag, drawn by code**, on every post. We also set Meta's "AI-generated" label when publishing. It is never presented as a real customer, patient, employee or reviewer, and never used in testimonial posts.
- **Health, finance and legal brands:**
  - the face may not wear anything implying credentials (white coat, stethoscope, scrubs, a judge's or banker's look);
  - it never gives advice or promises results in its bubble;
  - no before-and-after images;
  - the guardrail checks the bubble lines, and Gemini vision checks the poses for credential cues.
- The face never holds, shows or stands in the brand's products or premises; those come only from the owner's photos.
- The existing rule that the AI never writes text inside images still holds.

### What this changes in the current rules
- CLAUDE.md says AI images may only be abstract backgrounds and must never show people. This would add one exception: an owner-approved Brand Face pose set, made once and reused.
- The 2026-10-13 decision said Tween is the only mascot. Tween stays the only *mascot*; the other faces are a separate kind.

### Database changes (row-level security on each)
- `brand_faces`: id, brand_id, kind (mascot, illustrated, owner_photo, photoreal), name, description, style, status (draft, approved, retired), consent jsonb (`{user_id, at, text_version, email_confirmed_at}`), created_cost_usd.
- `brand_face_poses`: face_id, pose, storage_path, width, height, check jsonb, approved_at.
- The brand profile's `mascot_in_posts` becomes `face_in_posts`, plus an `active_face_id`. Today's mascot brands are moved over to a Mascot face automatically.

### Cost
- **Making an illustrated or realistic face:**
  - About 22 images on Gemini 3.1 Flash Image: 4 options, a character sheet, then 8 poses made 2 at a time.
  - That is **about $1.50 once**, so the owner sees the price and approves first, as the $0.50 rule requires.
  - Imagen 3 subject customization is discontinued; see `docs/12-research-repos-and-proposal.md`.
- **Owner as the face from their own photos:** about $0.02 for the background removal and checks.
- **Per post:** $0, because poses are reused.
- **Talking clip (later):** priced per second, always asks first.

### Tasks

| ID | Task | Days |
|---|---|---|
| F-1 | Schema, migration from `mascot_in_posts`, and shared types (orchestrator) | 1 |
| F-2 | Design engine: generalise the mascot layer into a face layer (Tween's SVG rig or pose images) for every format, with speech-bubble placement | 2 |
| F-3 | Copy prompt: a FACE block with name, persona and poses; the regulated-brand rules (orchestrator) | 0.5 |
| F-4 | Brand page Face card: pick a kind, describe it, the 4 options with the price shown first, approve | 2 |
| F-5 | Pose set: generation with a reference image, background removal, Gemini vision checks, owner approves each pose | 2.5 |
| F-6 | Owner as the face: photo upload, consent tick plus email confirmation, background removal, pose tagging | 1.5 |
| F-7 | Realistic AI person: the "AI avatar" tag drawn by code, Meta AI label on publish, testimonial-post block | 1 |
| F-8 | Guardrail: bubble lines for regulated brands, credential cues, refusing named people | 1 |
| F-9 | Terms and privacy update (AI faces, the owner's likeness) for the lawyer review (with C-38) | 0.5 |
| F-10 | Tests, admin dashboard counts and cost | 1 |

**Total: about 13 days.** The talking-clip stretch is about 4 more days and comes after C-21 and C-35.

---

## 3. Suggested order
1. **Ideas, R-1 to R-7 (about 2 weeks).** It works without new Meta permissions. While it is built, submit the extra Meta permissions (insights and Business Discovery) and apply for the Google Trends API.
2. **Brand Face, F-1 to F-6 and F-8 to F-10 (about 2 weeks):** Mascot, Illustrated and Owner as the face.
3. **Growth, R-8 to R-10 (about 1 week)**, once the Meta insights permission is approved.
4. **Realistic AI person (F-7) and talking clips**, only if the owner still wants them after seeing the drawn faces.

## 4. Decisions needed from the owner
1. **Face kinds in the first version:** recommended Mascot, Illustrated and Owner as the face, with the realistic AI person later. Or all four now?
2. **Rule change:** is it OK to amend the image rule as described in section 2?
3. **Research sources in v1:** recommended Google-grounded search, competitor sites, Instagram Business Discovery and YouTube, with the Reddit API and the X API (about $200 a month) left for later. Agree?
4. **Budget:** is about $0.33 per brand per week for research OK, and what weekly cap per brand?
5. **Meta App Review:** may I draft the extra permission texts (insights, Business Discovery) to add to the submission? Nothing is submitted without your OK.
6. **Order:** Ideas first, as in section 3, or Brand Face first?


## 5. Owner decisions (2026-10-15)
All approved as proposed:
1. All four face kinds go in now: mascot, illustrated, owner as the face, and realistic AI person, with the rules in section 2.
2. The image rule is amended (CLAUDE.md).
3. Research sources for v1 are as listed in section 1.
4. Budget: about $0.33 per brand per week, with a weekly research cap of $0.50 per brand.
5. Meta App Review texts: drafts only; nothing is submitted without the owner.
6. Order: Ideas first, then Brand Face, built side by side where the files don't overlap.

Schema: `supabase/migrations/0021_ideas_and_faces.sql`.
