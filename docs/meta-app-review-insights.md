# Meta App Review: texts for the insights and Business Discovery permissions (DRAFT)

**Status: draft. Nothing has been submitted.** The owner approves and submits. Written 2026-10-15 for task R-8, and checked against what the code does (`src/lib/insights/**`, `src/lib/ideas/competitor-instagram.ts`). If the code changes, change these texts before submitting; Meta rejects submissions that describe something the app does not do.

App name: Weekly Posts (working name; change here if the name changes). Use the exact name shown in the app.

## Before you submit

These are things only the owner can do or decide. Each is also a reason Meta might reject.

1. **The scopes are not requested at connect time yet.** `src/lib/connections/config.ts` asks for `instagram_business_basic` and `instagram_business_content_publish` (Instagram) and `pages_manage_posts`, `pages_read_engagement`, `pages_show_list` (Facebook). Insights need `instagram_business_manage_insights` added to `INSTAGRAM_SCOPES` and `read_insights` added to `FACEBOOK_SCOPES`. Add them only when the permissions are approved (or while the app is in Development mode, for testers). Until then the insights job skips these brands (it counts them as "insights permission missing"; `insightsPermission(brandId)` in `src/lib/insights/read.ts` tells the Results page, which R-9 builds, to show a "reconnect to see your results" note).
2. **Existing connections must be reconnected** once, to grant the new permissions. The saved list of scopes on a connection decides whether the job tries (`channel_connections.scopes`).
3. **Business verification** must be finished (see `docs/meta-setup.md`, step 8). Advanced Access needs it.
4. **Privacy policy and data-deletion URLs** are already set in the app dashboard (`/terms` and `/api/meta/data-deletion`). Check that the privacy text says insights are read and stored (see "What the privacy policy must say" below). Today `/terms` does not mention insights.
5. **Test accounts for the reviewer:** a business Instagram account, a Facebook Page linked to it, and a login to Weekly Posts with a published post at least 24 hours old (insights are read from 24 hours). Put the login in the "Notes for the reviewer" box.
6. **Facebook `post_impressions` metrics:** Meta has been retiring the impressions metrics on Pages. The code asks for `post_impressions_unique`, `post_impressions`, `post_reactions_by_type_total` and `post_media_view`, and skips any that Meta refuses. Check on a real Page which ones answer, and say only those in the final text (see "Needs a live check").

## What the app does with insights (one paragraph, reuse in every answer)

Weekly Posts helps a small business owner plan, design and publish social posts. After an owner has connected their own Instagram professional account or Facebook Page and we have published a post for them, the app reads that post's insights (reach, likes, comments, saves, shares, views, and for Facebook impressions) about 1 day, 3 days and 7 days after it went out, stores them against the owner's business, and shows the owner a plain results page and a weekly "what worked" report. The numbers are used for that owner's own business only.

---

## 1. `instagram_business_manage_insights` (Instagram API with Instagram Login)

**Use case text (paste into "How will your app use this permission?")**

> Our app publishes posts to the owner's own Instagram professional account after the owner approves each post (`instagram_business_content_publish`). We use `instagram_business_manage_insights` to read the insights of the posts we published, using `GET /{media-id}/insights` with the metrics that Instagram supports for that kind of post: reach, likes, comments, saved, shares and views for feed posts, carousels and reels, and reach, replies and views for stories. We read each post about 24 hours, 3 days and 7 days after it was published. We show the owner these numbers on a Results page next to the post, and we use them in a weekly summary that tells the owner which topics, post types, designs and posting times worked best for their business. We only read insights of posts that our app published for that owner. We do not read insights of other accounts, we do not read audience or follower demographics, and we do not combine one owner's numbers with another's.

**Why we need it (short):** Without it the owner cannot see how the posts we publish for them performed, so they cannot learn what works for their business.

**Why a lower permission is not enough:** `instagram_business_basic` gives profile and media fields but not insights.

**Data-use answers**

| Question | Answer |
|---|---|
| What data do you receive? | For posts we published: reach, likes, comments, saves, shares and views (story replies for stories). Counts only. No audience lists, no demographics, no comments text, no commenter identities. |
| How is it used? | Shown to the owner of the account on a Results page and summarised in a weekly report for that owner. |
| Is it shared with third parties? | No. A language model (Google Gemini on Vertex AI) receives only the counts, with post type, theme and posting hour, to write the plain-language summary. It does not receive account names or tokens. [CONFIRM when R-9 is built.] |
| Is it sold or used for advertising? | No. |
| How long is it kept? | While the owner's account exists. It is deleted when the owner deletes their account (cascade), or when they disconnect and ask for deletion; the data-deletion callback is `/api/meta/data-deletion`. The owner can download it in the account export (`insights.json`). |
| Where is it stored? | Our database (Supabase Postgres in Sydney) with row-level security: only members of that business can read it. Access tokens are stored encrypted (AES-256-GCM) and are never logged. |
| Aggregated or anonymised use? | [DECISION FOR THE OWNER] The plan (docs/10-plan-research-and-brand-face.md) mentions anonymised category benchmarks in BigQuery. If that ships, say so here and in the privacy policy: "Counts from many businesses are combined by category and country, with no names, so a business can compare itself with a typical result. A business never sees another business's own numbers." If it does not ship, delete this row. |

**Step-by-step screencast script (about 3 minutes, English narration or captions, screen recording at 1080p)**

1. Open Weekly Posts and sign in with the test login. Say: "This is a small business owner using Weekly Posts."
2. Go to **Connections**. Show Instagram as not connected (or disconnect it first). Click **Connect Instagram**.
3. On the Instagram permission screen, scroll so that **both the publishing and the insights permissions are readable**. Say: "The owner can see exactly what we ask for." Click **Allow**.
4. Back on **Connections**, show Instagram as connected with the account name.
5. Go to **Create a post**, make a short post (a one-line announcement), go through design, review and **Approve**. Choose Instagram and **Post now**. Show the post on Instagram (open the Instagram app or web and show it live). Say: "This post was published by the app after the owner approved it."
6. Insights are read from 24 hours after posting, so cut to a post that was published more than 24 hours earlier: go to **Results**. Show the post with its numbers (reach, likes, comments, saves, shares, views) and the label for how old the numbers are (for example "after 1 day").
7. Open the same post in Instagram's own Insights view next to it and show that the numbers match. Say: "These numbers come from the Instagram insights API for this post only."
8. Show the weekly summary on the Results page, which uses only these numbers (when R-9 is built).
9. Go to **Connections** and click **Disconnect**. Say: "The owner can disconnect at any time. Deleting the account removes the stored numbers." Optionally show **Account > Download my data** containing `insights.json`.

---

## 2. `read_insights` and `pages_read_engagement` (Facebook Login, Pages)

`pages_read_engagement` is already requested for publishing to Pages. Re-use its text, and add the insights use below. `read_insights` is the new one.

**Use case text for `read_insights`**

> Our app publishes posts to the owner's Facebook Page after the owner approves each post (`pages_manage_posts`). We use `read_insights` to read the insights of the Page posts we published, with `GET /{post-id}/insights` for reach (`post_impressions_unique`), impressions (`post_impressions`), reactions by type (`post_reactions_by_type_total`) and views (`post_media_view`), about 24 hours, 3 days and 7 days after publishing. We use `pages_read_engagement` to read the post's share and comment counts (`GET /{post-id}?fields=shares,comments.summary(true)`), counts only. We show these numbers to the owner on a Results page and in a weekly summary of what worked best for their Page. We only read insights of posts our app published, for Pages the owner connected, and we do not read the text or authors of comments, or Page-level audience data.

**Why we need it (short):** To show the Page owner how the posts we published for them performed.

**Data-use answers**: same as section 1, with these changes. Received data: reach, impressions, reactions (added up to a like count), views, share count, comment count. Page access tokens are stored encrypted and do not expire; they are deleted when the owner disconnects or deletes their account.

**Screencast script (about 3 minutes)**

1. Sign in, open **Connections**, click **Connect Facebook**. On the Facebook dialog show the Page being chosen and the permission list including **read insights** and **read engagement**. Click **Continue**. If the owner has several Pages, show picking one on the "Choose your Page" screen.
2. Create a post, approve it, choose Facebook, **Post now**. Show the post on the Facebook Page.
3. Cut to a post published more than 24 hours earlier. Open **Results** and show its numbers (reach, impressions or views, likes, comments, shares) and their age.
4. Open Facebook's own Page Insights for the same post and show the numbers match.
5. Show **Disconnect** on **Connections**.

---

## 3. For Ideas: `instagram_basic` and `business_management` (Business Discovery via Facebook Login)

**What the feature does.** In the **Ideas** screen the owner can name up to 5 competitor businesses and give their public Instagram handles. Once a week we ask Instagram for each competitor's public follower count, post count and recent post links, dates, types, like counts and comment counts using Business Discovery (`GET /{ig-user-id}?fields=business_discovery.username({handle}){followers_count,media_count,media{permalink,timestamp,media_type,like_count,comments_count}}`) through the owner's own Facebook connection (the Page's linked Instagram professional account). We use it to show the owner which competitors are growing and what kinds of posts get attention in their field. This is behind a switch (`IDEAS_BUSINESS_DISCOVERY=on`) that stays off until these permissions are approved.

**Use case text**

> Our app lets a small business owner name a few competitor businesses and see how their public Instagram business accounts are doing, so the owner can get ideas for their own posts. We call Instagram Business Discovery once a week through the owner's own connected Facebook Page and its linked Instagram professional account. We use `instagram_basic` to read the owner's linked Instagram professional account id (needed to call Business Discovery) and `business_management` only where the owner's Page is owned by a Business Manager, so the Page and its linked Instagram account can be accessed. From competitors we store only public counts (followers, number of posts) and, for their most recent posts, the link, date, type, like count and comment count. We do not store captions, comments, usernames of people who liked or commented, or follower lists, we do not copy their pictures, and we only look up public business and creator accounts that the owner named. We show the counts to the owner and use them only to say whether a competitor is growing.

**Honest notes for the reviewer**

- `business_management` is requested only because Business Discovery with Facebook Login can require it when the Page sits in a Business Manager. If Meta confirms in the review that `instagram_basic` and `pages_read_engagement` alone are enough for the owner's Pages, **do not request `business_management`** (ask for the least). [CHECK on a live Page before submitting.]
- The app never contacts competitors, never messages anyone, and never posts anything as or about a competitor.

**Data-use answers**

| Question | Answer |
|---|---|
| What data do you receive? | Competitor public business account: followers_count, media_count, and for recent posts: permalink, timestamp, media type, like_count, comments_count. |
| How is it used? | Shown to the owner who named the competitor, as a weekly comparison and as one input for post ideas. Weekly snapshots show change over time. |
| Is it shared? | No. It is only visible to members of the business that named the competitor. |
| How long is it kept? | While the owner keeps the competitor on their list or their account exists. The owner can remove a competitor at any time, which removes its snapshots. Deleting the account removes everything. |
| Can people opt out? | A competitor business that does not want to be looked up can make its account private or switch it to a personal account; the lookup then returns nothing. |

**Screencast script (about 2 minutes)**

1. Sign in. Go to **Ideas** and open **Competitors**. Add a competitor name and its public Instagram business handle (a test business account). Show that the page says only public business accounts can be added.
2. Click **Research now**. Show the competitor card with follower count, post count and the links to recent posts (counts and links only, no captions).
3. Show **Remove** on the competitor and say what happens to the stored counts.
4. Show **Connections > Facebook** to explain that the lookup uses the owner's own Facebook Page connection.

---

## What the privacy policy must say (add before submitting)

The current `/terms` page does not mention insights or competitor lookups. Add, in plain words:

- We read the insights (reach, likes, comments, saves, shares, views) of posts we published for you on Instagram and Facebook, about 1, 3 and 7 days after posting. We store these numbers for your business only, show them to you, and use them to write your weekly results summary.
- If you name competitors, we read their public business account counts and recent post counts through Instagram. We store counts and links only.
- You can download these numbers (`insights.json` in your data export), disconnect at any time, and delete your account to remove them.

## Needs a live check (cannot be verified with test fixtures)

1. **Instagram insights API version and metrics.** The code uses `https://graph.instagram.com/v23.0/{media-id}/insights` (`META_GRAPH_VERSION` can change it). Check that `views` is accepted for feed posts and carousels, that `replies` and `views` work for stories, and that the answer shape (`values[]` or `total_value`) matches what `src/lib/insights/instagram.ts` reads. A refused metric is skipped, so a wrong guess shows up as an empty column, not an error.
2. **Story timing.** Story insights stop being available 24 hours after posting. The job measures a story once, from 20 hours; confirm on a real story that numbers are returned at 20 to 24 hours.
3. **Facebook metrics.** Check which of `post_impressions_unique`, `post_impressions`, `post_reactions_by_type_total` and `post_media_view` answer for a Page post; remove from the use-case text and from the code any that never do.
4. **Facebook post id.** For a single-picture post the app stores the `post_id` that Facebook returns when publishing (`{page-id}_{post-id}`); check that `/insights` accepts it.
5. **Error codes.** The job treats codes 10 and 200-299 as "permission missing", 190, 102 and HTTP 401 as "token problem", and 1, 2, 4, 17, 32, 341, 613, 429 and 5xx as "try again later"; anything else (for example code 100) skips that metric. Confirm with a real account that a missing insights permission produces one of these codes.
6. **Permission names in the connect dialog.** After adding the scopes, connect a test account and confirm `channel_connections.scopes` contains `instagram_business_manage_insights` (Instagram) or `read_insights` and `pages_read_engagement` (Facebook).
