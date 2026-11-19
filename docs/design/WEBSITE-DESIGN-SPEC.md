# PropLink UK — Website Design Specification

**Status:** v1.0 (2026-11-18), implemented on branch `design-refresh` (ADR-071). The
visual direction comes from the two images in `docs/design/references/` (mood,
colour, card style and layout only). Items still marked **[OWNER]** remain open.
Tokens live in `src/app/globals.css` and are documented in
`docs/ARCHITECTURE.md §Design system`.

**Scope:** every public page, the auth pages, the navbar and footer, every role portal
(Landlord, Agent, Investor, Buyer, Solicitor, Advertiser, Admin), and pages that
Phases 2–7 will add. The aim is a premium, trustworthy property platform that feels
smooth to use on phones and desktops.

---

## 1. Design principles

1. **Trust first.** People here handle property, identity checks and investment
   interest. The interface should look calm, precise and serious. No visual gimmicks,
   no dark patterns, and every status is clear.
2. **One clear next step.** Every screen has one primary action. Secondary actions are
   visually quieter.
3. **Show progress.** Multi-step processes (KYC, listing wizard, mandate, pledge,
   offer) always show where the user is, what's done and what's next.
4. **Fast feel.** Pages show their shape immediately (skeletons, not spinners).
   Actions respond within 100 ms (optimistic UI where it's safe), and navigation
   never shows a blank screen.
5. **Mobile is first-class.** Every flow can be completed one-handed on a 375 px
   screen.
6. **Consistency over novelty.** The same component behaves the same way everywhere.
   Every page is built from the component library in §7.
7. **Accessible by default.** WCAG 2.2 AA is the minimum (§11).

---

## 2. Reference images → decisions

The images live in `docs/design/references/<area>/` (see that folder's README). Each
one is reviewed and summarised here. The decisions it drives are marked **[REF]**
throughout this document.

| Reference file                                     | Area                    | What we take from it                                                                                                                                                        | Applied in §     |
| -------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `Realtor Portfolio Website Template (1).jpg`       | Property detail, chrome | White page, deep teal primary, rounded hairline cards, pill chips; gallery with thumbnail column; sticky right rail (action card + agent card); highlights grid             | 3.1, 5.1, 7, 8.1 |
| `Travel Website Design _ Modern UI_UX Concept.jpg` | Landing, type, cards    | Full-bleed photo hero with transparent nav; sans + italic-serif headlines; pill eyebrows; image cards with white pill buttons; dark/photo/light bento; large light numerals | 3.2, 3.5, 8.1    |

---

## 3. Brand and visual language

### 3.1 Colour

Colours are **design tokens only** (defined in `src/app/globals.css` `@theme`). Hex
values are never hard-coded in components. Current tokens are the baseline.
Replacement values **[REF]** go in the "Proposed" column.

| Token        | Previous  | Role                                                      | New (ADR-071)                                   |
| ------------ | --------- | --------------------------------------------------------- | ----------------------------------------------- |
| `background` | `#ffffff` | Page ground                                               | `#ffffff`                                       |
| `surface`    | `#f2f5f4` | Cards on tinted areas, table headers, input fill          | `#f5f7f6`                                       |
| `pale`       | `#e6efee` | Subtle highlight, selected rows, info panels              | `#e8f2ef` teal mist                             |
| `primary`    | `#1b1f1e` | Headings, primary button fill                             | `#141a18` ink (buttons are now teal)            |
| `secondary`  | `#33403c` | Secondary text emphasis, icons                            | `#3b4643`                                       |
| `body`       | `#2f3733` | Body text                                                 | `#2c3431`                                       |
| `muted`      | `#5f6b66` | Captions, helper text, placeholders (≥4.5:1 on white)     | `#5f6b67`                                       |
| `line`       | `#d5dcd9` | Borders and dividers (`border-line`)                      | `#e3e8e6`                                       |
| `brand`      | `#0e4a55` | Full-bleed marketing bands only (hero, closing CTA)       | `#0f1f1c` dark card ground                      |
| `accent`     | `#b4573c` | The single warm highlight: key CTAs, active states, focus | `#0f6b5e` deep teal (+ `accent-strong #0a5148`) |
| `success`    | `#0a6640` | Approved, verified, completed                             | unchanged                                       |
| `warning`    | `#a05a00` | Pending, expiring, needs attention                        | unchanged                                       |
| `danger`     | `#c0152a` | Rejected, errors, destructive actions                     | unchanged                                       |
| `intel`      | `#0099a8` | AI/data insights (always shown with the RICS disclaimer)  | unchanged                                       |

Rules:

- Every text/background pair meets **4.5:1** (body) or **3:1** (large text, UI
  boundaries). The redesign adds a contrast table here once the colours are chosen.
- Status is never shown by colour alone. Pair it with an icon and a label.
- Each status colour also gets a tint for badge and alert backgrounds
  (`success-tint`, `warning-tint`, `danger-tint`, `info-tint`).
- **Dark mode:** **[OWNER]** decide whether it ships at launch. If yes, every token
  gets a dark value under `:root[data-theme="dark"]` and
  `prefers-color-scheme: dark`.

### 3.2 Typography

Current: **Figtree** (variable, loaded via `next/font/google`) for everything, with
display and UI type separated by weight and size. The `--font-display` token exists so
headlines can switch to a different face with a one-line change.

| Decision                  | Baseline          | Proposed [REF]                                              |
| ------------------------- | ----------------- | ----------------------------------------------------------- |
| UI / body font            | Figtree           | Figtree (kept)                                              |
| Display / headline font   | Figtree (heavier) | Figtree semibold + **Instrument Serif italic** accent words |
| Numeric / tabular figures | Figtree `tnum`    | Figtree light for large stat numerals                       |

Type scale (rem, 16 px base). Final sizes are confirmed from the references:

| Style      | Size / line-height       | Weight  | Use                                                     |
| ---------- | ------------------------ | ------- | ------------------------------------------------------- |
| Display XL | 4.5 / 1.05 (mobile 2.75) | 600     | Home hero headline                                      |
| Display L  | 3.5 / 1.1 (mobile 2.25)  | 600     | Section headlines on marketing pages                    |
| H1         | 2.25 / 1.2               | 600     | Page titles in portals                                  |
| H2         | 1.75 / 1.25              | 600     | Section titles                                          |
| H3         | 1.25 / 1.35              | 600     | Card titles, form sections                              |
| Body L     | 1.125 / 1.6              | 400     | Marketing paragraphs                                    |
| Body       | 1 / 1.6                  | 400     | Default text                                            |
| Small      | 0.875 / 1.5              | 400/500 | Helper text, table cells, metadata                      |
| Caption    | 0.75 / 1.4               | 500     | Labels, badges, overlines (uppercase, +0.06em tracking) |

Rules: at most 2 font families. Body text never smaller than 16 px on mobile (this
also stops iOS zooming into inputs). Prices and figures use tabular numerals. Line
length is 60–75 characters.

### 3.3 Spacing, radius, elevation

- **Spacing scale:** 4 px base. Use 4, 8, 12, 16, 24, 32, 48, 64, 96, 128. Sections on
  marketing pages are spaced 96–128 px apart (64 on mobile), portal content 24–32 px.
- **Radius [REF]:** small 6 px (inputs, badges), medium 10 px (cards, buttons), large
  16 px (modals, hero media), full (pills, avatars).
- **Elevation:** prefer borders (`border-line`) to shadows. Three levels: `shadow-sm`
  (hover lift), `shadow-md` (dropdowns, popovers), `shadow-lg` (modals, mobile
  drawers).

### 3.4 Imagery and iconography

- **Photography:** real UK property in natural light, before/after pairs for
  refurbishment stories. No generic stock handshakes. The hero image style follows
  `docs/marketing/hero-image-prompt.md` unless the references change it **[REF]**.
- **Property images:** 4:3 on cards, 16:9 or a mosaic on detail pages. Always use
  `next/image` with blur placeholders.
- **Icons:** one outline icon set at a 1.5 px stroke (e.g. Lucide). Sizes are 16, 20
  and 24 px.
- **Logo/wordmark:** **[OWNER]** confirm whether a new logo is part of the redesign.

### 3.5 Motion

- Durations: 150 ms (hover/press), 250 ms (dropdowns, drawers), 400–600 ms (marketing
  entrance animations only).
- Easing: `cubic-bezier(0.2, 0, 0, 1)` for entering, `cubic-bezier(0.4, 0, 1, 1)` for
  leaving.
- Respect `prefers-reduced-motion`: no parallax, no auto-scrolling marquee, and fades
  instead of slides.
- No motion inside forms, chats, pledge or offer steps beyond feedback states.

---

## 4. Layout system

| Breakpoint | Width     | Columns | Gutter | Side margin             |
| ---------- | --------- | ------- | ------ | ----------------------- |
| Mobile     | < 640     | 4       | 16     | 16                      |
| Tablet     | 640–1023  | 8       | 24     | 32                      |
| Desktop    | 1024–1439 | 12      | 24     | 48                      |
| Wide       | ≥ 1440    | 12      | 32     | auto (max content 1280) |

- Marketing content is at most 1280 px wide, and reading text at most 720 px.
- Portal layout: a fixed sidebar (264 px, collapsible to 72 px) plus fluid content up
  to 1200 px.
- Never allow horizontal page scroll. Wide tables scroll inside their own container
  or switch to cards on mobile.

---

## 5. Global chrome

### 5.1 Navbar (public)

Current state (ADR-009/016): a flush bar with the wordmark on the left, account
controls on the right and almost no navigation. The owner previously asked for the
centred links and the "Log in" link to be removed. **[OWNER]** confirm whether the
redesign brings them back.

Proposed structure **[REF]**:

```
[Logo]   Buy · Sell / List · Invest · For Agents · How it works      [Log in] [Get started ▸]
```

- _Built (ADR-071):_ a floating white pill, 64 px desktop / 56 px mobile, inset
  16 px / 12 px from the top and sides, with a soft shadow; sticky, so only the
  pill shows while scrolling. On home it floats over the hero gradient.
- **Signed in:** "Log in / Get started" is replaced by a notifications bell, a
  **portal link** ("My dashboard") and an avatar menu (Profile, Notifications
  settings, Security/MFA, Sign out). The role and KYC status show as a small pill in
  the avatar menu (`KycPill`).
- **Mobile:** logo plus a hamburger button. A full-height drawer slides in from the
  right with the nav links, a divider, the account actions, and the primary CTA pinned
  at the bottom. Tap targets are at least 44 px. Focus is trapped inside the drawer
  and Esc closes it.
- Active page is shown with an `accent` underline (2 px).
- No ads in the navbar.

### 5.2 Portal shell (signed-in roles)

Shared shell for Landlord, Agent, Investor, Buyer, Solicitor and Advertiser
(`PortalShell` and `PortalNav` today).

- **Desktop:** a left sidebar with the role's nav groups (§8.4), the user card at the
  bottom, and a top bar with the page title and breadcrumbs, global search (where
  relevant), notifications and the avatar menu.
- **Mobile:** the sidebar becomes a bottom tab bar with up to 5 key items, and the
  rest go in a "More" sheet.
- **Persistent status banner** above the content for blocking states: KYC not done,
  subscription lapsed (chat read-only), account pending or suspended. One banner at a
  time, using the most important state.

### 5.3 Admin shell

Same structure as the portal shell, but denser (compact tables, a 14 px base allowed
in data grids). The sidebar groups match the current `AdminSidebar` (Operations,
People & Verification, Commercial, System). Items marked "soon" show a muted label
and are not links. An environment badge (DEV/STAGING) shows in the top bar outside
production.

### 5.4 Footer (public)

**[REF]** final layout. Proposed:

```
[Logo + one-line mission]                 Platform        Company        Legal            Support
[Newsletter? — OWNER]                     Buy property    About          Privacy policy   Help centre
                                          List property   Contact        Terms of use     Contact us
                                          Invest          Careers?       Cookie settings  Report a concern
                                          For agents
────────────────────────────────────────────────────────────────────────────────────────────────
© 2026 PropLink UK Ltd · Company no. [OWNER] · Registered office [OWNER]       [social icons]
Risk / regulatory notice (co-investment is expression-of-interest only; not FCA-regulated advice — wording [OWNER/legal])
```

- Background `primary` or `brand` **[REF]** with white and `pale` text.
- Image credits (currently CC-BY in the footer) move to a credits line or the About
  page.
- The portal pages use a **slim footer** (one line of legal links) rather than the
  full one.

---

## 6. Interaction and UX smoothness standards

| Situation             | Standard                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Page load             | Skeleton matching the final layout, shown at once via `loading.tsx`. No full-page spinners.                                       |
| Slow action (>400 ms) | The button shows an inline spinner and its label changes ("Saving…"). It stays disabled to prevent double submits.                |
| Success               | A toast (bottom-right desktop, top mobile) that auto-dismisses after 4 s. The page updates in place.                              |
| Error (form)          | Inline under the field, plus a summary at the top of the form linked to each field. The user's input is never cleared.            |
| Error (system)        | A friendly message, a retry button and a reference ID. Never a raw stack trace.                                                   |
| Empty state           | Illustration or icon, one sentence explaining it, one action ("List your first property").                                        |
| Destructive action    | An in-page confirmation modal naming the thing ("Withdraw 12 Oak St?"). Never a browser `confirm()`.                              |
| Long forms            | Split into steps with a progress bar. Drafts autosave every few seconds, with a "Saved" indicator.                                |
| Navigation            | Prefetch links; keep scroll position on back navigation; keep filters in the URL.                                                 |
| Images                | Lazy-loaded with blur placeholders and fixed aspect ratios, so the layout doesn't shift.                                          |
| Forms                 | Labels above the fields (never placeholder-only), correct `inputmode`/`autocomplete`, show/hide password, UK postcode formatting. |
| Sessions              | Warn 2 minutes before session expiry. MFA re-authentication opens in a modal and the user keeps their place.                      |

Performance budget: LCP < 2.5 s, CLS < 0.1, INP < 200 ms on mid-range mobile over 4G.

---

## 7. Component library

Built once in `src/components/ui/`, previewed at `/dev/ui`, and used everywhere.

- **Buttons:** primary (filled `primary`, or `accent` for the main marketing CTA),
  secondary (outline), tertiary (text), destructive, icon-only. Sizes are sm, md and
  lg. All have hover, focus (2 px `accent` ring with offset), active, disabled and
  loading states.
- **Inputs:** text, email, password (show/hide), number/currency (£, pence handled
  internally), postcode, textarea with counter, select, combobox/autocomplete,
  checkbox, radio cards (used for role choice), toggle, date/time-slot picker, and a
  file upload dropzone (with progress → scanning → ready/rejected states for the
  secure pipeline).
- **Feedback:** toast, inline alert (info/success/warning/danger), banner, status
  badge, progress bar, stepper, skeleton, spinner.
- **Overlays:** modal, drawer/sheet, popover, tooltip, dropdown menu.
- **Data:** table (sortable, sticky header, row actions, turns into cards on mobile),
  description list, stat tile, timeline/activity feed, pagination, tabs, accordion.
- **Domain:** `PropertyCard`, `PropertyGallery`, `EpcBadge` (required on every
  listing), `DistressTag` chip, `VerifiedTick`, `KycPill`, `RatingStars`,
  `ProposalCompareTable`, `PledgeCalculator`, `DealTracker`, `ChatThread`,
  `SponsoredSlot`, `RicsDisclaimer`, `RiskNotice`.

---

## 8. Pages

Each entry covers the page's purpose, its sections in order from top to bottom, and
any notes. Routes match `src/app`. Pages that later phases will add are marked
(P2)–(P6).

### 8.1 Public / marketing

**Home `/`**

1. **Hero** — _built (ADR-071):_ teal-mist gradient fading to white, copy left and
   dot-matrix UK map with pulsing listing pins right, live stats card at the foot. Original brief: headline
   ("Redefining distressed property investment" or new copy **[OWNER]**), a
   sub-headline, two CTAs (primary: "Get started"; secondary: "How it works"), and a
   hero image or render.
2. **Audience split:** four cards (Landlords · Agents · Investors · Buyers). Each says
   what that audience gets and links to their path.
3. **How it works:** a 4-step horizontal pipeline (Landlord lists privately → Agent
   wins the mandate → Investors fund the works → Buyers purchase the finished home).
   It becomes a vertical timeline on mobile.
4. **Category tiles / featured properties:** distress categories (current
   `CategoryTiles`) or a carousel of for-sale listings with EPC badges.
5. **Trust and stats:** the metrics strip (`HeroStats`) plus trust signals (KYC
   verified, solicitor-managed funds, private listings). Numbers are shown only once
   real data exists.
6. **Platform ecosystem:** the current marquee or a static grid **[REF]**. It pauses
   on hover and when reduced motion is on.
7. **Testimonials / case studies** (after Phase 5 reviews exist; hidden until then).
8. **FAQ** accordion.
9. **Closing CTA band** (`brand`).
10. Footer.

**Marketplace search `/marketplace`** (Phase 5 Rightmove-style redesign)

- A sticky search bar (location, price, beds, type) with a "Filters" button that opens
  a drawer (mobile) or side panel (desktop).
- A results header showing the count, sort, a list/map toggle and "Save search" (P5).
- Results: a grid of cards (1 col mobile, 2 tablet, 3 desktop), or a split list and map
  on desktop.
- Pagination or "Load more". Filters stay in the URL.
- Sponsored slots only in fixed designated positions (e.g. after result 6), always
  labelled **Sponsored**. They never interrupt filters (P6 rules).

**Property detail `/marketplace/[id]`**

1. Breadcrumbs, then a gallery (mosaic with full-screen lightbox, swipe on mobile)
2. Title, address, price, key facts row (beds, baths, type, tenure, size), and the
   **EPC badge**
3. Sticky action card on the right (bottom bar on mobile): Save, Enquire, Book viewing
   (P5), Make offer (P5, Buyer only)
4. Tabs or sections: Description · Features · Floorplan · Map & nearby (P5) · Price
   history · Documents
5. Agent card (name, verified tick, rating, contact)
6. AG-6 legal-responsibility notice, plus a RICS disclaimer on any AI valuation
7. Similar properties

**Agent public profile `/agents/[id]`:** a header (photo, company, verified tick,
rating), stats (computed track record), case studies, reviews (P5) and active
listings.

**Public user profile `/u/[publicId]`:** an anonymous public ID. Investors are private
by default, so only the fields they choose to show appear.

**How it works / For Landlords / For Agents / For Investors** (new marketing pages
**[OWNER]**): a hero, a benefit grid, the steps, FAQ and a CTA. Investor copy follows
financial-promotion rules while `FINANCIAL_PROMOTIONS_REVIEWED=false`: no returns,
ROI or profit claims.

**Legal `/privacy`, `/terms`:** a readable long-form layout with a sticky table of
contents on desktop and a 720 px text column.

**System pages:** `/403`, 404, 500 and maintenance. Each has a friendly illustration,
a short explanation and links home or to the portal.

### 8.2 Auth pages

A shared **AuthShell** layout **[REF]**. _Built (2026-11-19, owner request):_ no
image panel. The logo sits centred at the top, the form is one centred white card
(max 448 px; 576 px for sign-up, with name and email side by side) on a gradient
mesh with a hairline grid that fades out behind the card (`auth-ground` /
`auth-grid`), and the EOI notice sits below the card. Pages must not scroll on a
laptop screen (down to 1280×720). Same layout on mobile. (The earlier split
screen with a photo card on the right was dropped.)

| Page             | Route              | Content                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Log in           | `/login`           | Email, password (show/hide), "Forgot password?", primary "Log in", link to sign up. Error messages never reveal whether an account exists.                                                                                                                                                                                                                           |
| Sign up          | `/register`        | **Step 1:** choose a role with large radio cards (Landlord · Investor · Buyer), each with an icon and one-line hint. Agents join by invite, so a note links to "Are you an agent?". **Step 2 (Investor only):** subtype (Flipper / Syndicate / Both). **Step 3:** name, email, password with a live strength meter, and terms consent. Progress dots across the top. |
| Check your email | `/check-email`     | Illustration, "We sent a link to x@…", resend button with a cooldown timer, "wrong email?" link.                                                                                                                                                                                                                                                                     |
| Email confirm    | `/auth/confirm`    | Processing state, then success with a redirect to the portal, or an expired-link state with a resend option.                                                                                                                                                                                                                                                         |
| Forgot password  | `/forgot-password` | Email field, then the same neutral confirmation shown for any address.                                                                                                                                                                                                                                                                                               |
| Reset password   | `/reset-password`  | New password plus confirmation, strength meter, success toast, then a redirect to log in.                                                                                                                                                                                                                                                                            |
| MFA              | `/mfa`             | Setup: QR code, manual key, 6-digit code input (auto-advance, paste support), recovery codes with download/copy and an "I saved these" checkbox. Challenge: code input plus a "Use a recovery code" link.                                                                                                                                                            |
| Agent invite     | `/invite/agent`    | Invitation details (who invited them, expiry), then account creation.                                                                                                                                                                                                                                                                                                |
| Account pending  | `/account-pending` | Status explanation, what happens next, contact support.                                                                                                                                                                                                                                                                                                              |
| Admin login      | `/admin/login`     | Plain, unbranded variant with MFA required. Not linked from public pages.                                                                                                                                                                                                                                                                                            |

### 8.3 Shared signed-in pages

- **Profile `/account/profile`:** avatar upload, details, visibility controls
  (investors), and a verification status card.
- **Notifications `/account/notifications`:** a grouped toggle list (in-app / email)
  per event in the Q12 chain.
- **Security** (proposed `/account/security`): password, MFA, active sessions.
- **Billing** (P3, Agents and Investors only): plan card, and Manage → Stripe Customer
  Portal. Landlords and Buyers never see billing UI.
- **Messages** (P3): a two-pane chat (thread list + conversation; single pane on
  mobile). Shows pending/authorised/read-only states, attachments with scan status,
  read receipts, and a report button. **No ads.**

### 8.4 Role portals (sidebar items)

| Role                     | Sidebar                                                                                                                          | Key pages                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Landlord** (P2)        | Overview · My properties · Proposals · Mandate · Projects (P4) · Messages · Profile                                              | Listing wizard with the AI description assistant (shows AI draft → user edits), side-by-side proposal comparison, mandate status timeline |
| **Agent** `/agent`       | Overview · Private marketplace (P2) · My mandates · Listings · Leads · Projects (P4) · Messages · Company · Profile · Billing    | Proposal form (valuation, terms, fee, pitch), existing listing wizard (Address → Details → Distress → Media → Review), leads table        |
| **Investor** `/investor` | Overview · Browse projects (P4) · My pledges · Saved · Syndicates · Verify identity (KYC) · Messages · Billing                   | Project detail, pledge calculator (EOI wording, risk notice, KYC gate), agreement signing status, ledger and statements                   |
| **Buyer** `/buy`         | Overview · Saved · Enquiries · Viewings · Offers · Messages                                                                      | Deal tracker, offer history with statuses, viewing slots                                                                                  |
| **Solicitor** (P4)       | Project overview · Documents · Agreements · Funds status · Ledger · Settlement                                                   | Project-scoped. Shows a clear "Access ends when the project closes" notice                                                                |
| **Advertiser** (P6)      | Campaigns · Apply for placement · Performance                                                                                    | Creative upload with preview inside the real slot                                                                                         |
| **Admin** `/admin`       | Overview · Review queues · Deals & chats · People · Support & compliance · Revenue & marketing · System & settings (collapsible) | Queues with SLA timers, claim/assign, bulk actions, audit trail panels                                                                    |

**Dashboard pattern (every role):** a greeting with any required action ("Finish
identity check"), a stat row (3–4 tiles), the role's main list (e.g. My properties),
an activity feed, and a help card.

_Built — investor portal (2026-11-19):_ photo-banner masthead
(`public/banners/investor portal banner.png`) like the buyer portal; the dashboard
opens with an identity-check card (status, three-step progress, CTA) beside a
teal-mist "How investing works here" EOI card, then a single-card stat strip, pledge
cards with funding bars, and icon shortcut cards. Syndicate Deals and Identity &
Verification use the same cards and serif-tail section headings.

_Built — landlord portal (2026-11-19):_ photo-banner masthead
(`public/banners/landloard portal banner.png`); the overview opens with the
identity-check card (status, four steps: account → identity → list a property →
agents see it, Verify CTA) beside a "Private by design" card, then the stat strip,
listing cards and shortcuts. My properties is a rounded table with status pills;
List a property pairs the form with a "What happens next" panel; the listing page
uses tone notices, a carded form with card-style radio choices, a dashed upload
panel and a teal-mist submit checklist. Later-phase pages follow suit: Projects as cards; a project page with a
lifecycle card, figures strip and carded works / settlement / agreement sections;
Proposals with a mandate card and the side-by-side table in a rounded card (accent
pill to choose, red-outline decline and terminate); the AI assistant as a teal-mist
disclosure inside the listing form.

_Built — agent portal (2026-11-19):_ photo-banner masthead
(`public/banners/agent banner.png`) with the agency name (or the profile switcher)
as a pill on the band. The dashboard opens with warning-tone prompts for account
confirmation and the company check, then the stat strip (live, awaiting review,
drafts, new leads), a latest-leads card with status pills beside a teal-mist
"Verified record" card, and shortcuts to landlord listings, mandates and investor
projects. Listings, leads, offers, landlord listings, mandates, projects, profile,
company and confirm pages use the same cards, pills, serif-tail headings and the
landlord form styles (`src/app/landlord/listings/ui.ts`). Design only: no
behaviour changed.

---

## 9. Compliance-driven UI rules (from AGENTS.md and the business PDFs)

These rules are non-negotiable in every design:

- **EPC rating is displayed on every listing**, in cards and on detail pages.
- **RICS disclaimer** on every AI valuation or planning output.
- **No investment payment UI.** Pledges are labelled _Expression of Interest_ until
  signed. There is no "Pay" or "Invest now" with a card form. The copy says funds move
  via the solicitor outside the app.
- While `FINANCIAL_PROMOTIONS_REVIEWED=false`, public and marketing surfaces show no
  ROI, profit or returns figures. Designs include the "hidden" variant of every
  screen that has them.
- **KYC gate** is shown visibly (lock state and CTA) on pledge actions and sensitive
  documents.
- **Advertising:** fixed slots only, always labelled **Sponsored**, no pop-ups. Never
  in chat, search filters, pledge or offer steps.
- **Private listings** never appear on public pages. Landlord personal details are
  hidden by default.
- A cookie banner (current `CookieBanner`) with equal-weight Accept and Reject
  buttons.

---

## 10. Content and tone

Plain UK English. Short sentences, active voice, sentence-case headings. Money is
shown as `£250,000` (no pence on large figures) and dates as `18 Nov 2026`. Error
messages say what happened and what to do next.

## 11. Accessibility

WCAG 2.2 AA: the contrast ratios in §3.1, a visible focus ring everywhere, full
keyboard navigation, skip-to-content link, semantic landmarks, labels on every input,
`aria-live` for toasts and form errors, alt text on all property photos, 44 px touch
targets, no information conveyed by colour alone, captions on any video, and
reduced-motion support.

## 12. Implementation plan

1. Owner approves this spec after the references are reviewed → ADR "Website
   redesign" is written.
2. Update the tokens in `globals.css` and `ARCHITECTURE.md §Design tokens`; update
   `/dev/ui` with the component library.
3. Rebuild the global chrome (navbar, footer, portal/admin shells).
4. Rebuild the public pages (home, marketplace, property detail), then the auth
   pages.
5. Restyle the existing portals, then build Phase 2–7 pages directly in the new
   design.
6. Add a Playwright visual-regression baseline for the key pages, and run an
   accessibility check (axe) in CI.

## 13. Open questions

| #   | Question                                                                                                             | Owner       |
| --- | -------------------------------------------------------------------------------------------------------------------- | ----------- |
| D1  | ~~Bring back public nav links and "Log in"?~~ **Done** — owner asked for a navbar matching the references (ADR-071). | Resolved    |
| D2  | New logo/wordmark as part of the redesign?                                                                           | OWNER       |
| D3  | Dark mode at launch?                                                                                                 | OWNER       |
| D4  | ~~Font pairing~~ **Done** — Figtree + Instrument Serif italic accent (ADR-071).                                      | Resolved    |
| D5  | New audience marketing pages (How it works, For Landlords/Agents/Investors)?                                         | OWNER       |
| D6  | Newsletter signup in the footer?                                                                                     | OWNER       |
| D7  | Company number, registered office and regulatory wording for the footer                                              | OWNER/legal |
