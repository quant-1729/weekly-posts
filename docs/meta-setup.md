# Connecting Meta (Instagram + Facebook)

One Meta app does three jobs for Weekly Posts:

| Job | What it lets the app do | Who logs in |
|---|---|---|
| **Import** (Business Discovery) | Read an owner's recent public posts from just their @handle | Nobody: uses one token from *your* account |
| **Connect + publish to Instagram** (Instagram Login) | Publish approved posts to the owner's Instagram | Each owner, once ("Connect Instagram") |
| **Connect + publish to a Facebook Page** (Facebook Login) | Publish approved posts to the owner's Page | Each owner, once ("Connect Facebook") |

Meta renames menus often. If a name below differs slightly, pick the closest one. Never paste keys into chat: put them in `.env.local` and say "done".

> **All addresses below are final** (confirmed 2026-10-15). `<your-domain>` is your https address from step 3.

---

## Step 0: What you need first (15 min)

1. **A Facebook account** (yours) to own the app.
2. **A Facebook Page** for Weekly Posts: facebook.com/pages/create.
3. **An Instagram professional account** for Weekly Posts. In the Instagram app: Settings → Account type and tools → Switch to professional account → Business. Link it to the Page: Page → Settings → Linked accounts → Instagram → Connect.
4. **A business portfolio** at business.facebook.com. Add the Page and the Instagram account under Business settings → Accounts.

## Step 1: Create the app (10 min)

1. Go to developers.facebook.com → **My Apps → Create app**.
2. App name **Weekly Posts**; contact email: yours.
3. **Use cases:** choose both:
   - **"Manage messaging & content on Instagram"** (the Instagram API), and
   - **"Manage everything on your Page"** (the Pages API).
4. Connect it to your **business portfolio** from step 0.

## Step 2: Basic settings (5 min)

App → **App settings → Basic**:

- Copy the **App ID** and **App secret**. They go in `.env.local` (step 7).
- **Privacy policy URL:** `https://<your-domain>/terms#privacy`. **Terms of service URL:** `https://<your-domain>/terms`.
- **App icon** (1024×1024) and **category** (Business and pages).
- **App domains:** your domain (e.g. `weeklyposts.app` or the Cloud Run domain).
- **User data deletion:** choose "Data deletion callback URL" and enter
  `https://<your-domain>/api/meta/data-deletion` (the "callback" type, not an instructions page).

## Step 3: A web address with https (needed before step 4)

Meta only sends owners back to **https** addresses. Use one of these:

- **The deployed app** on Cloud Run (`docs/deploy.md`), e.g. `https://weekly-posts-xxxx.a.run.app` or your own domain. **Recommended.**
- **For testing on this computer:** a tunnel such as Cloudflare Tunnel or ngrok, which gives your local app an https address. Then set `NEXT_PUBLIC_APP_URL` to that address while testing.

Use the same address everywhere below (`<your-domain>`).

## Step 4: Instagram Login (publishing to Instagram) (10 min)

App → **Use cases → Instagram API → Customize → "API setup with Instagram login"**:

1. Note the **Instagram app ID** and **Instagram app secret** shown there. They are different from the App ID in step 2 and go in `.env.local` (step 7). If you leave them blank, the app uses the Meta App ID and secret instead.
2. **Permissions:** add `instagram_business_basic` and `instagram_business_content_publish`.
3. **Business login settings:**
   - **OAuth redirect URI:** `https://<your-domain>/api/connect/instagram/callback`
   - **Deauthorize callback URL:** `https://<your-domain>/api/meta/deauthorize`
   - **Data deletion request URL:** the same as step 2.

## Step 5: Facebook Login (publishing to Pages, and the import token) (10 min)

App → **Use cases → Pages API** (it adds Facebook Login for Business):

1. **Permissions:** add `pages_show_list`, `pages_read_engagement` and `pages_manage_posts`. For the **import**, also `instagram_basic` and `instagram_manage_insights`.
2. **Facebook Login → Settings:** turn on **Client OAuth login** and **Web OAuth login**, then add to **Valid OAuth Redirect URIs:**
   `https://<your-domain>/api/connect/facebook/callback`
3. In the same settings, set the **Deauthorize callback URL** to `https://<your-domain>/api/meta/deauthorize` and the **Data deletion** URL as in step 2.

## Step 6: Testers, so it works before Meta's review (5 min per person)

While the app is in **Development** mode, only people with a role on the app can connect.

1. App → **App roles → Roles**:
   - Add yourself and each pilot owner as **Testers** (by Facebook name or email).
   - Under **Instagram Testers**, add each pilot owner's Instagram username.
2. Each person accepts:
   - Facebook: the invite at developers.facebook.com → Requests.
   - Instagram: on instagram.com → Settings → **Apps and websites → Tester invites** → Accept.

## Step 7: Put the values in `.env.local`

```
META_APP_ID=                 # step 2
META_APP_SECRET=             # step 2
INSTAGRAM_APP_ID=            # step 4
INSTAGRAM_APP_SECRET=        # step 4
TOKEN_ENCRYPTION_KEY=        # already set for this computer by Claude; make a new one for production
META_GRAPH_VERSION=          # leave blank (default)
NEXT_PUBLIC_APP_URL=         # your https address from step 3

# Import (Business Discovery), as in the earlier instructions:
INSTAGRAM_LOOKUP_TOKEN=      # system user token (Business settings → Users → System users)
INSTAGRAM_LOOKUP_USER_ID=    # optional; Claude can look it up from the token
```

Make the encryption key (run once, paste the result):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Keep this key safe and don't change it later: changing it disconnects every owner, who must then reconnect. Use a **different** key in production (Secret Manager on Cloud Run).

**The import token** (if not done yet):

1. business.facebook.com → Business settings → Users → **System users → Add** (Admin).
2. **Assign assets:** the app (full control), the Page and the Instagram account.
3. **Generate new token:** pick the app, expiry **Never**, and the permissions `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement` and `pages_show_list`.

## Step 8: Before real owners (Meta review, 2-4 weeks)

Testers work right away. For anyone else, the app needs **Advanced Access**:

1. **Business verification:** business.facebook.com → Security Centre → Start verification (company documents).
2. **App Review:** request Advanced Access for
   - `instagram_business_basic` and `instagram_business_content_publish`;
   - `pages_show_list`, `pages_read_engagement` and `pages_manage_posts`;
   - `instagram_basic` and `instagram_manage_insights` (for the import).
   For each, Meta asks for a short description and a **screen recording** of the feature in use: connecting, approving a post, and it appearing on Instagram/Facebook. Claude can give you the descriptions and a recording script.
3. When approved, switch the app from **Development** to **Live** (top of the app dashboard).

**Submit step 8 early**: it is the longest wait, and testers can use everything meanwhile.

## What happens after you say "done"

1. Claude looks up your Instagram account ID for the import and test-imports one public business account.
2. Claude checks that Connect works with your tester account and publishes one test post, to an account you choose, **only after asking you**.
3. Claude checks the data-deletion and deauthorize callbacks answer correctly.
