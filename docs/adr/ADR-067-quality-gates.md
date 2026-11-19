# ADR-067: Quality gates: journeys on desktop and phone, cross-browser smoke, local visual baselines

- **Status:** Accepted (2026-11-19)
- **Phase:** 7, Task 6 · **Business sources:** phase prompt Task 6 (full E2E
  across every journey on desktop and mobile, accessibility audit,
  cross-browser smoke, visual regression, zero failing tests, zero lint and
  type errors)

## Decision

- **Playwright projects:** `chromium` (desktop) runs every spec; `mobile`
  (Pixel 7) runs `journeys.spec.ts` and `smoke.spec.ts`; `firefox` and
  `webkit` run `smoke.spec.ts`. CI installs all three browsers.
- **`journeys.spec.ts`** sets up one chain in the development database
  (Landlord listing, ACTIVE mandate with the seeded Agent, published project,
  ACTIVE Solicitor) and, for Landlord, Agent, Investor, Buyer and Solicitor
  (second factor via an MFA recovery grant, as for Admin) plus signed-out
  public pages: the role lands on its own portal, sees its part of the chain,
  and every page in its navigation loads with an h1, fits a phone screen and
  passes axe (WCAG 2 A/AA, serious and critical). Admin pages are covered at
  four widths by `admin-a5.spec.ts`; the deep flows keep their own specs.
- **Visual regression** (`visual.spec.ts`): five data-independent pages,
  baselines per platform, run locally and skipped in CI.
- **Test sign-ins use their own client address** (`x-forwarded-for` from the
  RFC 5737 documentation range) so a full run does not trip the 5-per-15-
  minute sign-in limit; the limiter is covered by unit tests (ADR-064).
- **Dev-server timings:** expect timeout 15 s and test timeout 90 s, because
  a cold dev server compiles each route on first request.

## Consequences

- The audit fixed real accessibility defects (see the Phase 7 report): review
  modals without dialog semantics or a labelled field, EPC badges announced as
  a bare letter, sideways-scrolling tables unreachable by keyboard, three
  contrast failures, and an invalid definition list.
- Many older specs had drifted from the product (Admin MFA, the Admin A2
  Review Studio, Phase 3 messages, display labels, the landing page). They
  were updated to the current behaviour, never by weakening what they check.
- Real-device checks (iPhone Safari, a screen reader) remain owner checks.
