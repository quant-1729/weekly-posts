# Demo video: scene timings and narration

Video: docs/submission/Weekly-Posts-demo.mp4 (3:12, 1080p, 30 fps). Each scene's narration starts 0.4 s after the scene starts (approx). Scenes crossfade by 0.3 s. Captions are burned into the picture, so the spoken words should stay the same as below (small wording changes will mismatch the captions).

| Scene | Starts at | Length | Narration |
|---|---|---|---|
| s01 | 0:00.0 | 9.1 s | Small businesses need posts every week, but most owners have no designer and little time. Over half get an hour or less a day for marketing. |
| s02 | 0:08.8 | 9.1 s | Meet Weekly Posts, from team zerochills: details first, then design. Every post is built only from what the owner says is true. |
| s02b | 0:17.6 | 16.5 s | Setup takes a few minutes, shown four times faster: the café's name, what it sells, its city, an email, opening hours and what customers like. No website needed. Then the owner picks a face: Tween, our mascot. |
| s04 | 0:33.8 | 17.4 s | To make a post, the owner types the offer in plain words. Gemini on Vertex AI fills in the details, like the post type, and marks each field so the owner can check it. |
| s05 | 0:50.9 | 13.0 s | Next, the owner picks the contact lines for the post: here the email stays and the opening hours come off. Each chip shows the exact words. |
| s06 | 1:03.6 | 15.4 s | Gemini writes the words once, and the Design Studio opens with five starting designs, every word, logo and contact drawn by code, not an image model. |
| s07 | 1:18.7 | 14.2 s | The owner picks one, tries another font pair, and can edit any word, redrawn live. Use this design draws every size and checks the words again. |
| s08 | 1:32.6 | 15.9 s | In Review, the owner adds free home delivery across Pune to the caption. That is not in the brief, so the fact check, code plus Gemini, flags it. The owner removes it and approves. |
| s09 | 1:48.1 | 11.8 s | The owner picks a time on the calendar, here later today, or keeps the suggested slot. Nothing goes out until they confirm. |
| s10 | 1:59.6 | 17.1 s | On the Queue, the card is live. When the time has passed, Cloud Scheduler calls our Cloud Run service, which emails the post to the owner, and Firestore pushes the new status here, no reload. |
| s11 | 2:16.4 | 8.8 s | Firestore rules mirror our database security: a one-hour custom token lets a browser read only its own brand's status, and never write. |
| s12 | 2:24.9 | 13.3 s | Plan a week turns one sentence into one offer per day, read by plain code so nothing is invented. One shared design becomes a week of posts. |
| s13 | 2:37.9 | 14.3 s | Under the hood: one Next.js app on Cloud Run. Gemini on Vertex AI drafts, fact-checks, and grounds Ideas in Google Search. Supabase Postgres with row-level security holds the data. |
| s14 | 2:51.9 | 14.4 s | Posts state only the owner's facts, and nothing goes out without approval. AI spend is capped at fifty cents a week, row-level security covers all 49 tables, and 4,646 automated tests pass. |
| s15 | 3:06.0 | 6.1 s | Weekly Posts is live on Cloud Run today, at the link on screen. Team zerochills, thank you. |
