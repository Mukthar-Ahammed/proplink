# PropLink UK — Client Demo Walkthrough

A step-by-step script for presenting PropLink to the client. It follows **one
property through the whole pipeline** — Landlord → Admin → Agent → Investor →
Buyer — so the client sees the business loop as one story.

> **Presenting from the hosted demo (Netlify, ADR-076)?** Set it up once with
> [`docs/runbooks/NETLIFY-DEMO.md`](runbooks/NETLIFY-DEMO.md). Then read every
> `localhost:3000` below as the Netlify URL. The mail inbox `/dev/mail` is
> **Admin-only** there, so open it from the Admin window.

---

## Demo logins

All accounts use the same password, **`Password123!`** (also in the table).

| Role                   | Email                     | Password       | Name in the app | Sign in at                                  |
| ---------------------- | ------------------------- | -------------- | --------------- | ------------------------------------------- |
| Admin                  | `admin@proplink.test`     | `Password123!` | Platform Admin  | `/admin/login` (needs an authenticator app) |
| Landlord               | `landlord@proplink.test`  | `Password123!` | Lena Landlord   | `/login`                                    |
| Agent                  | `agent@proplink.test`     | `Password123!` | Alice Agent     | `/login`                                    |
| Investor (Lead)        | `investor@proplink.test`  | `Password123!` | Ivan Investor   | `/login`                                    |
| Investor (Co-Investor) | `investor2@proplink.test` | `Password123!` | Priya Raman     | `/login`                                    |
| Investor               | `investor3@proplink.test` | `Password123!` | Tom Okafor      | `/login`                                    |
| Buyer                  | `buyer@proplink.test`     | `Password123!` | Bella Buyer     | `/login`                                    |
| Buyer                  | `buyer2@proplink.test`    | `Password123!` | Grace Whitfield | `/login`                                    |
| Buyer                  | `buyer3@proplink.test`    | `Password123!` | Daniel Mercer   | `/login`                                    |

- There is **no seeded Solicitor**. The Admin invites one live during the demo (Step 7).
- Emails don't really send in development. Every email appears at
  **<http://localhost:3000/dev/mail>**, which is also worth showing the client.

---

## Before the meeting (about 15 minutes — don't skip this)

1. Run `npm run dev` and open <http://localhost:3000>. Make sure the database
   is seeded (`npm run db:seed`).
2. **Set up Admin MFA in advance.** Sign in at `/admin/login` and scan the QR
   code with your phone's authenticator app. Keep the phone nearby — the Admin
   login asks for a code every time.
3. **Set prices:** as Admin, open `/admin/billing` and enter monthly and yearly
   prices for Agent and Investor.
4. **Activate subscriptions:** sign in as `agent@`, `investor@` and
   `investor2@` in turn. For each, open `/account/billing` → Subscribe monthly →
   **"Pay (test)"**. Status should show **Active**.
5. Open **separate browser profiles or incognito windows** for Admin,
   Landlord, Agent and Investor, so you can switch roles without signing out.
6. _Optional backup:_ run Steps 1–3 once beforehand, so a ready listing exists
   if anything goes wrong live.

---

## The demo, in order

### Step 0 — Public website (2 min) · signed out

- Home page → **`/marketplace`**: the public, Rightmove-style search over the
  seeded catalogue (40 properties across 12 UK cities).
- Open a listing: photos, **EPC rating**, disclosed defects (subsidence, damp,
  probate, etc.).
- **Message to the client:** "This is what retail buyers see. Everything
  private stays behind the pipeline we're about to walk through."

### Step 1 — Landlord submits a private property (3 min) · `landlord@`

- `/landlord` → **Listings → New listing**. Fill in the details, upload an
  ownership document, submit.
- If the app asks for an identity check first, complete the mock one at
  `/verify`.
- **Point out:** the Landlord can never publish publicly. The property goes to
  Admin review first.

### Step 2 — Admin reviews it (3 min) · `admin@`

- `/admin/landlord-listings` → claim the listing → **Approve** (or reject with a
  reason to show that the Landlord gets the reason by email).
- Show `/dev/mail`: verified Agents receive a "New private property" email.
- **Point out:** the review queue, the SLA badge and the audit trail.

### Step 3 — Agent sends a proposal (3 min) · `agent@`

- `/agent` dashboard → **Marketplace** ("Landlord listings") → open the
  property → **send a proposal**.
- **Point out:** before a mandate, the Agent sees the property but **never the
  Landlord's identity**.

### Step 4 — Landlord picks an Agent → mandate (3 min)

- **Landlord:** Listings → **Compare proposals** → optionally ask a question →
  **"Choose this agent"**.
- **Agent:** **Mandates** → **Accept**. The Landlord's name and documents now
  appear.
- _Optional chat demo:_ as Admin open `/admin/chats` → **"Authorise
  selected"**; then Landlord and Agent chat live at `/messages`.

### Step 5 — Agent publishes to investors (3 min) · `agent@`

- Mandates → tick what investors may see → **"Publish to investors"** → fill in
  the terms → publish.

### Step 6 — Investors (5 min)

- **`investor@`:** **Projects** → the property shows only the ticked fields (no
  landlord name or street) → **"I'm interested"**.
- **Agent:** nominate Ivan as **Lead Investor** → **Investor:** accept →
  **Admin:** approve at `/admin/projects`. The project shows **"Open for
  investment"**.
- **`investor2@`:** open the project → use the **pledge calculator** (the share
  updates as you type) → pledge.
- **Say it clearly to the client:** _"This is an Expression of Interest only.
  No investment money moves through the app. Funds go through
  solicitor-managed bank accounts outside the platform."_ Also mention that
  pledges are blocked server-side unless KYC is approved.

### Step 7 — Solicitor and agreement (optional, 5 min)

- Admin → project page → **"Invite the Solicitor"** → open the link from
  `/dev/mail` → set a password and MFA → `/solicitor` shows **only that one
  project**.
- Solicitor uploads a PDF → **Prepare draft** → **Send for signature** → each
  party signs on the mock e-sign page → status becomes **Signed**, and pledges
  become "binding".
- ⚠️ This step needs the Supabase service-role key (OD-18). **Try it before
  the meeting.** If it fails, skip it and describe it instead.

### Step 8 — Buyer experience (3 min) · `buyer@`

- `/buy`: Bella already has a seeded viewing, an offer and an agent chat.
- Search → save a listing → **book a viewing** → **make an offer**.
- **Agent:** **Offers** → counter the offer → **Buyer:** accept. The listing
  shows "Under offer" and the deal tracker appears.

### Step 9 — Admin governance overview (2 min) · `admin@`

- Quick tour of the `/admin` sidebar: Users, KYC, Moderation, Chats, Reviews,
  Cases, Billing, Ads, Roles (two-person approval for super-admin grants).
- **Close with:** "Admin oversees every sensitive step: listings, agent
  access, chats, KYC and reviews."

---

## Tips for presenting

- **Total time is about 30 minutes.** If you have only 15, do Steps 0, 1–4, 6
  and 8.
- **What runs on mocks:** Stripe, KYC (Sumsub), Google Maps and the AI
  assistant use mock providers because the live keys aren't set yet. Present
  these as "integrated, switched on at launch."
- **If a page errors out**, switch to the backup listing you prepared earlier.
- **Test in your dry run:**
  - the Landlord may be asked to complete the mock identity check at `/verify`
    before submitting;
  - the Solicitor invite in Step 7 depends on the service-role key being set.
