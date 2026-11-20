# ADR-080: Portal detail pages use a header, key facts, tabs and panels

- Status: Accepted
- Date: 2026-11-20

## Context

The owner found the Landlord, Agent and Investor portals "bland": a detail page
(for example an Investor's project) was one long column of `<h2>` sections —
terms, Lead, funding, agreement, works, sale, messages, property, documents —
with nothing grouped and no sense of what mattered first. Dashboards had the
same problem.

## Decision

Every portal detail page is built from the shared blocks in
`src/components/portal/Detail.tsx`:

1. **`DetailHeader`**: back link, eyebrow (what kind of thing this is), title,
   status badges, and the one or two main actions (e.g. "Pledge now").
2. **`KeyFacts`**: a strip of the four to six numbers people open the page for.
3. **`DetailTabs`**: the rest, split into named tabs. Tabs are server-rendered
   links (`?tab=key`), not client state: only the chosen tab renders, the URL
   can be shared, Back works, and a server action that revalidates the page
   keeps the user on the same tab. The first tab has no query string. A tab
   carries `attention` (an amber dot, announced to screen readers) when
   something there waits on the viewer, and an optional count. Tabs with
   nothing in them are not shown.
4. **`Panel`**: a titled card with a one-line plain-English description, used to
   group content inside a tab (`tone="attention"` for things awaiting the
   viewer). **`FactList`** renders label/value pairs, **`DetailColumns`** a main
   column plus a side rail.

Dashboards use the same `Panel`/`KeyFacts` blocks: a "needs your attention"
panel first, then figures, then titled panels in a grid with "View all" links.

Investor project tabs: Overview · Invest (My pledge) · Property & documents ·
Agreement & progress · Messages.

## Admin portal

The same blocks are used across Admin: detail pages (project, landlord listing,
user, agent; case and chat without tabs, as single flows), a dashboard with a
"Needs your attention" queue strip and admin areas grouped as People, Listings &
projects, Money, Trust & safety and Platform, and tabs on Ads, Subscriptions,
KPIs and Investor projects. Filterable list pages (Users, Landlord listings,
Agents) keep their query-string filters instead of `?tab=`. Admin pages carry a
screen-reader `<h1>` because the admin frame has none.

## Consequences

- No feature, server action or data-testid was removed; content moved.
- E2E specs that reach content now on a non-default tab navigate with `?tab=`.
- New detail pages should use these blocks rather than stacked `PortalSection`s.
  `PortalSection` stays for simple list pages.
