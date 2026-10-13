# Email checklist (AC 14)

Run this once a real sending domain exists (Resend or another sender, with SPF, DKIM and DMARC set up). We cannot test Gmail and Outlook from the dev machine, so the email is built to known-safe rules and checked by `tests/email/lint.ts`. This list covers what only real inboxes can show.

## Before you start

- [ ] `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` (optional), `NEXT_PUBLIC_APP_URL` (the real https address) and `EMAIL_LINK_SECRET` (32+ random characters) are set.
- [ ] The sending domain shows as verified, with SPF, DKIM and DMARC passing (check in the sender's dashboard, or "Show original" in Gmail: SPF PASS, DKIM PASS, DMARC PASS).
- [ ] Generate a week in an account you own, so the weekly email is sent to you. Use a business with at least 4 posts, one of them with an open "Please check" note.
- [ ] Do each run below once on a WiFi connection and once on mobile data.

## Clients to test

| # | Client | Where |
|---|---|---|
| 1 | Gmail web | Chrome on desktop |
| 2 | Gmail app | Android phone |
| 3 | Gmail app | iPhone |
| 4 | Outlook web | outlook.com or Microsoft 365 in a browser |
| 5 | Outlook desktop | Windows (the "classic" Outlook uses Word to draw email, the strictest case) |

Also try Apple Mail on iPhone if you have it, and dark mode in Gmail and Outlook.

## For each client

Look
- [ ] The email arrives in the inbox, not spam or Promotions. Note where it lands.
- [ ] The subject reads "Your 4 posts for the week of 9 Nov are ready" (your count and date).
- [ ] The preview text next to the subject reads "Approve, edit or skip each one with a tap. No sign-in needed."
- [ ] The email is one column, no wider than the screen on a phone, no sideways scrolling.
- [ ] Every post shows its image at full width, with the day and channel above it.
- [ ] Images show without pressing "Display images" (Outlook may ask; after allowing, they must all appear). With images off, the alt text is readable.
- [ ] Each post shows the first 2 lines of its caption, and the "Please check: N things" note where it applies.
- [ ] The three buttons Approve, Edit and Skip sit in one row, are the same size, and are easy to tap with a thumb.
- [ ] Button text is readable: Approve is white on dark orange, Edit and Skip are dark on light grey. In Outlook desktop the buttons still show their colour.
- [ ] "See all posts" is a full-width button.
- [ ] The check-in row "Did last week's posts bring enquiries?" shows None, A few, Many (only when last week's email was sent).
- [ ] The footer shows why you get the email, "Pause for 2 weeks" and "Unsubscribe".
- [ ] Gmail does not show "[Message clipped]" at the bottom.

Dark mode (Gmail and Outlook, phone)
- [ ] No white text on a white background, and no dark text on a dark background.
- [ ] Buttons stay readable.

Links (open each from the email, signed out, in a private window)
- [ ] Approve, Edit and Skip each open a page for that post, with a button. Opening the page changes nothing (check the dashboard: the post is still not approved).
- [ ] Pressing the button on the page does the action (until V-16 ships these show "coming soon").
- [ ] "See all posts" lists every post with its image, caption and status.
- [ ] A check-in link opens the question with that answer selected. Press "Save my answer"; the answer shows in the dashboard. Open another answer's link and save it; the answer changes.
- [ ] "Pause for 2 weeks" opens a page with a date 14 days ahead; pressing the button pauses (the next weekly email does not arrive).
- [ ] "Unsubscribe" opens "Stop weekly emails?"; pressing the button unsubscribes, and "Resubscribe" on the next page undoes it.
- [ ] Opening a link from an email older than 14 days shows "This link has expired" and a "Sign in" button. (To test sooner, temporarily sign a link with an old date in a dev shell.)

## Mail-app features

- [ ] Gmail web and app: the "Unsubscribe" link next to the sender name appears. Pressing it unsubscribes after one confirmation (this is the RFC 8058 one-click POST). Check the dashboard: emails are off.
- [ ] Outlook: the unsubscribe option appears in the message menu if the client supports it. Outlook does not support one-click in all versions; note what you see.
- [ ] Open the email in "Show original" or "View source" and confirm the headers `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` are present.

## Plain text and scanners

- [ ] Open the plain-text version (Gmail: "Show original" and read the text part; or switch the client to plain text). It lists every post with Approve, Edit and Skip links, the check-in links and the footer links.
- [ ] If your work mailbox has link scanning (Outlook SafeLinks, a company gateway), send the email there. After it arrives, check the dashboard: no post was approved, skipped, paused or unsubscribed by the scanner.
- [ ] Forward the email to a second person. Their approve link works once for that post only; the action shows in the post's history as done through an email link.

## Other emails

Repeat the "Look" and "Dark mode" checks for these, which share the layout:
- [ ] The late notice: "This week's posts are running late".
- [ ] The short email after 2 ignored weeks: "3 posts ready — 1 tap".
- [ ] The paused notice: "We've paused your weekly posts", with its "Yes, send them again" button.
- [ ] The weekly email sent late shows "Sorry these are late." above the intro.

## Record the result

For each client note: pass or fail, the folder it landed in, and a screenshot of anything wrong. Send problems to the person who owns the email code with the client name and version.

## Share on real phones (AC 17, V-17)

The share sheet cannot be tested from the dev machine, so this list is the evidence for AC 17. Do it on a real iPhone (Safari) and a real Android phone (Chrome), signed in or from the emailed link, with a week that has at least two approved posts (one Instagram or Facebook, one LinkedIn or Google Business Profile). The phone needs WhatsApp, Instagram and Facebook installed and signed in, and `NEXT_PUBLIC_APP_URL` must be the real https address (the share sheet only works on https).

Do each run once from the emailed "ready" page (Approve a post, then "See posts ready to share") and once from the dashboard `/week` page.

### iOS Safari (iPhone)

- [ ] The post shows a **Share** button and, for Instagram and Facebook posts, also **Share as story or status**. It does not show the Download links. The hint "On iPhone, tap Share, then choose the app" is under the buttons.
- [ ] Tap **Share**. The system share sheet opens within about a second. (If it says "The image is ready. Tap Share again.", tap once more: the picture was still loading. Note how often this happens.)
- [ ] The sheet shows the picture as an attachment (a square picture for Instagram and Facebook, a wide one for LinkedIn and Google Business Profile).
- [ ] The apps row or "More" shows Instagram, WhatsApp and Facebook. Choose **WhatsApp**: the picture is attached. Note whether the caption text is filled in.
- [ ] The page says "Caption copied: paste it if the app doesn't fill it in". Long-press in WhatsApp's caption box and tap Paste: the caption, call to action with the short link, and hashtags appear.
- [ ] Back in the browser, a line "Did you post it?" shows above **Mark as posted**.
- [ ] Tap **Share as story or status**. The picture in the sheet is tall (9:16). In WhatsApp, the sheet offers **My status** (or "Status"); choose it and check the tall picture is attached.
- [ ] Choose **Instagram** from the sheet: it offers Feed, Story or Messages; the picture is attached.
- [ ] Choose **Facebook** (or Messenger): the picture is attached.
- [ ] Close the share sheet without choosing an app: no error message appears on the page.
- [ ] Tap **Copy caption**: "Caption copied" shows; pasting into Notes gives the full text.
- [ ] Tap **Mark as posted**: the post shows "Posted on {date}" and, for a day, a **Not posted yet** button that puts it back.

### Android Chrome

- [ ] Same as above: **Share** and **Share as story or status** are shown, and the Download links are not.
- [ ] Tap **Share**. The Android share sheet opens with the picture. Instagram, WhatsApp and Facebook (or Messenger) are listed, or under "More".
- [ ] In **WhatsApp**, choose a chat or **My status** (Status). The picture is attached. Note whether the caption is filled in.
- [ ] The caption is on the clipboard: paste it into the app's caption box if it is empty.
- [ ] **Share as story or status** sends the tall picture; WhatsApp Status and Instagram Story both take it.
- [ ] Closing the sheet shows no error. **Copy caption** and **Mark as posted** work as on iPhone.

### Check on the dashboard afterwards

- [ ] The post's history shows one "share" entry for each Share you completed (and none for a closed share sheet or for Copy). On the ready page the entry says it was done through an email link; on the dashboard, by you.
- [ ] A desktop browser (Chrome or Edge on a computer) shows **Download square / story size / wide** and **Copy caption**, no Share button. The downloaded file is a full-size PNG (1080 px wide) named like `instagram-square.png`.

### The 3-day reminder (AC 25)

- [ ] Approve two posts, do not mark either as posted, and wait 3 days (or move `approved_at` back 3 days in a test account). Within an hour an email "You have 2 posts ready to share" arrives, with each post's small picture, first caption line and a **Share** button. It has the Pause and Unsubscribe links in the footer.
- [ ] The **Share** button opens the ready page for that week on the phone.
- [ ] No second reminder arrives the next week for the same posts. Marking every approved post as posted before the 3 days pass means no reminder is sent.
- [ ] The reminder looks right in Gmail (web and app) and Outlook, in light and dark mode (use the "Look" and "Dark mode" checks above).
