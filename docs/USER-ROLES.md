# PropLink user roles and permissions

> Last verified against commit `15d2b3dda4b9937b7aa221c6701a5f093c586209` on 2026-10-07.
>
> This audit describes the repository working tree at that commit baseline, including the
> uncommitted Supabase-auth/RLS work present on the verification date. “Built” means there is
> a reachable page, route or server action backed by implemented service code. A schema model
> or RLS policy alone does not make a user-facing feature built.

## Table of contents

- [Role model at a glance](#role-model-at-a-glance)
- [Agent](#agent)
- [Investor](#investor)
- [Normal user (Buyer)](#normal-user-buyer)
- [Admin](#admin)
- [Anonymous visitor](#anonymous-visitor)
- [Permissions matrix](#permissions-matrix)
- [Role-to-role interactions](#role-to-role-interactions)
- [Typical journeys](#typical-journeys)
- [Where permissions are enforced](#where-permissions-are-enforced)
- [Enforcement gaps and inconsistencies](#enforcement-gaps-and-inconsistencies)
- [Open questions](#open-questions)

## Role model at a glance

PropLink has exactly four application role values: `AGENT`, `INVESTOR`, `BUYER`, and
`ADMIN`. There is no `SELLER`, `LANDLORD`, investor subtype, investor tier, accredited
investor flag, or retail-investor flag in the role enum
([`prisma/schema.prisma:15-20`](../prisma/schema.prisma#L15-L20)). The product context calls
agents the supply side, investors the capital side, buyers the demand side, and admins the
governance role ([`docs/CONTEXT.md:17-23`](CONTEXT.md#L17-L23)).

The three public signup choices are Buyer, Investor, and Agent; Admin is not offered
([`src/app/(auth)/register/page.tsx:20-30`](<../src/app/(auth)/register/page.tsx#L20-L30>)).
The signup page selects one of three server-authored actions and deliberately omits the role
from the submitted object ([`src/app/(auth)/register/page.tsx:44-58`](<../src/app/(auth)/register/page.tsx#L44-L58>)).
The server creates a short-lived signup intent containing only one of those three roles
([`src/services/auth/supabaseAuthService.ts:66-90`](../src/services/auth/supabaseAuthService.ts#L66-L90));
the database trigger uses that private intent, defaults an unrecognised/direct signup to
`BUYER`, and cannot create `ADMIN`
([`prisma/migrations/20261007020000_phase4_supabase_email_auth/migration.sql:43-92`](../prisma/migrations/20261007020000_phase4_supabase_email_auth/migration.sql#L43-L92)).

### Are there two investor types?

**No—two investor types are not implemented or modelled.** There is one `INVESTOR` role,
one account-level `KycStatus` (`NOT_STARTED`, `PENDING`, `APPROVED`, or `REJECTED`), and one
syndicate pledge model; none is an investor subtype
([`prisma/schema.prisma:15-27`](../prisma/schema.prisma#L15-L27),
[`prisma/schema.prisma:321-335`](../prisma/schema.prisma#L321-L335)). `SubscriptionTier`
(`STARTER`, `PRO`, `ELITE`) belongs to an **agent** subscription, not to an investor
([`prisma/schema.prisma:96-100`](../prisma/schema.prisma#L96-L100),
[`prisma/schema.prisma:445-455`](../prisma/schema.prisma#L445-L455)).

The closest documented distinction is not between two investors but between:

1. a **Buyer/retail solo-purchase journey**, where one person enquires, views, offers, and
   purchases; and
2. an **Investor syndicate journey**, where multiple investors pool commitments and share
   the project outcome.

The master document explicitly labels these as separate buyer and investor workflows
([`docs/PropLink_UK_Master_Document.md:97-111`](PropLink_UK_Master_Document.md#L97-L111)).
It also describes “Join Syndicate” and “Solo Purchase” as different action routes, but the
solo route maps to the Buyer role in the current code rather than to a second Investor type
([`docs/PropLink_UK_Master_Document.md:113-124`](PropLink_UK_Master_Document.md#L113-L124),
[`src/app/api/offers/route.ts:7-16`](../src/app/api/offers/route.ts#L7-L16)).

## Agent

### Purpose

An Agent supplies distressed-property stock: creating listings, disclosing defects, handling
leads, and building a public credibility record
([`docs/CONTEXT.md:17-23`](CONTEXT.md#L17-L23)). A normal Buyer cannot sell or list a
property under the current model: listing creation is restricted to `AGENT`
([`src/app/api/listings/route.ts:9-33`](../src/app/api/listings/route.ts#L9-L33)).

### Creation and verification

- **Built:** Agent is a public signup choice. Signup requires name, email, an 8–128 character
  password, and GDPR consent; Supabase email confirmation is required before `auth()` returns
  an application identity
  ([`src/services/auth/supabaseAuthService.ts:12-36`](../src/services/auth/supabaseAuthService.ts#L12-L36),
  [`src/lib/auth.ts:28-40`](../src/lib/auth.ts#L28-L40)).
- **Built:** A confirmed Supabase user is bridged to the legacy Prisma `User`; the role comes
  from the server-written profile, not client metadata
  ([`src/services/auth/supabaseAuthService.ts:102-137`](../src/services/auth/supabaseAuthService.ts#L102-L137)).
- **Built, but not self-service:** Listing work requires an active `AgentProfile` owned by the
  user. The UI tells an agent without one to contact an admin, but there is no implemented
  admin page/action that creates one
  ([`src/app/agent/profile/page.tsx:27-34`](../src/app/agent/profile/page.tsx#L27-L34),
  [`src/services/listings/listingService.ts:25-40`](../src/services/listings/listingService.ts#L25-L40)).
- **KYC:** Not required for Agent listing or lead actions. The architecture decision says KYC
  is investor-only because it gates syndicate pledges
  ([`docs/adr/ADR-016-role-portals.md:69-72`](adr/ADR-016-role-portals.md#L69-L72)).

### Pages and portal

- `/agent` — own listing counts, new leads, recent leads, and verified-deal summary
  ([`src/app/agent/page.tsx:19-43`](../src/app/agent/page.tsx#L19-L43)).
- `/agent/listings` — all listings belonging to the agent’s profiles, with views and save
  counts ([`src/app/agent/listings/page.tsx:23-35`](../src/app/agent/listings/page.tsx#L23-L35),
  [`src/app/agent/listings/page.tsx:70-101`](../src/app/agent/listings/page.tsx#L70-L101)).
- `/agent/listings/new` and `/agent/listings/[id]/edit` — create a draft and edit an owned
  draft ([`src/services/listings/listingService.ts:218-253`](../src/services/listings/listingService.ts#L218-L253),
  [`src/services/listings/listingService.ts:255-301`](../src/services/listings/listingService.ts#L255-L301)).
- `/agent/leads` — enquiries and analytics for the selected owned agency profile
  ([`src/app/agent/leads/page.tsx:15-48`](../src/app/agent/leads/page.tsx#L15-L48)).
- `/agent/profile` — own agency profiles and case-study management
  ([`src/app/agent/profile/page.tsx:9-15`](../src/app/agent/profile/page.tsx#L9-L15)).
- `/agents/[id]` — public agency profile, case studies, ratings, and completed-deal count;
  this route is public rather than Agent-only
  ([`src/app/agents/[id]/page.tsx:22-33`](../src/app/agents/[id]/page.tsx#L22-L33)).

### Actions and data access

**Listings — built/partly built**

- Create a `DRAFT`, but only under an active AgentProfile the caller owns
  ([`src/services/listings/listingService.ts:218-252`](../src/services/listings/listingService.ts#L218-L252)).
- Read all listings across their own AgentProfiles
  ([`src/services/listings/listingService.ts:143-155`](../src/services/listings/listingService.ts#L143-L155)).
- Edit only an owned listing in `DRAFT`; editing a later status is rejected
  ([`src/services/listings/listingService.ts:255-268`](../src/services/listings/listingService.ts#L255-L268)).
- Submit an owned draft for review only after required submission fields pass validation
  ([`src/services/listings/listingService.ts:304-318`](../src/services/listings/listingService.ts#L304-L318)).
- The status machine permits an Agent to move `LIVE` to `UNDER_OFFER` and then `SOLD`, but
  **no Agent route or UI invokes those transitions, so this is not implemented as a usable
  feature** ([`src/services/listings/statusMachine.ts:18-36`](../src/services/listings/statusMachine.ts#L18-L36)).
- Delete listing: **Not implemented**; there is no listing `DELETE` route, and the listing
  route for an individual listing exposes only `PATCH`
  ([`src/app/api/listings/[id]/route.ts:9-39`](../src/app/api/listings/[id]/route.ts#L9-L39)).
- Listing limits are enforced when a listing goes live: the default is three live listings,
  overridden by `Subscription.listingLimit`
  ([`src/services/listings/listingService.ts:13`](../src/services/listings/listingService.ts#L13),
  [`src/services/listings/listingService.ts:157-174`](../src/services/listings/listingService.ts#L157-L174),
  [`src/services/listings/listingService.ts:351-365`](../src/services/listings/listingService.ts#L351-L365)).

**Images — built with a provider abstraction; Supabase bucket wiring is partial**

- Agent and Admin roles may request uploads through the current upload endpoints
  ([`src/app/api/uploads/presign/route.ts:8-28`](../src/app/api/uploads/presign/route.ts#L8-L28)).
- Supabase RLS permits an Agent to create/update/delete only property-image objects under
  their auth-user folder, but current application uploads still use `StorageService`; the
  architecture calls Supabase Storage application wiring a later migration phase
  ([`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:516-552`](../prisma/migrations/20261007000000_phase3_rls_storage/migration.sql#L516-L552),
  [`docs/ARCHITECTURE.md:18`](ARCHITECTURE.md#L18)).

**Leads/enquiries — built**

- Read enquiries only for a selected AgentProfile owned by the caller; the service re-checks
  ownership rather than trusting the profile-selection cookie
  ([`src/services/enquiries/enquiryService.ts:98-127`](../src/services/enquiries/enquiryService.ts#L98-L127)).
- See the enquirer’s name, email, message, listing, and enquiry status
  ([`src/app/agent/leads/page.tsx:50-59`](../src/app/agent/leads/page.tsx#L50-L59)).
- Update only enquiries attached to listings owned by one of the Agent’s profiles; any of
  `NEW`, `RESPONDED`, and `CLOSED` can be selected
  ([`src/services/enquiries/enquiryService.ts:130-167`](../src/services/enquiries/enquiryService.ts#L130-L167)).

**Offers, viewings, deals, and chat — partly built / missing Agent side**

- Database/RLS rules allow an owning Agent to read offers, deals, and viewings for their
  properties ([`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:390-448`](../prisma/migrations/20261007000000_phase3_rls_storage/migration.sql#L390-L448)).
- **Not implemented:** there is no Agent page/API for listing, accepting, or rejecting offers;
  confirming/declining viewings; creating deals; or advancing deal stages. The only app routes
  are buyer-side `POST /api/offers` and `POST /api/viewings`
  ([`src/app/api/offers/route.ts:14-36`](../src/app/api/offers/route.ts#L14-L36),
  [`src/app/api/viewings/route.ts:12-34`](../src/app/api/viewings/route.ts#L12-L34)).
- **Not implemented correctly:** comments say the Agent can reply in chat, but `sendMessage`
  always chooses the listing Agent as recipient and rejects when sender equals that Agent;
  therefore the owning Agent cannot reply through this service
  ([`src/app/api/chat/route.ts:9-17`](../src/app/api/chat/route.ts#L9-L17),
  [`src/services/chat/chatService.ts:27-47`](../src/services/chat/chatService.ts#L27-L47)).

**Credibility profile and appraisals — built**

- Create, update, and delete case studies only under an owned AgentProfile
  ([`src/services/agents/agentProfileService.ts:110-180`](../src/services/agents/agentProfileService.ts#L110-L180)).
- Ratings and verified completed-deal counts are read-only calculated values: average appraisal
  score and count of `SOLD` listings
  ([`src/services/agents/agentProfileService.ts:46-82`](../src/services/agents/agentProfileService.ts#L46-L82)).
- Agents cannot post appraisals; only qualified Buyer/Investor accounts can
  ([`src/services/agents/agentProfileService.ts:200-231`](../src/services/agents/agentProfileService.ts#L200-L231)).

**Billing/subscription — partly built**

- The schema and live-listing-limit enforcement exist, and seed data supplies an ELITE account
  for the demo Agent ([`prisma/schema.prisma:445-455`](../prisma/schema.prisma#L445-L455),
  [`prisma/seed.ts:94-112`](../prisma/seed.ts#L94-L112)).
- Stripe checkout, webhooks, boosts, and customer billing portal: **Not implemented**; planned
  in Sprint 5 Task 5.6
  ([`docs/PropLink_Sprint_Plan_Claude_Code.md:523-528`](PropLink_Sprint_Plan_Claude_Code.md#L523-L528)).

### Restrictions

- A confirmed, active Supabase account, active legacy user, and mapped profile are required
  before the server returns a session identity
  ([`src/lib/auth.ts:28-50`](../src/lib/auth.ts#L28-L50)).
- AgentProfile ownership and active status are re-checked for listing work
  ([`src/services/listings/listingService.ts:25-60`](../src/services/listings/listingService.ts#L25-L60)).
- One Agent account may own several profiles; the active-profile cookie is only a hint and is
  checked against the caller’s owned active profiles
  ([`src/lib/activeAgentProfile.ts:1-25`](../src/lib/activeAgentProfile.ts#L1-L25),
  [`src/app/agent/actions.ts:19-32`](../src/app/agent/actions.ts#L19-L32)).
- Only Admin can approve a pending listing to `LIVE`; an Agent cannot self-publish
  ([`src/services/listings/statusMachine.ts:22-34`](../src/services/listings/statusMachine.ts#L22-L34)).

## Investor

### Purpose

An Investor is the capital-side user: search deals, pass KYC, record syndicate expressions of
interest, and eventually track refurbishment progress and the project ledger
([`docs/CONTEXT.md:17-23`](CONTEXT.md#L17-L23)). Current syndicate participation is explicitly
EOI-only: no funds are collected and a pledge is not a payment or binding commitment
([`src/app/investor/page.tsx:43-52`](../src/app/investor/page.tsx#L43-L52)).

### Creation and KYC

- **Built:** Investor is a public signup choice with the same confirmation, password, consent,
  active-account, and legacy-bridge rules as the other self-serve roles
  ([`src/app/(auth)/actions.ts:58-105`](<../src/app/(auth)/actions.ts#L58-L105>),
  [`src/lib/auth.ts:28-50`](../src/lib/auth.ts#L28-L50)).
- **Partly built:** The account stores and displays KYC status, and `requireKyc()` rejects a
  server action unless status is `APPROVED`
  ([`src/lib/authz.ts:30-51`](../src/lib/authz.ts#L30-L51),
  [`src/app/investor/page.tsx:10-27`](../src/app/investor/page.tsx#L10-L27)).
- KYC submission/provider/webhook flow: **Not implemented**; planned as `/investor/kyc` with
  Sumsub/mock service in Sprint 4 Task 4.1
  ([`docs/sprints/SPRINT-TRACKER.md:66-74`](sprints/SPRINT-TRACKER.md#L66-L74)).

### Pages and portal

- `/investor` — the only implemented Investor portal route; it shows KYC state, aggregate
  committed intent, own existing pledges, project funding progress, and own saved-property
  count ([`src/app/investor/nav.ts:3-8`](../src/app/investor/nav.ts#L3-L8),
  [`src/app/investor/page.tsx:61-109`](../src/app/investor/page.tsx#L61-L109)).
- `/marketplace` and `/marketplace/[id]` — public search/detail pages
  ([`src/app/marketplace/page.tsx:18-41`](../src/app/marketplace/page.tsx#L18-L41),
  [`src/app/marketplace/[id]/page.tsx:82-98`](../src/app/marketplace/[id]/page.tsx#L82-L98)).
- `/agents/[id]` — public Agent profile; a qualified Investor may leave one appraisal
  ([`src/app/agents/[id]/page.tsx:137-161`](../src/app/agents/[id]/page.tsx#L137-L161)).
- `/investor/kyc`, `/investor/syndicates`, individual syndicate pages, refurb console, ledger,
  and AI scout: **Not implemented**. They are planned in Sprint 4 and Sprint 5
  ([`docs/sprints/SPRINT-TRACKER.md:71-77`](sprints/SPRINT-TRACKER.md#L71-L77),
  [`docs/sprints/SPRINT-TRACKER.md:84-88`](sprints/SPRINT-TRACKER.md#L84-L88)).

### Actions and data access

**Listings/search/saves — built**

- Search and read public listings like an anonymous visitor; search contains only `LIVE` and
  `UNDER_OFFER`, while a direct detail page also permits `SOLD`
  ([`src/services/search/queryBuilder.ts:18-25`](../src/services/search/queryBuilder.ts#L18-L25),
  [`src/services/listings/listingService.ts:70-99`](../src/services/listings/listingService.ts#L70-L99)).
- Save and unsave public listings; rows are private to the Investor’s own user ID
  ([`src/app/api/listings/[id]/save/route.ts:16-44`](../src/app/api/listings/[id]/save/route.ts#L16-L44),
  [`src/services/listings/savedProperties.ts:16-48`](../src/services/listings/savedProperties.ts#L16-L48)).
- Create/edit/sell a property: **Denied**; those routes require Agent. There is no second
  “solo investor seller” permission
  ([`src/app/api/listings/route.ts:9-12`](../src/app/api/listings/route.ts#L9-L12),
  [`src/app/api/listings/[id]/route.ts:9-16`](../src/app/api/listings/[id]/route.ts#L9-L16)).

**Enquiries and appraisals — built**

- Any authenticated role, including Investor, may create an enquiry on a public listing; the
  sender comes from the server session
  ([`src/app/api/enquiries/route.ts:8-35`](../src/app/api/enquiries/route.ts#L8-L35)).
- Post one appraisal per AgentProfile only after a prior enquiry or deal with that agency;
  Investor and Buyer are the only eligible roles
  ([`src/services/agents/agentProfileService.ts:187-231`](../src/services/agents/agentProfileService.ts#L187-L231),
  [`prisma/schema.prisma:430-442`](../prisma/schema.prisma#L430-L442)).

**Pledges/KYC/project tracking — partly built / planned**

- Read existing own pledge rows and calculated portfolio totals on `/investor`; queries are
  scoped by `investorUserId`
  ([`src/services/syndicates/investorDashboard.ts:46-64`](../src/services/syndicates/investorDashboard.ts#L46-L64),
  [`src/services/syndicates/investorDashboard.ts:66-101`](../src/services/syndicates/investorDashboard.ts#L66-L101)).
- Create/withdraw a pledge: **Not implemented in an application route or UI.** RLS already
  describes the future rule—Investor only, own ID, approved KYC, positive amount, open project,
  and `PLEDGED` to `WITHDRAWN` only—but no app endpoint invokes it. The owner
  disabled the staging Data API on 2026-11-05 and verified HTTP 503. Keep the
  Data API disabled unless a specific need is justified and approved
  ([`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:239-271`](../prisma/migrations/20261007000000_phase3_rls_storage/migration.sql#L239-L271),
  [`src/services/syndicates/investorDashboard.ts:9-14`](../src/services/syndicates/investorDashboard.ts#L9-L14)).
- Project creation, discovery, funding transition, milestones, ledger writes, and completion:
  **Not implemented**; planned in Sprint 4 Tasks 4.2–4.5
  ([`docs/sprints/SPRINT-TRACKER.md:71-77`](sprints/SPRINT-TRACKER.md#L71-L77)).
- KYC documents are designed as private; an Investor may insert only into their auth-user
  folder, cannot update/delete through the policy, and only the owner/Admin may select
  ([`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:490-529`](../prisma/migrations/20261007000000_phase3_rls_storage/migration.sql#L490-L529)).

**Buyer-style offers/viewings — denied by intended role**

- Investor cannot use the Buyer actions panel, and the offer/viewing routes require Buyer or
  Admin ([`src/app/marketplace/[id]/page.tsx:267-272`](../src/app/marketplace/[id]/page.tsx#L267-L272),
  [`src/app/api/offers/route.ts:14-16`](../src/app/api/offers/route.ts#L14-L16),
  [`src/app/api/viewings/route.ts:12-14`](../src/app/api/viewings/route.ts#L12-L14)).
- This means the master document’s “Solo Purchase” option is not available to an Investor
  account; the person would need a Buyer account under the current strict separation model
  ([`docs/adr/ADR-016-role-portals.md:13-15`](adr/ADR-016-role-portals.md#L13-L15)).

### Restrictions

- Only own pledges and own saved records are returned by the implemented dashboard/service
  queries ([`src/services/syndicates/investorDashboard.ts:46-64`](../src/services/syndicates/investorDashboard.ts#L46-L64)).
- Raw `KycRecord` provider data has default-deny RLS and no Data API grants; only the caller’s
  status is exposed through their profile
  ([`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:475-477`](../prisma/migrations/20261007000000_phase3_rls_storage/migration.sql#L475-L477)).
- Approved KYC is required for the future pledge operation, not for browsing, saving,
  enquiring, or appraising
  ([`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:246-258`](../prisma/migrations/20261007000000_phase3_rls_storage/migration.sql#L246-L258),
  [`docs/adr/ADR-016-role-portals.md:69-72`](adr/ADR-016-role-portals.md#L69-L72)).

## Normal user (Buyer)

### Purpose

Buyer is the normal demand-side user: search for property, calculate affordability, contact
the Agent, request a viewing, submit an offer, message the Agent, and track their purchase
([`docs/CONTEXT.md:17-23`](CONTEXT.md#L17-L23),
[`docs/adr/ADR-017-buyer-portal.md:8-16`](adr/ADR-017-buyer-portal.md#L8-L16)).
Buyer is not a seller role and cannot create property listings
([`src/app/api/listings/route.ts:9-12`](../src/app/api/listings/route.ts#L9-L12)).

### Creation and verification

- **Built:** Buyer is the default selected public signup role, with email confirmation, GDPR
  consent, password, and active-account requirements
  ([`src/app/(auth)/register/page.tsx:20-40`](<../src/app/(auth)/register/page.tsx#L20-L40>),
  [`src/lib/auth.ts:28-40`](../src/lib/auth.ts#L28-L40)).
- **KYC:** Not required for Buyer enquiries, viewings, offers, saves, messages, or appraisals;
  KYC is scoped to syndicate pledges
  ([`src/services/offers/offerService.ts:5-14`](../src/services/offers/offerService.ts#L5-L14),
  [`docs/adr/ADR-017-buyer-portal.md:32-38`](adr/ADR-017-buyer-portal.md#L32-L38)).

### Pages and portal

- `/buy` — Buyer-only search with affordability calculator and collapsed distress filters
  ([`src/app/buy/page.tsx:16-33`](../src/app/buy/page.tsx#L16-L33),
  [`src/app/buy/page.tsx:42-55`](../src/app/buy/page.tsx#L42-L55)).
- `/buy/saved`, `/buy/enquiries`, `/buy/viewings`, `/buy/offers`, `/buy/messages` — own
  activity pages ([`src/app/buy/nav.ts:3-14`](../src/app/buy/nav.ts#L3-L14)).
- `/marketplace`, `/marketplace/[id]`, and `/agents/[id]` — public marketplace and Agent
  profiles ([`src/app/marketplace/page.tsx:18-41`](../src/app/marketplace/page.tsx#L18-L41),
  [`src/app/agents/[id]/page.tsx:22-33`](../src/app/agents/[id]/page.tsx#L22-L33)).

### Actions and data access

**Search and saves — built**

- Search public stock and run the client-side affordability guide
  ([`src/app/buy/page.tsx:16-27`](../src/app/buy/page.tsx#L16-L27)).
- Save/unsave a public listing and view only their own saved rows
  ([`src/app/api/listings/[id]/save/route.ts:16-44`](../src/app/api/listings/[id]/save/route.ts#L16-L44),
  [`src/app/buy/saved/page.tsx:10-23`](../src/app/buy/saved/page.tsx#L10-L23)).
- Saved searches/alerts: schema and RLS exist, but **Not implemented** in an application page
  or route ([`prisma/schema.prisma:403-414`](../prisma/schema.prisma#L403-L414),
  [`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:325-341`](../prisma/migrations/20261007000000_phase3_rls_storage/migration.sql#L325-L341)).

**Enquiries — built**

- Create an enquiry on a public listing when signed in; anonymous enquiries are denied
  ([`src/services/enquiries/enquiryService.ts:13-37`](../src/services/enquiries/enquiryService.ts#L13-L37)).
- View only enquiries where `fromUserId` is their own ID
  ([`src/app/buy/enquiries/page.tsx:9-19`](../src/app/buy/enquiries/page.tsx#L9-L19)).
- Cannot change enquiry status; that route is Agent-only and the service requires ownership of
  the listing ([`src/app/api/enquiries/[id]/route.ts:9-16`](../src/app/api/enquiries/[id]/route.ts#L9-L16),
  [`src/services/enquiries/enquiryService.ts:153-167`](../src/services/enquiries/enquiryService.ts#L153-L167)).

**Viewings — partly built**

- Request a future one-hour slot on `LIVE` or `UNDER_OFFER` stock; only one pending request
  per Buyer/property is allowed
  ([`src/services/viewings/viewingService.ts:27-62`](../src/services/viewings/viewingService.ts#L27-L62)).
- View only their own requests
  ([`src/services/viewings/viewingService.ts:65-70`](../src/services/viewings/viewingService.ts#L65-L70)).
- Cancel/reschedule, Agent confirmation/decline, and status changes: **Not implemented**; the
  only viewing route is `POST`
  ([`src/app/api/viewings/route.ts:12-34`](../src/app/api/viewings/route.ts#L12-L34)).

**Offers and deals — partly built**

- Submit a positive integer-pence offer on `LIVE` or `UNDER_OFFER` stock; only one submitted
  offer per Buyer/property is allowed
  ([`src/services/offers/offerService.ts:17-55`](../src/services/offers/offerService.ts#L17-L55)).
- Read only their own offers and associated latest Deal, when one exists
  ([`src/services/offers/offerService.ts:66-74`](../src/services/offers/offerService.ts#L66-L74)).
- Withdrawal exists as an owner-scoped service function, but **Not implemented in a route or
  UI** ([`src/services/offers/offerService.ts:57-64`](../src/services/offers/offerService.ts#L57-L64)).
- Agent accept/reject, Deal creation, and Deal stage updates: **Not implemented**. The Buyer
  page can display an existing Deal but does not create or advance one
  ([`src/app/buy/offers/page.tsx:27-48`](../src/app/buy/offers/page.tsx#L27-L48)).

**Chat — partly built**

- Send a persisted message to the owner Agent of a `LIVE`/`UNDER_OFFER` property; sender and
  recipient are derived server-side
  ([`src/services/chat/chatService.ts:27-47`](../src/services/chat/chatService.ts#L27-L47)).
- Read-thread service queries are participant-scoped and the Buyer messages page lists only
  threads involving the Buyer
  ([`src/services/chat/chatService.ts:50-81`](../src/services/chat/chatService.ts#L50-L81),
  [`src/app/buy/messages/page.tsx:16-30`](../src/app/buy/messages/page.tsx#L16-L30)).
- Live updates: **Not implemented** because Pusher is not provisioned; messages require a
  refresh ([`src/services/chat/chatService.ts:5-13`](../src/services/chat/chatService.ts#L5-L13)).
- Agent replies: **Not implemented correctly**, as described in the Agent section.

**Appraisals — built**

- Buyer may leave one Agent appraisal after at least one enquiry or Deal with that Agent’s
  profile; the rating must be an integer from 1 to 5
  ([`src/services/agents/agentProfileService.ts:200-231`](../src/services/agents/agentProfileService.ts#L200-L231),
  [`src/services/agents/agentProfileService.ts:242-281`](../src/services/agents/agentProfileService.ts#L242-L281)).

**Profile/billing/listing sales**

- Buyer profile editing UI/API: **Not implemented**. RLS permits only own `name`, `avatarUrl`,
  and `gdprConsentAt` updates if the Data API is enabled. The owner disabled the staging Data API
  on 2026-11-05 and verified HTTP 503; this is not an application feature and should remain
  disabled unless a specific need is justified and approved
  ([`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:185-193`](../prisma/migrations/20261007000000_phase3_rls_storage/migration.sql#L185-L193)).
- Buyer subscription/billing: **Not implemented and not planned as a Buyer feature**; the
  subscription relation is Agent-specific
  ([`prisma/schema.prisma:445-455`](../prisma/schema.prisma#L445-L455)).
- Sell/list property: **Denied**; no Seller role or Buyer-owned listing path exists
  ([`prisma/schema.prisma:15-20`](../prisma/schema.prisma#L15-L20),
  [`src/app/api/listings/route.ts:9-12`](../src/app/api/listings/route.ts#L9-L12)).

### Restrictions

- Buyer can see only own saved items, enquiries, viewings, offers, deals, and chat messages in
  the role-specific queries/RLS policies
  ([`src/services/buyers/buyerDashboard.ts:40-70`](../src/services/buyers/buyerDashboard.ts#L40-L70),
  [`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:290-323`](../prisma/migrations/20261007000000_phase3_rls_storage/migration.sql#L290-L323),
  [`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:390-469`](../prisma/migrations/20261007000000_phase3_rls_storage/migration.sql#L390-L469)).
- Buyer cannot see another user’s draft/pending listing; non-public IDs return not-found rather
  than revealing existence ([`src/services/listings/listingService.ts:81-100`](../src/services/listings/listingService.ts#L81-L100)).

## Admin

### Purpose and creation

Admin governs users and listings and is intended eventually to monitor KYC, fees, and ads
([`docs/CONTEXT.md:17-23`](CONTEXT.md#L17-L23)). Admin cannot self-register; the seed creates
the current example Admin and public signup cannot assign the role
([`prisma/seed.ts:37-50`](../prisma/seed.ts#L37-L50),
[`prisma/migrations/20261007020000_phase4_supabase_email_auth/migration.sql:12-14`](../prisma/migrations/20261007020000_phase4_supabase_email_auth/migration.sql#L12-L14)).
No separate production-ready Admin invitation/creation tool was found: **Not implemented**.

### Pages and actions

- `/admin` — search/filter users and deactivate/reactivate another user; self-deactivation is
  rejected and changes are audit-logged
  ([`src/app/admin/page.tsx:13-37`](../src/app/admin/page.tsx#L13-L37),
  [`src/services/admin/users.ts:43-67`](../src/services/admin/users.ts#L43-L67)).
- `/admin/moderation` — see every `PENDING_REVIEW` listing and approve it to `LIVE` or reject
  it to `DRAFT` with a reason
  ([`src/services/listings/moderationService.ts:12-31`](../src/services/listings/moderationService.ts#L12-L31),
  [`src/services/listings/statusMachine.ts:22-28`](../src/services/listings/statusMachine.ts#L22-L28)).
- `/admin/kyc` — **Not implemented**; placeholder says Sprint 4 Task 4.1
  ([`src/app/admin/kyc/page.tsx:1-7`](../src/app/admin/kyc/page.tsx#L1-L7)).
- `/admin/fees` — read-only "Fees & Billing Rules" reference: subscriptions
  (Agents, Lead Investors, Co-Investors) are the only payments; no success fees,
  no investment money, advertising unpriced (OD-11). Prices are set on the Phase 3
  billing page ([`src/app/admin/fees/page.tsx`](../src/app/admin/fees/page.tsx)).
- `/admin/ads` — **Not implemented**; placeholder says Sprint 6 Task 6.3
  ([`src/app/admin/ads/page.tsx:1-7`](../src/app/admin/ads/page.tsx#L1-L7)).
- Admin is allowed through every role-portal proxy gate, and several role pages also include
  Admin in their local role check
  ([`src/proxy.ts:6-11`](../src/proxy.ts#L6-L11),
  [`src/app/investor/page.tsx:30-38`](../src/app/investor/page.tsx#L30-L38),
  [`src/app/buy/page.tsx:29-34`](../src/app/buy/page.tsx#L29-L34)). This is preview access,
  not impersonation: underlying queries generally use the Admin’s own user ID.

### Data visibility and restrictions

- RLS allows Admin to read all users (excluding password hashes), all profiles, pledge rows,
  enquiries, appraisals, subscriptions, success fees, offers, deals, viewings, and audit logs
  ([`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:175-193`](../prisma/migrations/20261007000000_phase3_rls_storage/migration.sql#L175-L193),
  [`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:239-245`](../prisma/migrations/20261007000000_phase3_rls_storage/migration.sql#L239-L245),
  [`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:290-310`](../prisma/migrations/20261007000000_phase3_rls_storage/migration.sql#L290-L310),
  [`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:343-388`](../prisma/migrations/20261007000000_phase3_rls_storage/migration.sql#L343-L388),
  [`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:390-473`](../prisma/migrations/20261007000000_phase3_rls_storage/migration.sql#L390-L473)).
- Application pages for most of those cross-user datasets are **Not implemented**, so the RLS
  capability is not the same as a usable Admin feature.
- Admin may preview any draft/pending listing
  ([`src/services/listings/listingService.ts:88-99`](../src/services/listings/listingService.ts#L88-L99)).
- Admin cannot deactivate their own account through the implemented service
  ([`src/services/admin/users.ts:43-50`](../src/services/admin/users.ts#L43-L50)).

## Anonymous visitor

### Purpose and access

Anonymous visitors discover the platform before registering. They may access `/`, `/register`,
`/login`, `/forgot-password`, `/marketplace`, public listing detail pages, and public Agent
profiles. Marketplace search has no authentication gate
([`src/app/marketplace/page.tsx:18-41`](../src/app/marketplace/page.tsx#L18-L41)); Agent profiles
also require no authentication
([`src/app/agents/[id]/page.tsx:22-33`](../src/app/agents/[id]/page.tsx#L22-L33)).

Anonymous visitors can:

- Read searchable `LIVE`/`UNDER_OFFER` inventory and direct `SOLD` detail pages, but cannot
  see `DRAFT`/`PENDING_REVIEW`
  ([`src/services/search/queryBuilder.ts:18-25`](../src/services/search/queryBuilder.ts#L18-L25),
  [`src/services/listings/listingService.ts:70-99`](../src/services/listings/listingService.ts#L70-L99)).
- Read active public Agent profiles, case studies, ratings, and reviewer names as rendered by
  the server page ([`src/services/agents/agentProfileService.ts:56-98`](../src/services/agents/agentProfileService.ts#L56-L98)).
- Increment a public listing’s view counter once per browser session; owning Agents and Admins
  are excluded from the count
  ([`src/app/api/listings/[id]/view/route.ts:11-25`](../src/app/api/listings/[id]/view/route.ts#L11-L25),
  [`src/services/listings/analytics.ts:45-54`](../src/services/listings/analytics.ts#L45-L54)).

Anonymous visitors cannot enquire, save, message, request a viewing, offer, appraise, pledge,
or enter any role portal. The enquiry UI shows a login prompt
([`src/components/marketplace/EnquiryForm.tsx:22-49`](../src/components/marketplace/EnquiryForm.tsx#L22-L49)),
and `requireRole()` returns HTTP 401 without a signed-in identity
([`src/lib/authz.ts:13-27`](../src/lib/authz.ts#L13-L27)).

## Permissions matrix

Legend: **Allowed** = implemented without an ownership qualifier; **Allowed (own records
only)** = implemented and owner-scoped; **Requires approved KYC** = implemented permission
whose operation is KYC-gated; **Denied** = an implemented guard rejects the role; **Not
implemented** = no usable application flow, even if a model, service helper, or future RLS
policy exists.

| Feature / action                                         | Agent                                  | Investor                                            | Buyer                                   | Admin                                    | Anonymous |
| -------------------------------------------------------- | -------------------------------------- | --------------------------------------------------- | --------------------------------------- | ---------------------------------------- | --------- |
| View public marketplace/search                           | Allowed                                | Allowed                                             | Allowed                                 | Allowed                                  | Allowed   |
| View public listing detail (`LIVE`/`UNDER_OFFER`/`SOLD`) | Allowed                                | Allowed                                             | Allowed                                 | Allowed                                  | Allowed   |
| View `DRAFT`/`PENDING_REVIEW` listing                    | Allowed (own records only)             | Denied                                              | Denied                                  | Allowed                                  | Denied    |
| Create listing draft                                     | Allowed (own records only)             | Denied                                              | Denied                                  | Denied through listing API               | Denied    |
| Edit listing                                             | Allowed (own `DRAFT` only)             | Denied                                              | Denied                                  | Denied through listing API               | Denied    |
| Delete listing                                           | Not implemented                        | Not implemented                                     | Not implemented                         | Not implemented                          | Denied    |
| Submit listing for review                                | Allowed (own records only)             | Denied                                              | Denied                                  | Denied through submit API                | Denied    |
| Approve/reject listing                                   | Denied                                 | Denied                                              | Denied                                  | Allowed                                  | Denied    |
| Mark listing under offer/sold                            | Not implemented                        | Denied                                              | Denied                                  | Not implemented                          | Denied    |
| Upload property image through current app route          | Allowed                                | Denied                                              | Denied                                  | Allowed                                  | Denied    |
| Save/unsave property                                     | Denied                                 | Allowed (own records only)                          | Allowed (own records only)              | Denied                                   | Denied    |
| Saved searches/alerts                                    | Not implemented                        | Not implemented                                     | Not implemented                         | Not implemented                          | Denied    |
| Create enquiry                                           | Allowed                                | Allowed                                             | Allowed                                 | Allowed                                  | Denied    |
| Read enquiry                                             | Allowed (own listings only)            | No own-enquiry page                                 | Allowed (own records only)              | No cross-user page                       | Denied    |
| Change enquiry status                                    | Allowed (own listings only)            | Denied                                              | Denied                                  | Denied by route                          | Denied    |
| Request viewing                                          | Denied                                 | Denied                                              | Allowed (own records only)              | Allowed (own records only; inconsistent) | Denied    |
| Confirm/decline/cancel viewing                           | Not implemented                        | Not implemented                                     | Not implemented                         | Not implemented                          | Denied    |
| Submit offer                                             | Denied                                 | Denied                                              | Allowed (own records only)              | Allowed (own records only; inconsistent) | Denied    |
| Withdraw offer                                           | Not implemented                        | Denied                                              | Not implemented                         | Not implemented                          | Denied    |
| Accept/reject offer or create/update Deal                | Not implemented                        | Not implemented                                     | Not implemented                         | Not implemented                          | Denied    |
| Send chat message to listing Agent                       | Allowed on another Agent’s listing     | Allowed                                             | Allowed                                 | Allowed                                  | Denied    |
| Agent reply / realtime chat                              | Not implemented                        | Not implemented                                     | Not implemented                         | Not implemented                          | Denied    |
| Read own chat rows                                       | Service/RLS only; no Agent page        | Service/RLS only; no Investor page                  | Allowed (own records only)              | Service/RLS only; no cross-user page     | Denied    |
| Post Agent appraisal                                     | Denied                                 | Allowed (own, after prior enquiry/deal)             | Allowed (own, after prior enquiry/deal) | Denied                                   | Denied    |
| Manage own Agent case studies                            | Allowed (own records only)             | Denied                                              | Denied                                  | Denied by route                          | Denied    |
| View public Agent profile/appraisals                     | Allowed                                | Allowed                                             | Allowed                                 | Allowed                                  | Allowed   |
| Start/complete KYC                                       | Not implemented                        | Not implemented                                     | Not implemented                         | Not implemented                          | Denied    |
| Read own KYC status                                      | Not applicable                         | Allowed (own records only)                          | Not exposed in Buyer UI                 | Allowed for own portal context           | Denied    |
| Create syndicate pledge                                  | Denied                                 | Not implemented (future rule requires approved KYC) | Denied                                  | Denied by RLS insert rule                | Denied    |
| Read existing pledge dashboard                           | Denied                                 | Allowed (own records only)                          | Denied                                  | Own-ID portal view only; RLS allows all  | Denied    |
| Withdraw pledge                                          | Denied                                 | Not implemented                                     | Denied                                  | Not implemented                          | Denied    |
| Read/write milestones and ledger                         | Not implemented                        | Not implemented                                     | Denied                                  | Not implemented                          | Denied    |
| Manage subscription / Stripe billing                     | Not implemented                        | Not applicable                                      | Not applicable                          | Not implemented                          | Denied    |
| User search + activate/deactivate                        | Denied                                 | Denied                                              | Denied                                  | Allowed                                  | Denied    |
| Moderate KYC / fees / ads                                | Denied                                 | Denied                                              | Denied                                  | Not implemented                          | Denied    |
| Edit basic account profile                               | Not implemented                        | Not implemented                                     | Not implemented                         | Not implemented                          | Denied    |
| Erase own legacy account                                 | Allowed (own records only)             | Allowed (own records only)                          | Allowed (own records only)              | Allowed (own records only)               | Denied    |
| Sell/list a property as a normal homeowner               | Denied unless using Agent role/profile | Denied                                              | Denied                                  | Denied through listing API               | Denied    |

Matrix evidence: route-level roles are enforced by `requireRole()`
([`src/lib/authz.ts:9-27`](../src/lib/authz.ts#L9-L27)); listing roles and ownership are in the
listing routes/services
([`src/app/api/listings/route.ts:9-33`](../src/app/api/listings/route.ts#L9-L33),
[`src/services/listings/listingService.ts:25-60`](../src/services/listings/listingService.ts#L25-L60));
Buyer actions are in the offer/viewing routes
([`src/app/api/offers/route.ts:14-36`](../src/app/api/offers/route.ts#L14-L36),
[`src/app/api/viewings/route.ts:12-34`](../src/app/api/viewings/route.ts#L12-L34)); saves and
appraisals have explicit Buyer/Investor gates
([`src/app/api/listings/[id]/save/route.ts:16-44`](../src/app/api/listings/[id]/save/route.ts#L16-L44),
[`src/app/api/agents/[id]/appraisals/route.ts:9-44`](../src/app/api/agents/[id]/appraisals/route.ts#L9-L44));
and unimplemented syndicate/KYC/billing work is recorded in the sprint tracker
([`docs/sprints/SPRINT-TRACKER.md:66-91`](sprints/SPRINT-TRACKER.md#L66-L91)).

## Role-to-role interactions

1. **Buyer/Investor/other signed-in user → Agent enquiry.** Any authenticated role can create
   an enquiry on a public listing; it is saved with the caller’s server identity and emailed
   to the owning Agent. The Agent can read it and change its status if they own the listing
   ([`src/app/api/enquiries/route.ts:8-35`](../src/app/api/enquiries/route.ts#L8-L35),
   [`src/services/enquiries/enquiryService.ts:64-84`](../src/services/enquiries/enquiryService.ts#L64-L84),
   [`src/services/enquiries/enquiryService.ts:139-167`](../src/services/enquiries/enquiryService.ts#L139-L167)).
2. **Buyer → Agent viewing request.** Buyer requests a slot, but Agent confirmation/decline is
   **Not implemented**, despite those status values existing in the schema
   ([`src/services/viewings/viewingService.ts:27-62`](../src/services/viewings/viewingService.ts#L27-L62),
   [`prisma/schema.prisma:117-122`](../prisma/schema.prisma#L117-L122)).
3. **Buyer → Agent offer.** Buyer submits an offer, but Agent accept/reject and Deal creation
   are **Not implemented**, despite schema statuses and Deal stages existing
   ([`src/services/offers/offerService.ts:31-55`](../src/services/offers/offerService.ts#L31-L55),
   [`prisma/schema.prisma:102-115`](../prisma/schema.prisma#L102-L115)).
4. **Buyer → Agent chat.** Buyer messages are persisted and addressed to the listing Agent,
   but Agent reply and realtime delivery are **Not implemented correctly/Not implemented**
   ([`src/services/chat/chatService.ts:27-47`](../src/services/chat/chatService.ts#L27-L47),
   [`src/services/chat/chatService.ts:5-13`](../src/services/chat/chatService.ts#L5-L13)).
5. **Buyer/Investor → Agent appraisal.** A Buyer or Investor with a prior enquiry or Deal may
   leave one appraisal; it appears on the public Agent page
   ([`src/services/agents/agentProfileService.ts:200-231`](../src/services/agents/agentProfileService.ts#L200-L231),
   [`src/app/agents/[id]/page.tsx:137-180`](../src/app/agents/[id]/page.tsx#L137-L180)).
6. **Agent → Admin moderation.** Agent submits an owned draft; Admin approves it to `LIVE` or
   rejects it to `DRAFT` with a reason
   ([`src/services/listings/listingService.ts:304-318`](../src/services/listings/listingService.ts#L304-L318),
   [`src/services/listings/statusMachine.ts:22-28`](../src/services/listings/statusMachine.ts#L22-L28)).
7. **Admin → users.** Admin searches users and activates/deactivates them, except themselves;
   the session layer subsequently rejects inactive profile/legacy accounts
   ([`src/services/admin/users.ts:7-40`](../src/services/admin/users.ts#L7-L40),
   [`src/services/admin/users.ts:43-67`](../src/services/admin/users.ts#L43-L67),
   [`src/lib/auth.ts:36-40`](../src/lib/auth.ts#L36-L40)).
8. **Investor ↔ syndicate/project.** Existing pledge data can be displayed, but KYC onboarding,
   creating/withdrawing pledges, project creation, and refurbishment tracking are **planned,
   not implemented** ([`src/services/syndicates/investorDashboard.ts:46-101`](../src/services/syndicates/investorDashboard.ts#L46-L101),
   [`docs/sprints/SPRINT-TRACKER.md:66-77`](sprints/SPRINT-TRACKER.md#L66-L77)).

## Typical journeys

### Agent

1. Register as Agent, confirm email, and log in
   ([`src/app/(auth)/actions.ts:58-105`](<../src/app/(auth)/actions.ts#L58-L105>)).
2. Obtain an AgentProfile—currently via seed/manual/admin-side database work because profile
   creation UI is **Not implemented**
   ([`prisma/seed.ts:69-91`](../prisma/seed.ts#L69-L91),
   [`src/app/agent/profile/page.tsx:27-34`](../src/app/agent/profile/page.tsx#L27-L34)).
3. Create and edit a draft, upload images, then submit it for review
   ([`src/services/listings/listingService.ts:218-318`](../src/services/listings/listingService.ts#L218-L318)).
4. Wait for Admin approval/rejection; only Admin can publish
   ([`src/services/listings/statusMachine.ts:22-28`](../src/services/listings/statusMachine.ts#L22-L28)).
5. Review listing views/saves and manage incoming enquiry statuses
   ([`src/app/agent/listings/page.tsx:70-81`](../src/app/agent/listings/page.tsx#L70-L81),
   [`src/app/agent/leads/page.tsx:42-66`](../src/app/agent/leads/page.tsx#L42-L66)).
6. Maintain case studies and view the public credibility record
   ([`src/app/agent/profile/page.tsx:37-79`](../src/app/agent/profile/page.tsx#L37-L79)).

### Investor

1. Register as Investor, confirm email, and enter `/investor`
   ([`src/app/(auth)/actions.ts:99-101`](<../src/app/(auth)/actions.ts#L99-L101>),
   [`src/lib/portalHome.ts:10-15`](../src/lib/portalHome.ts#L10-L15)).
2. See KYC status and existing EOI pledge summary
   ([`src/app/investor/page.tsx:54-72`](../src/app/investor/page.tsx#L54-L72)).
3. Browse public listings, save promising stock, and optionally enquire
   ([`src/app/investor/page.tsx:111-125`](../src/app/investor/page.tsx#L111-L125),
   [`src/app/api/listings/[id]/save/route.ts:16-44`](../src/app/api/listings/[id]/save/route.ts#L16-L44)).
4. Complete KYC, discover an open syndicate, pledge, and track refurbishment: **Not
   implemented; planned for Sprint 4**
   ([`docs/sprints/SPRINT-TRACKER.md:66-77`](sprints/SPRINT-TRACKER.md#L66-L77)).

### Buyer

1. Register as Buyer, confirm email, and enter `/buy`
   ([`src/app/(auth)/register/page.tsx:20-30`](<../src/app/(auth)/register/page.tsx#L20-L30>),
   [`src/lib/portalHome.ts:10-15`](../src/lib/portalHome.ts#L10-L15)).
2. Calculate affordability, search/filter public listings, and save favourites
   ([`src/app/buy/page.tsx:16-27`](../src/app/buy/page.tsx#L16-L27),
   [`src/app/api/listings/[id]/save/route.ts:16-44`](../src/app/api/listings/[id]/save/route.ts#L16-L44)).
3. Enquire, request a viewing, message the Agent, or submit an offer from a public listing
   ([`src/app/marketplace/[id]/page.tsx:267-280`](../src/app/marketplace/[id]/page.tsx#L267-L280)).
4. Review own activity on the Buyer sub-pages
   ([`src/app/buy/nav.ts:7-14`](../src/app/buy/nav.ts#L7-L14)).
5. Agent confirmation, offer decision, and Deal progression are **Not implemented**; an
   already-existing Deal can only be displayed
   ([`src/app/buy/offers/page.tsx:27-48`](../src/app/buy/offers/page.tsx#L27-L48)).

### Admin

1. Be created through trusted seed/manual tooling; self-service Admin registration is denied
   ([`prisma/seed.ts:37-50`](../prisma/seed.ts#L37-L50),
   [`src/services/auth/supabaseAuthService.ts:66-72`](../src/services/auth/supabaseAuthService.ts#L66-L72)).
2. Search users and activate/deactivate accounts
   ([`src/app/admin/page.tsx:26-38`](../src/app/admin/page.tsx#L26-L38),
   [`src/app/admin/page.tsx:114-130`](../src/app/admin/page.tsx#L114-L130)).
3. Review pending listings, approving or rejecting them
   ([`src/app/admin/moderation/page.tsx:6-33`](../src/app/admin/moderation/page.tsx#L6-L33)).
4. KYC queue, fees, and ads management: **Not implemented**
   ([`src/app/admin/kyc/page.tsx:1-7`](../src/app/admin/kyc/page.tsx#L1-L7),
   [`src/app/admin/fees/page.tsx:1-7`](../src/app/admin/fees/page.tsx#L1-L7),
   [`src/app/admin/ads/page.tsx:1-7`](../src/app/admin/ads/page.tsx#L1-L7)).

### Anonymous visitor

1. Land on `/`, browse `/marketplace`, and open a public listing or Agent profile
   ([`src/app/marketplace/page.tsx:18-41`](../src/app/marketplace/page.tsx#L18-L41),
   [`src/app/agents/[id]/page.tsx:22-33`](../src/app/agents/[id]/page.tsx#L22-L33)).
2. Attempt a private action and receive a login prompt/401
   ([`src/components/marketplace/EnquiryForm.tsx:40-49`](../src/components/marketplace/EnquiryForm.tsx#L40-L49),
   [`src/lib/authz.ts:13-20`](../src/lib/authz.ts#L13-L20)).
3. Register as Buyer, Investor, or Agent; Admin is unavailable
   ([`src/app/(auth)/register/page.tsx:20-30`](<../src/app/(auth)/register/page.tsx#L20-L30>)).

## Where permissions are enforced

### 1. Authentication identity and active-account checks

Server code calls Supabase `auth.getUser()`, requires confirmed email, then loads the
server-written profile and legacy user. Either inactive row makes the identity unavailable
([`src/lib/auth.ts:21-50`](../src/lib/auth.ts#L21-L50)). Role, KYC status, and legacy ID come
from those server-side rows, not `user_metadata`
([`src/lib/auth.ts:24-26`](../src/lib/auth.ts#L24-L26)).

### 2. Proxy portal gates

`src/proxy.ts` refreshes the Supabase session and gates `/admin`, `/agent`, `/investor`, and
`/buy` by role; Admin is included in every portal. It also rejects unconfirmed, inactive, or
unmapped accounts ([`src/proxy.ts:6-15`](../src/proxy.ts#L6-L15),
[`src/proxy.ts:17-47`](../src/proxy.ts#L17-L47)). The file itself says this is an optimistic
portal gate and protected pages/actions must still authorize on the server
([`src/proxy.ts:13-16`](../src/proxy.ts#L13-L16)).

### 3. Route handlers and server actions

`requireRole()` returns 401 for no identity and 403 for the wrong role; `requireKyc()` rejects
non-approved status ([`src/lib/authz.ts:9-51`](../src/lib/authz.ts#L9-L51)). Examples include
Agent listing routes, Buyer save/appraisal routes, and Admin moderation routes
([`src/app/api/listings/route.ts:9-12`](../src/app/api/listings/route.ts#L9-L12),
[`src/app/api/listings/[id]/save/route.ts:16-44`](../src/app/api/listings/[id]/save/route.ts#L16-L44),
[`src/app/api/admin/listings/[id]/approve/route.ts:8-22`](../src/app/api/admin/listings/[id]/approve/route.ts#L8-L22)).

### 4. Service-layer ownership and business rules

Services re-check AgentProfile/listing ownership, active profile status, Buyer IDs, public
listing status, appraisal qualification, one-standing-offer/viewing limits, and subscription
limits ([`src/services/listings/listingService.ts:25-60`](../src/services/listings/listingService.ts#L25-L60),
[`src/services/offers/offerService.ts:31-63`](../src/services/offers/offerService.ts#L31-L63),
[`src/services/viewings/viewingService.ts:27-62`](../src/services/viewings/viewingService.ts#L27-L62),
[`src/services/agents/agentProfileService.ts:187-231`](../src/services/agents/agentProfileService.ts#L187-L231)).

### 5. RLS and grants

The Phase 3 migration enables default-deny RLS on 29 application-owned public tables, then
adds operation-specific policies
([`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:150-170`](../prisma/migrations/20261007000000_phase3_rls_storage/migration.sql#L150-L170)).
Policies derive the legacy ID, role, and KYC status from `auth.uid()` through protected helper
functions
([`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:8-45`](../prisma/migrations/20261007000000_phase3_rls_storage/migration.sql#L8-L45)).
These policies protect Supabase Data API/Storage access; the application’s trusted Prisma
server connection still requires route/service authorization. The architecture explicitly
describes Prisma as the trusted server business-data client and Data API access as opt-in
([`docs/ARCHITECTURE.md:14`](ARCHITECTURE.md#L14)).

## Enforcement gaps and inconsistencies

These are findings from current code, not invented intended behavior.

1. **High — Agent chat replies do not work, while the route comment says they do.** The route
   accepts every authenticated role, but the service always addresses a message to the
   listing’s Agent and rejects the owner Agent for messaging themselves. Investors, Admins,
   and unrelated Agents can also invoke this buyer-labelled endpoint against another Agent’s
   listing ([`src/app/api/chat/route.ts:9-18`](../src/app/api/chat/route.ts#L9-L18),
   [`src/services/chat/chatService.ts:27-47`](../src/services/chat/chatService.ts#L27-L47)).
2. **High — Admin can create Buyer offers and viewings through direct API calls.** Both route
   comments say “BUYER only,” but both call `requireRole("BUYER", "ADMIN")`. Phase 3 RLS permits
   only `BUYER` inserts, so direct application behavior and Data API policy disagree
   ([`src/app/api/offers/route.ts:7-16`](../src/app/api/offers/route.ts#L7-L16),
   [`src/app/api/viewings/route.ts:7-14`](../src/app/api/viewings/route.ts#L7-L14),
   [`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:397-404`](../prisma/migrations/20261007000000_phase3_rls_storage/migration.sql#L397-L404),
   [`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:437-445`](../prisma/migrations/20261007000000_phase3_rls_storage/migration.sql#L437-L445)).
3. **Medium — Several protected pages rely on the proxy instead of performing an explicit
   page-level role check.** `/agent/listings`, `/agent/leads`, and `/agent/profile` call `auth()`
   but do not verify `AGENT`; `/admin/moderation`, `/admin/kyc`, `/admin/fees`, and `/admin/ads`
   do not call `auth()`/`requireRole()` at all
   ([`src/app/agent/listings/page.tsx:23-26`](../src/app/agent/listings/page.tsx#L23-L26),
   [`src/app/agent/leads/page.tsx:22-28`](../src/app/agent/leads/page.tsx#L22-L28),
   [`src/app/agent/profile/page.tsx:16-27`](../src/app/agent/profile/page.tsx#L16-L27),
   [`src/app/admin/moderation/page.tsx:1-8`](../src/app/admin/moderation/page.tsx#L1-L8)). This
   conflicts with the proxy’s own statement that each protected page/action still authorizes
   on the server ([`src/proxy.ts:13-16`](../src/proxy.ts#L13-L16)). Mutations are generally
   separately guarded, and Agent reads are owner-scoped, which reduces but does not remove the
   inconsistency.
4. **Medium — Inactive AgentProfiles remain publicly renderable by the server page.** The
   public profile fetch returns any matching profile without checking `active`, although RLS
   exposes an AgentProfile to anonymous users only when active
   ([`src/services/agents/agentProfileService.ts:56-64`](../src/services/agents/agentProfileService.ts#L56-L64),
   [`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:195-198`](../prisma/migrations/20261007000000_phase3_rls_storage/migration.sql#L195-L198)). Because Prisma is
   the trusted server client, SSR can therefore expose a profile that the Data API would hide.
5. **Medium — Enquiries are broader than the Buyer/Investor product language.** The route
   intentionally allows Agent and Admin callers too, so a signed-in listing owner can enquire
   on their own listing and any authenticated role can create leads
   ([`src/app/api/enquiries/route.ts:8-12`](../src/app/api/enquiries/route.ts#L8-L12)). Decide
   whether this is intended.
6. **Medium — Several workflows are read-only or one-sided.** Offer withdrawal has an unused
   service function; Agent offer decisions, viewing decisions, Agent chat replies, Deal
   creation/progression, KYC, pledge writes, and billing have no complete route/UI
   ([`src/services/offers/offerService.ts:57-64`](../src/services/offers/offerService.ts#L57-L64),
   [`docs/sprints/SPRINT-TRACKER.md:66-91`](sprints/SPRINT-TRACKER.md#L66-L91)).
7. **Low — Documentation status is stale/inconsistent.** The sprint tracker says the entire
   Buyer portal/deal flow is not started, while current code and the live status document say
   Buyer search, viewing requests, offers, messages, and Deal display are built
   ([`docs/sprints/SPRINT-TRACKER.md:79-92`](sprints/SPRINT-TRACKER.md#L79-L92),
   [`docs/sprints/STATUS.md:262-268`](sprints/STATUS.md#L262-L268)).
8. **Low — Public appraisals disclose reviewer names by design, while Data API RLS calls the
   same rows private.** The SSR public Agent page returns reviewer names to everyone, whereas
   RLS restricts appraisal rows to the reviewer, reviewed agency, or Admin
   ([`src/services/agents/agentProfileService.ts:91-97`](../src/services/agents/agentProfileService.ts#L91-L97),
   [`src/app/agents/[id]/page.tsx:164-180`](../src/app/agents/[id]/page.tsx#L164-L180),
   [`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:343-350`](../prisma/migrations/20261007000000_phase3_rls_storage/migration.sql#L343-L350)). Decide whether reviewer identity is intended public data.

## Open questions

1. **Investor types:** Do you actually want two investor subtypes? None exists today. If yes,
   define the business distinction—such as retail vs sophisticated/high-net-worth,
   individual vs company, or solo acquisition vs syndicate participant—before adding a field
   or permissions. Today “solo purchase” is the Buyer journey, not an Investor subtype
   ([`docs/PropLink_UK_Master_Document.md:97-124`](PropLink_UK_Master_Document.md#L97-L124)).
2. **Private sellers/homeowners:** Should a normal Buyer be able to sell property? Currently
   only an Agent with an active AgentProfile can list, and there is no Seller role
   ([`prisma/schema.prisma:15-20`](../prisma/schema.prisma#L15-L20),
   [`src/services/listings/listingService.ts:218-224`](../src/services/listings/listingService.ts#L218-L224)).
3. **Multi-role accounts:** ADR-016 requires strict separation of Agent, Investor, and Buyer
   portals. Should one person need separate accounts to both invest and buy, or should accounts
   support multiple roles?
   ([`docs/adr/ADR-016-role-portals.md:13-15`](adr/ADR-016-role-portals.md#L13-L15)).
4. **AgentProfile provisioning:** Who verifies and creates an AgentProfile after an Agent
   signs up? Current code only tells the user to contact Admin, but no Admin creation flow was
   found ([`src/app/agent/profile/page.tsx:27-34`](../src/app/agent/profile/page.tsx#L27-L34)).
5. **Admin role-portal access:** Should Admin remain admitted to every role portal, or should
   moderation use dedicated read-only preview tools? Current role pages often query with the
   Admin’s own user ID, so “access” does not necessarily show the target user’s data
   ([`src/proxy.ts:6-11`](../src/proxy.ts#L6-L11),
   [`src/app/buy/saved/page.tsx:16-23`](../src/app/buy/saved/page.tsx#L16-L23)).
6. **Admin Buyer actions:** Should Admin be able to create offers/viewings? Route code says
   yes, comments and RLS say no; this needs one authoritative decision
   ([`src/app/api/offers/route.ts:7-16`](../src/app/api/offers/route.ts#L7-L16),
   [`src/app/api/viewings/route.ts:7-14`](../src/app/api/viewings/route.ts#L7-L14)).
7. **Enquiry roles:** Should Agents and Admins be allowed to create enquiries, including on
   their own stock, or should it be Buyer/Investor only?
   ([`src/app/api/enquiries/route.ts:8-12`](../src/app/api/enquiries/route.ts#L8-L12)).
8. **Public appraisal identity:** Should reviewer names and text be public, or should only an
   aggregate rating be public? Current SSR and RLS express different privacy models
   ([`src/services/agents/agentProfileService.ts:91-97`](../src/services/agents/agentProfileService.ts#L91-L97),
   [`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:343-350`](../prisma/migrations/20261007000000_phase3_rls_storage/migration.sql#L343-L350)).
9. **Listing lifecycle ownership:** Who marks a listing `UNDER_OFFER` and `SOLD`, and through
   which UI? The state machine grants Agent/Admin permission but no route exposes it
   ([`src/services/listings/statusMachine.ts:29-34`](../src/services/listings/statusMachine.ts#L29-L34)).
10. **Offer/viewing completion:** Define who accepts/rejects offers, confirms/declines
    viewings, creates a Deal, and advances it. Models exist but the Agent/Admin mutation flows
    do not ([`prisma/schema.prisma:102-122`](../prisma/schema.prisma#L102-L122)).
11. **Profile editing:** Should self-service users be able to edit name/avatar/consent through
    the app? RLS allows those columns, but no page/route was found
    ([`prisma/migrations/20261007000000_phase3_rls_storage/migration.sql:185-193`](../prisma/migrations/20261007000000_phase3_rls_storage/migration.sql#L185-L193)).
12. **Source-of-truth cleanup:** Should the sprint tracker be updated to reflect the partially
    built Buyer and Investor read-side features? Its status currently conflicts with current
    code and `STATUS.md`
    ([`docs/sprints/SPRINT-TRACKER.md:66-92`](sprints/SPRINT-TRACKER.md#L66-L92),
    [`docs/sprints/STATUS.md:253-268`](sprints/STATUS.md#L253-L268)).
