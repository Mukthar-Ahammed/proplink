# PropLink UK — Client Demo Walkthrough

## What is PropLink? (read this out first)

> "PropLink helps sell **damaged or hard-to-sell properties** in the UK.
> A **Landlord** has a property. We check it. An **Agent** takes it on.
> **Investors** can show interest in funding the repairs. Once it's fixed,
> a **Buyer** can buy it. Our team (the **Admin**) watches over every step."

**The journey in one line:**

**Landlord → Admin checks → Agent → Investors → Buyer**

In the demo we follow **one property** along this journey, from start to finish.

> **Presenting from the hosted demo (Netlify, ADR-076)?** Set it up once with
> [`docs/runbooks/NETLIFY-DEMO.md`](runbooks/NETLIFY-DEMO.md). Then read every
> `localhost:3000` below as the Netlify URL. The mail inbox `/dev/mail` is
> **Admin-only** there, so open it from the Admin window.

---

## Logins

Every account uses the same password: **`Password123!`**

| Who              | Email                     | Password       |
| ---------------- | ------------------------- | -------------- |
| Admin (our team) | `admin@proplink.test`     | `Password123!` |
| Landlord         | `landlord@proplink.test`  | `Password123!` |
| Agent            | `agent@proplink.test`     | `Password123!` |
| Investor 1       | `investor@proplink.test`  | `Password123!` |
| Investor 2       | `investor2@proplink.test` | `Password123!` |
| Buyer            | `buyer@proplink.test`     | `Password123!` |

- Everyone signs in at **`/login`**. The Admin signs in at **`/admin/login`**
  and also needs a 6-digit code from the authenticator app on your phone.
- Spare accounts if you need them: `investor3@`, `buyer2@` and `buyer3@`
  (all `@proplink.test`, same password).
- Emails aren't really sent during the demo. You can see them all at
  **`/dev/mail`**.

---

## Get ready before the client arrives (15 minutes)

1. Start the app and open it in your browser.
2. Sign in as **Admin** once and link your phone's authenticator app.
3. As **Admin**, go to **Billing** and set the monthly and yearly prices.
4. Sign in as **Agent**, **Investor 1** and **Investor 2**. For each one, go to
   **Billing** → **Subscribe** → **Pay (test)**. It should say **Active**.
5. Open a separate browser window (incognito) for each person: Admin,
   Landlord, Agent, Investor and Buyer. That way you don't have to keep
   signing in and out.

---

## The demo — 9 simple steps (about 30 minutes)

Each step tells you **who to sign in as**, **what to click** and **what to say**.

### 1. The public website

- **Sign in as:** nobody (stay signed out)
- **Click:** **Marketplace** → open any property
- **Say:** "This is the public website. Anyone can search properties for sale.
  Each one shows its energy rating and any problems, like damp or subsidence."

### 2. The Landlord adds a property

- **Sign in as:** Landlord
- **Click:** **Listings** → **New listing** → fill in the form → upload a
  document → **Submit**
- **Say:** "The Landlord adds their property privately. It is **not public**
  yet. Our team checks it first."

### 3. Our team checks it

- **Sign in as:** Admin
- **Click:** **Landlord listings** → open the new property → **Approve**
- **Say:** "Our team checks every property before anyone else sees it. Once
  approved, our Agents get an email about it."

### 4. An Agent offers to sell it

- **Sign in as:** Agent
- **Click:** **Marketplace** → open the property → **Send a proposal**
- **Say:** "Agents see the property, but **not** who the Landlord is. They send
  an offer to manage it."

### 5. The Landlord picks the Agent

- **Sign in as:** Landlord → **Compare proposals** → **Choose this agent**
- **Then sign in as:** Agent → **Mandates** → **Accept**
- **Say:** "The Landlord compares the Agents and picks one. Only now can the
  Agent see the Landlord's name and documents."

### 6. The Agent shares it with Investors

- **Sign in as:** Agent
- **Click:** **Mandates** → tick what investors may see → **Publish to
  investors** → fill in the details → **Publish**
- **Say:** "The Agent chooses exactly what Investors are allowed to see."

### 7. Investors show interest

- **Sign in as:** Investor 1 → **Projects** → open the property → **I'm
  interested**
- **Then:** the Agent picks Investor 1 as **Lead Investor**, Investor 1
  accepts, and the Admin approves it under **Projects**
- **Sign in as:** Investor 2 → open the project → type an amount → **Pledge**
- **Say (important):** "This is only a **promise of interest**. **No money is
  paid through the app.** Money goes through a solicitor's bank account,
  outside PropLink. Investors must also pass an ID check first."

### 8. A Buyer makes an offer

- **Sign in as:** Buyer
- **Click:** open a property → **Save** → **Book a viewing** → **Make an
  offer**
- **Then sign in as:** Agent → **Offers** → reply with a counter-offer
- **Say:** "Buyers can save homes, book viewings and make offers. The Agent
  replies, all in one place."

### 9. Our team sees everything

- **Sign in as:** Admin
- **Click:** go through the menu on the left (Users, ID checks, Chats,
  Reviews, Reports)
- **Say:** "Our team can see and control every important step. That keeps the
  platform safe and trusted."

---

## Short on time?

Do steps **1, 2, 3, 4, 5, 7 and 8** (about 15 minutes).

## If the client asks…

- **"Is payment working?"** — "Subscriptions for Agents and Investors are
  built. Right now it uses test payments. Real payments are switched on at
  launch."
- **"Do landlords or buyers pay?"** — "No. Only Agents and Investors pay a
  subscription."
- **"Where does the investment money go?"** — "Never through the app. Only
  through a solicitor's bank account."

## Good to know (for you, not the client)

- Some features use test versions until the real keys are added: payments
  (Stripe), ID checks, maps and the AI assistant.
- The Landlord may be asked for a quick test ID check (`/verify`) before
  adding a property. Just click through it.
- Optional extra: the Admin can invite a **Solicitor** from a project page.
  This needs the Supabase service-role key, so try it before the meeting.
- Something breaks live? Do steps 2–3 before the meeting, so you have a ready
  property to fall back on.
