# Meta connection: step-by-step guide

For connecting Instagram and Facebook to Weekly Posts so approved posts publish automatically. Everything below uses the live app's real addresses: copy and paste them as they are.

**Live app:** `https://weekly-posts-526531409571.australia-southeast1.run.app`

Meta renames menus from time to time. If a label differs a little, pick the closest one. **Never paste keys or secrets into chat**: put them in `.env.local` and tell Claude "done".

---

## Where things stand

| | Item | Status |
|---|---|---|
| ✅ | Meta app created (App ID `1765815467804287`) | Done |
| ✅ | Meta app secret and Instagram app ID/secret in the live app | Done |
| ✅ | Connect, publish and Meta callback addresses live | Done |
| ⬜ | Part A: app settings in the Meta dashboard | You |
| ⬜ | Part B: Instagram login settings | You |
| ⬜ | Part C: Facebook login settings | You |
| ⬜ | Part D: testers | You |
| ⬜ | Part E: sign-in emails (Resend) | You, then Claude |
| ⬜ | Part F: first real connection and test post | You and Claude |
| ⬜ | Part G: Meta review, before real customers | You (Claude writes the texts) |

Do A to E in any order. F needs all of them. G can be submitted any time after F.

---

## Part A: App settings (5 minutes)

1. Go to **developers.facebook.com → My Apps → Weekly Posts**.
2. Open **App settings → Basic** and fill in:

| Field | Paste this |
|---|---|
| App domains | `weekly-posts-526531409571.australia-southeast1.run.app` |
| Privacy policy URL | `https://weekly-posts-526531409571.australia-southeast1.run.app/terms#privacy` |
| Terms of service URL | `https://weekly-posts-526531409571.australia-southeast1.run.app/terms` |
| User data deletion | Choose **Data deletion callback URL**, then paste `https://weekly-posts-526531409571.australia-southeast1.run.app/api/meta/data-deletion` |
| App icon | Any square logo, 1024 × 1024 px |
| Category | Business and pages |

3. Click **Save changes** at the bottom.

## Part B: Instagram login settings (5 minutes)

1. In the app, open **Use cases**. If **"Manage messaging & content on Instagram"** isn't listed, click **Add use case** and add it.
2. Open it, then **API setup with Instagram login**.
3. **Permissions:** make sure both are added:
   - `instagram_business_basic`
   - `instagram_business_content_publish`
4. **Set up Instagram business login → Business login settings:**

| Field | Paste this |
|---|---|
| OAuth redirect URIs | `https://weekly-posts-526531409571.australia-southeast1.run.app/api/connect/instagram/callback` |
| Deauthorize callback URL | `https://weekly-posts-526531409571.australia-southeast1.run.app/api/meta/deauthorize` |
| Data deletion request URL | `https://weekly-posts-526531409571.australia-southeast1.run.app/api/meta/data-deletion` |

5. Click **Save**.

(The Instagram app ID and secret on this screen are already in the live app. If you ever reset the secret, put the new one in `.env.local` and tell Claude.)

## Part C: Facebook login settings (5 minutes)

1. In **Use cases**, add **"Manage everything on your Page"** if it isn't there.
2. **Permissions:** make sure these are added:
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
3. Open **Facebook Login → Settings** (it may be under **Facebook Login for Business**):
   - Turn **Client OAuth login** ON.
   - Turn **Web OAuth login** ON.
   - **Valid OAuth Redirect URIs:** `https://weekly-posts-526531409571.australia-southeast1.run.app/api/connect/facebook/callback`
   - **Deauthorize callback URL** (if shown here too): `https://weekly-posts-526531409571.australia-southeast1.run.app/api/meta/deauthorize`
4. Click **Save changes**.

## Part D: Testers, so it works before Meta's review (5 minutes)

While the app is in **Development** mode, only people with a role on the app can connect.

1. **App roles → Roles → Add people:** add your own Facebook account (and any pilot owners) as **Tester**. Each person accepts at **developers.facebook.com → Requests**.
2. **App roles → Roles → Instagram Testers → Add Instagram testers:** type the Instagram username(s).
3. Each Instagram tester accepts on a computer: **instagram.com → Settings → Apps and websites → Tester invites → Accept**.
4. **Check your test accounts:**
   - The Instagram account must be a **Business** or **Creator** account. In the app: Settings → Account type and tools → Switch to professional account.
   - For Facebook publishing, the Instagram account should be linked to a **Facebook Page you manage**: Page → Settings → Linked accounts → Instagram.

## Part E: Sign-in emails with Resend (15-30 minutes, mostly waiting)

You must be signed in to press "Connect", and the live site signs people in by email. So it needs a working email sender.

1. Sign up at **resend.com**.
2. **Domains → Add domain:** use a domain you own, ideally a subdomain such as `mail.yourdomain.com`.
3. Resend shows 3-4 **DNS records** (SPF, DKIM and an MX for bounces). Add them at your domain provider (GoDaddy, Namecheap, Cloudflare...), then click **Verify** in Resend. It usually turns **Verified** within minutes, sometimes up to an hour.
4. Also add a **DMARC** record if Resend suggests one (`_dmarc`, value `v=DMARC1; p=none;`). It helps emails land in the inbox rather than spam.
5. **API Keys → Create API key** (sending access).
6. Put these in `.env.local` and tell Claude "done":
   ```
   RESEND_API_KEY=re_...
   EMAIL_FROM=Weekly Posts <hello@mail.yourdomain.com>
   ```
   The `EMAIL_FROM` address must be on the verified domain.

Claude then updates the live app (about 3 minutes) and sends one test sign-in email to you, after asking.

## Part F: First real connection and test post (10 minutes)

1. Open `https://weekly-posts-526531409571.australia-southeast1.run.app`, enter your email, open the sign-in link and press **Continue**.
2. Go through setup, or skip what you can.
3. Go to **Connections → Connect Instagram**. Log in to the **tester** Instagram account and allow both permissions. You land back on Connections with your account name shown.
4. **Connections → Connect Facebook**: log in, choose your Page, and allow.
5. Tell Claude. Claude checks the connections are stored (tokens encrypted), then **asks you** before publishing one test post:
   - you choose which account and what it says;
   - Claude creates it, you approve it, and it publishes;
   - you can delete it from Instagram or Facebook straight after.

If something fails, the Connections page says why in plain words. Tell Claude what it says.

## Part G: Meta review, before real customers (2-4 weeks, start early)

Testers can use everything now. Anyone else needs Meta's **Advanced Access**:

1. **Business verification:** business.facebook.com → **Security Centre → Start verification**. It needs company documents (registration certificate, GST or utility bill with the business name and address).
2. **App Review → Permissions and features:** request **Advanced Access** for:
   - `instagram_business_basic` and `instagram_business_content_publish`;
   - `pages_show_list`, `pages_read_engagement` and `pages_manage_posts`;
   - optionally `instagram_basic` and `instagram_manage_insights` (for importing posts by @handle).
3. For each permission Meta asks for a **description** and a **screen recording** of it in use. Ask Claude for the ready-made texts and a recording script: sign in → Connect → create a post → approve → it appears on Instagram/Facebook.
4. When approved, switch the app from **Development** to **Live** (toggle at the top of the app dashboard).

---

## Keep in mind

- **Secrets shared in chat:** the Meta app secret and the Instagram app secret were pasted in chat once. Before real customers, reset both (App settings → Basic → App secret → **Reset**, and the same on the Instagram login screen), put the new values in `.env.local` and tell Claude. Claude updates the live app.
- **Address change:** if you later use your own domain (e.g. `app.weeklyposts.com`), the addresses in Parts A to C must be updated to match. Claude will list them.
- **Cost:** Meta's APIs are free. Publishing doesn't add any cost to the app.
