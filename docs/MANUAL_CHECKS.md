# Manual checks (owner)

> Living list of every check that needs a person, real credentials or an
> owner decision. Agreed 2026-11-18: the owner does them **all at the end,
> after the last phase**; phases are built and automatically tested
> meanwhile, but none is closed or merged to `main` until its checks pass.
> Each phase adds its items here when its build finishes. Tick items as they
> pass and note the date. Details for each phase are in
> `docs/phases/PHASE-N-REPORT.md`.

**Merge order once checks pass:** PR #1 (Phases 0-1) → Phase 2
(`phase-2-landlord-pipeline`) → each later phase in turn. Each branch builds
on the one before.

## How to run them

- Use the development app (`npm run dev`, <http://localhost:3000>) with the
  matching branch checked out and migrations applied (`npx prisma migrate
deploy`).
- Emails in development appear at <http://localhost:3000/dev/mail>.
- Seeded accounts: `admin@`, `agent@`, `investor@`, `buyer@proplink.test`,
  password `Password123!`. Admin sign-in needs your authenticator app.
- If a check fails, note what you saw; it is fixed on the branch it belongs to
  and the later branches are updated.

## Phase 1 — Roles, access, invites, verification, profiles

- [ ] **Agent invite with the company step.** As Admin, invite an Agent at
      `/admin/agents/invites`; open the link from `/dev/mail`; search "PROPLINK
      DEMO" in "Your company", confirm, set a password. Expect: the Agent
      lands on `/agent`, and `/agent/company` shows "Verified".
- [ ] **Company check and override.** As that Agent, check a dissolved company
      (`87654321`); as Admin at `/admin/agents/companies`, approve or reject it
      with a reason. Expect: status changes and an audit entry.
- [ ] **Existing-agent confirmation.** As Admin at `/admin/agents/migration`,
      notify an existing Agent; as that Agent, confirm at `/agent/confirm`; as
      Admin, authorise. Expect: the Agent keeps working without re-verifying.
- [ ] **Admin needs MFA.** Sign in at `/admin/login`: you must set up or use
      your authenticator before any `/admin` page opens.
- [ ] **With real credentials (when you have them):** Companies House live
      smoke test (`scripts/smoke-companies-house.mjs`); real ClamAV upload test
      (`docs/credentials/malware-scanning.md`); Sumsub sandbox verification
      (`docs/credentials/kyc-provider.md`, OD-20).

## Phase 2 — Landlord listings, review queue, marketplace, mandates

You need a Landlord account: register one at `/register` (choose Landlord)
and complete the mock identity check at `/verify`.

- [ ] **Review queue with two Admin accounts.** As the Landlord, create a
      listing with an ownership document and submit it. Admin A claims it at
      `/admin/landlord-listings`; Admin B sees "held by" and takes over; reject
      with a reason. Expect: the Landlord sees the reason and gets an email.
      Edit, resubmit, approve. Expect: the SLA badge and metrics update, and
      verified Agents get a "New private property" email.
- [ ] **Marketplace and proposals.** As `agent@`, open "Landlord listings",
      send a proposal. As the Landlord, open "Compare proposals", ask a
      question; as the Agent, answer it.
- [ ] **Mandate.** As the Landlord, "Choose this agent". As the Agent, open
      "Mandates" and accept; the Landlord's name and documents appear. Tick
      what investors will see. Terminate with a reason. Expect: the listing
      leaves the marketplace while the mandate is live and returns after,
      with emails at each step.
- [ ] **Admin leakage check.** As Admin, open the review page of an approved
      listing, then confirm none of its text appears on public pages
      (the automated crawl covers every other role).
- [ ] **AI assistant (needs `ANTHROPIC_API_KEY`).** Follow the smoke test in
      `docs/credentials/anthropic.md`.

## Decisions waiting for you

- [ ] **OD-23:** what Agents see before a mandate (property, address, photos;
      never the Landlord) and during one (name and documents). Confirm or
      change.
- [ ] **KYC results by email:** today they show only in the portal
      (`verification.decision` has no email). Email them too?
- [ ] **Landlord's name to investors:** may an Agent show it without the
      Landlord agreeing? (Default: hidden; ADR-040.)
- [ ] Earlier open decisions: `docs/OPEN_DECISIONS.md` (OD-18 service-role key,
      OD-20 KYC provider, and the rest).

## Phase 3 — Subscriptions, chat authorisation, realtime messaging

- [ ] **Chat end to end.** As `agent@` (subscribed, see above) send a proposal
      on an approved listing. As Admin at `/admin/chats`, tick it and
      "Authorise selected". As the Landlord and the Agent, open `/messages`
      in two browsers and chat; the page should say "Live" (Realtime) and
      messages appear within a second. Attach a PDF. Report the chat; as Admin
      read it (give a reason) and resolve the report. As a Buyer, open the
      chat's URL: you should get "not found".
- [ ] **Read-only on lapse.** In mock billing choose "Cancel now" for the Agent:
      the chat becomes read-only for both; subscribe again and it reopens.
- [ ] **Supabase Realtime setting.** Project Settings → Realtime: "Allow public
      access" is off (`docs/credentials/supabase.md`).
- [ ] **Buyer enquiry.** As `buyer@`, message an agent from a live listing;
      the agent replies from `/messages`.
- [ ] **EICAR via chat (needs real ClamAV).** Attaching the EICAR test file is
      refused with a clear message.

- [ ] **Subscriptions with the mock provider.** As Admin at `/admin/billing`,
      set Agent prices (monthly and yearly). As `agent@`, open Billing,
      subscribe monthly, press "Pay (test)": status becomes Active. Use
      "Manage billing" → "Renewal payment fails": the status shows the grace
      date and an email arrives; "Renewal succeeds" restores it; "Cancel now"
      makes it not active. As a Landlord or Buyer, `/account/billing` is a 404.
- [ ] **Stripe test mode (needs keys, `docs/credentials/stripe.md`).** Set
      `STRIPE_PROVIDER=stripe`, run `stripe listen --forward-to
localhost:3000/api/webhooks/stripe`, set a price as Admin, subscribe with
      card 4242 4242 4242 4242, then use the Customer Portal to cancel.

## Phase 4 — Investor projects, pledges, Solicitor, agreements, ledger

- [ ] **Publish and Lead.** As `agent@` with an active mandate: Mandates →
      tick what investors see → "Publish to investors"; fill the terms and
      publish. As a KYC-approved, subscribed investor, open Projects, check
      the property shows only what was ticked (no landlord name or street by
      default) and press "I'm interested". As the Agent, nominate that
      investor as Lead; as the investor, accept; as Admin at
      `/admin/projects`, approve. The project shows "Open for investment" and
      the investor sees "You are this project's Lead Investor".
- [ ] **Admin publishes for an Agent.** At `/admin/projects` → "Publish for an
      Agent"; the project belongs to the Agent and the audit log records it.
- [ ] **Documents before KYC.** With "Other documents" ticked on the mandate,
      an investor without approved KYC sees "Documents are available once…"
      and no links; after KYC approval the links appear.

- [ ] **Pledge calculator.** On an open project, type amounts: the share and
      the amount left update as you type; below the minimum or above what
      remains shows the reason and disables the button. Pledge; the page
      shows your pledge, share and "expression of interest". Cancel it and
      the funding bar goes back. Pledge the exact remaining amount: the
      project shows "Funded".

- [ ] **Portal extras.** Save a project (★), tick "Saved only"; tick two
      projects and "Compare selected". As an interested investor ask a
      question; as the Agent answer it; another interested investor sees it
      as "An investor". As Admin hide it with a reason.
- [ ] **Project chats.** As an interested investor press "Message the agent";
      as Admin authorise it at `/admin/chats`; chat both ways. Withdraw
      interest: the investor loses the chat, the Agent keeps the history. As
      the Lead, message "Investor 1"; names show as roles.
- [ ] **Landlord project view.** As the Landlord of a published listing open
      Projects: lifecycle and status only, no investor names or amounts.

- [ ] **Solicitor account (needs the service-role key, OD-18).** As Admin on
      a project page, "Invite the Solicitor" with a new email; open the link
      from the email (or the development link), set a password, set up the
      authenticator at `/mfa`, and land on `/solicitor` showing only that
      project and its pledges. As Admin "Close account": the Solicitor then
      sees "No active project". Try the old invitation link: refused.

- [ ] **Agreement with the mock provider.** With a fully pledged project and
      its Solicitor: on `/solicitor` upload a PDF, fill the loss allocation and
      "Prepare draft"; check the shares (they add up to 100%) and "Send for
      signature". As each party (Lead, co-investor, Agent) open the project,
      press "Sign the agreement" and "Sign" on the mock page. The agreement
      shows "Signed", a "Signed agreement (PDF)" link and its SHA-256; the
      investors' pledges show "binding" and can no longer be cancelled.
- [ ] **Re-issue (Q44).** Send another agreement and "Decline" as one party;
      as Admin on the project page press "Re-issue and send fresh".
- [ ] **Dropbox Sign live smoke test (needs keys, OD-24).** Follow
      `docs/credentials/esignature.md` → "Live smoke test".

- [ ] **Works.** With a signed agreement: as the Agent "Start works", add and
      complete a milestone, record a cost and void one. As the Solicitor
      record funds received for a pledge and record a budget change; as the
      Lead approve it. The co-investor sees their funds status, the costs
      and the change; the Landlord sees milestones, costs and only updates
      addressed to them.

- [ ] **Sale and settlement.** On a listed-for-sale project, as the Agent
      "Record the sale"; as the Solicitor "Confirm the sale" and "Record
      settlement". Each investor sees their capital returned and profit share
      and downloads their statement (PDF); the shares match the agreement.
      As the Solicitor propose a correction; as Admin approve it: the
      original entry stays and the adjustment appears; the investor gets an
      email.

- [ ] **Deadline shortfall.** On a project past its deadline (Admin's
      "Past the funding deadline" list), as the Agent extend the deadline;
      on another, close it: pledges show "released", the project "Closed",
      its chats end.

## Phase 5 — Final sale, buyer experience, reviews, trust

- [ ] **Re-list and sell (criterion 5).** On a completed project, as the
      Agent "List for sale"; as Admin approve it in the listing moderation
      queue; it appears on `/marketplace` with the responsibility notice. As
      the Agent "Record the sale": the listing shows Sold. As the Solicitor
      confirm and settle.

- [ ] **Offers and viewings.** As `buyer@` make an offer and book a viewing
      on a live listing. As the listing's Agent at "Offers & viewings":
      counter the offer; as the Buyer accept the counter (listing goes Under
      offer, the deal tracker appears). Confirm the viewing; as the Buyer ask
      for a new time; confirm again. As `investor@`, the offer and viewing
      buttons are refused.
- [ ] **Buyer journey on a phone.** Search, open a listing, save it (sign in
      returns you to it), enquire, book a viewing, make an offer.

- [ ] **Reviews.** On a sold project, as the Co-Investor open "Reviews":
      the Agent and the Lead Investor are offered; as the Lead only the
      Agent. Send one; it says an Admin checks it first. As Admin at
      Reviews, reject one (needs a reason) and publish another. The
      published one appears on the person's profile and the agency page,
      reviewer shown by role only. As the Agent, reply once. As another
      member, report it; as Admin, hide it from the report. A Landlord sees
      nothing to review until the mandate is closed.
- [ ] **Badges and stars on listing cards.** Award the verified badge to a
      listing's Agent at Verified Badges: the badge appears on that Agent's
      cards in search; revoke it and it goes. Stars appear only after a
      review is published.

- [ ] **Track record.** Open the Agent's and the Lead Investor's profiles
      after a sold project: completed projects, average completion time and
      success rate show real figures; nobody can edit them. At Admin →
      Track Record, turn historical ROI on: it still does not appear on
      profiles while the financial promotions review is incomplete.

- [ ] **Saved searches and alerts.** As `buyer@` search, "Save this search",
      then under Saved turn alerts on (a sixth alerting search is refused).
      Once `CRON_SECRET` is set (H5.5), publish a matching listing and run
      the job (or wait for 07:00 UTC): one email arrives with the listing
      and a "Stop these alerts" link; opening the link changes nothing until
      you press the button; afterwards alerts show off.
- [ ] **Maps keys** (when H2.2 is done). Set `MAPS_PROVIDER=google` with both
      keys: listing pages show real maps; the browser key is refused from
      another site.

- [ ] **Public SEO.** Open `/sitemap.xml`: only the home page, the
      marketplace and for-sale listings; no sold, draft or private pages.
      `/robots.txt` points at it. On a for-sale listing, view source: one
      JSON-LD block with town, postcode district and price, no street
      address. Run the listing through Google's Rich Results Test once
      deployed.

- [ ] **Admin re-list.** On a completed project's Admin page, "List for sale":
      the listing appears under the project Agent's agency, waiting for
      review; the audit log shows the Admin.
- [ ] **Sign in to save.** Signed out, open a listing and press "Sign in to
      save": after signing in you are back on the same listing.
- [ ] **Screen reader spot check.** With NVDA or VoiceOver, use search, a
      listing page and "Reviews": headings, buttons and star ratings are
      announced sensibly (automated axe checks already pass).

- [ ] **Admin permissions (Phase 6).** With two super-admin accounts: as
      super-admin A, at Admin Roles request "Grant review moderation" for a
      third Admin; A cannot approve it; as super-admin B approve it. Sign in
      as the third Admin: the sidebar shows only the overview and Reviews;
      opening `/admin/kyc` returns to the overview with a "does not have the
      verification permission" notice. Revoke it the same way.
- [ ] **Financial adjustments.** An Admin without the financial adjustments
      permission cannot approve a Solicitor's ledger correction.

- [ ] **Cases.** As `buyer@` report a listing ("Report this listing"); as
      another member report the same listing: one case with two reports at
      Admin → Cases. Assign it to yourself, add a note and an evidence link,
      resolve with a resolution, close it. Report a chat and a review: each
      opens a case. A chat case's link asks for a reason before showing the
      chat.
- [ ] **Data requests.** At Admin → Data Requests record a request for
      `buyer@`; you cannot approve your own; a second case manager
      approves; the JSON downloads (account, messages, offers, viewings…).

- [ ] **Advertising.** Apply at `/advertise` as a business. As Admin at
      Advertising approve it, create a text campaign for the Agent dashboard
      and approve it: as `agent@` the dashboard shows it labelled Sponsored;
      the link opens the advertiser's site in a new tab. Search, listing
      pages, messages, offers and project pages never show an ad. Pause it:
      it disappears. An image banner needs an image that passes the scan.

- [ ] **Admin system pages.** At Admin → KPIs & System: queue sizes and
      ages look right. Integrations health lists each provider as live,
      mock or off and names missing settings, with no secret values
      anywhere on the page (view source). Sign in with a wrong password a
      few times: Security events shows the failed sign-ins.

- [ ] **Agencies.** At Admin → Agencies: Agents of the same company appear
      together. Suspend an agency with a reason: its listings leave search
      and its profiles show suspended; reactivate it.
- [ ] **Admin on a phone and with a screen reader.** Open a few Admin pages
      on a phone (no sideways scrolling) and with NVDA or VoiceOver
      (headings, dropdowns and buttons are announced).

## Later phases

Each phase adds its section here when its build is complete.

## Phase 7 — Hardening

- [ ] **Account erasure (Phase 7).** As a Buyer with no open offers, delete
      the account at the bottom of `/account/profile`: you are signed out, signing in no
      longer reaches any data, and Admin → Users shows "Erased User". As an
      Agent with an active mandate, try the same: it is refused and the
      reason names the mandate.
- [ ] **Admin erasure request.** At Admin → Data Requests record an
      "Erasure" request for a member; you cannot approve your own; a second
      Admin approves it: the member is erased and the request shows the
      erased date, with no download link. A request for a member with an
      open project is refused with the reason.
- [ ] **Retention job.** After deployment, call `/api/jobs/retention` with
      the cron secret (or wait for 03:30 UTC): the response lists the counts
      deleted; without the secret it is refused.
- [ ] **Owner decisions OD-27 to OD-32.** (a) A newly notified existing
      Agent sees "wait for PropLink to authorise it" on Landlord listings until
      you authorise them at Admin → Agents → Migration. (b) When an Agent
      accepts a mandate, the other agents' chats on that listing close. (c) As
      the Lead Investor on a funded, signed project, "Start works" and "Mark
      works complete" are on your project page; the Agent sees that the Lead
      decides. (d) Recording "Release pledges" or "Close the project" needs
      the "consulted and agreed" box. (e) After deployment, the mandates job
      runs daily (reminders 7 days before a mandate ends; ends it after).
- [ ] **Health check and delivery panel.** Open `/api/health` signed out: it
      shows `"status":"ok"` and nothing else about the system. At Admin →
      KPIs & System the "Emails and alerts" and "Webhooks received" panels
      show counts; a failed email shows in red.
- [ ] **Real phone and Safari.** On an iPhone (Safari) and an Android phone
      (Chrome): sign in as `buyer@`, search, open a listing, save it; as
      `investor@`, open a project. Nothing needs sideways scrolling and the
      KYC pill in the dark header is readable. (Automated: Pixel 7 size and
      the WebKit engine, not a real device.)
- [ ] **Keyboard only.** Without a mouse, sign in, use search filters, open
      a listing, and as an Admin approve a listing in the Review Studio: focus
      is always visible, the approve and reject windows can be completed and
      closed, and wide tables can be scrolled after tabbing to them.
