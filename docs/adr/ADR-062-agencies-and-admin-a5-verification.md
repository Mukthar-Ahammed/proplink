# ADR-062: Agencies from company checks; authenticated Admin verification

- **Status:** Accepted (2026-11-19)
- **Phase:** 6, Task 5 · **Business sources:** phase prompt Task 5 (A5
  verification debt; agency management as company-level grouping for
  Agents); `docs/implementation/ADMIN-A5-VERIFICATION.md`

## Decision

1. **Agencies** are derived, not stored: Agents whose Companies House
   check (Phase 1 Task 4) found the same company number form one agency.
   `/admin/agents/agencies` (SUSPENSION) lists each agency (name, number,
   register status, verified or not — an Admin override wins), its Agents
   and their agency profiles with live-listing counts. Suspending an agency
   deactivates every agency profile in it (their listings leave search) and
   reactivating restores them; one audit entry per agency action plus the
   existing per-profile entries.
2. **Authenticated Admin test session:** `tests/e2e/helpers/adminSession.ts`
   signs in normally and records an MFA recovery grant for that browser
   session directly in the database (test-only; production Admins still
   need TOTP).
3. **A5 verification** (`tests/e2e/admin-a5.spec.ts`): 19 main Admin pages
   at 1440, 1024, 768 and 375 px load without errors, show their heading,
   fit the screen without sideways scrolling (below 1024 px) and pass axe
   (WCAG 2 A/AA, serious and critical).

## Defects found and fixed by the verification

- The global header inverted to white text on Admin pages (`/admin` was in
  the overlay list meant for pages with a dark masthead).
- Sort and subtype dropdowns on the KYC and moderation queues had no
  accessible name.
- `/admin/users` was 516 px wider than a phone screen: screen-reader-only
  labels inside the table escaped its scroll box (the table wrapper is now
  `relative`).
- Low contrast: "Soon" items at 50-60% opacity, 70% muted text, warning
  badges on tinted backgrounds, accent links and hover on tinted cards.

## Consequences

- No migration. An agency table can be added later if the owner wants
  agency-level settings (for example a shared listing limit).
