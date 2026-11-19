# Admin A5 — Verification record

## Repository findings

- The repository has no `Agency` model or Agency foreign key. `AgentProfile.agencyName` is a string; there is no agency owner/admin, approval state, or agency-level listing cap.
- The listing cap is an existing `Subscription.listingLimit` on `agentUserId`, with a three-live-listing default when no subscription exists. Counting is per Agent user and counts only `Property.status = LIVE`; approval fails when the current count is at the limit.
- Compliance codes are real `AgentProfile.complianceCode` fields, but no compliance approval workflow is inferred or invented.

## A5 scope result

Implemented: `/admin/users`, `/admin/users/[userId]`, `/admin/agents`, `/admin/agents/[agentId]`, server-backed filters/pagination, safe projections, account-state governance, audit events, Agent listing counts, and direct Admin page guards.

Not implemented: Agency management routes, role changes, subtype changes, KYC decisions, identity/email edits, account deletion, Agent impersonation, and editable listing-cap configuration.

## Verification

TypeScript compilation passes. Targeted ESLint passes for all A5 files. The focused A5 suites pass: 2 test files / 6 tests. The complete suite passes serially with `npm.cmd test -- --maxWorkers=1`: 61 test files / 753 tests / 0 failures, including the 60-file / 750-test baseline plus the new A5 coverage. The default parallel command experienced 29 transient database integration failures under the local Supabase pool; the affected integration file passed independently and the serialized complete suite passed without code changes. Repository-wide lint remains blocked by pre-existing A3/A4/future-phase hook-rule errors and a scratch file; none are in A5 files. Phase A6 was not started and no production system was accessed.

Responsive and accessibility verification was not run in a browser at the required 1440px, 1024px, 768px, and 375px viewports. The pages use responsive layout primitives, table overflow handling, labels, and keyboard-native controls, but this remains an A5 exit-gate item requiring browser verification before the phase can be marked fully PASS.

### Browser matrix

Microsoft Edge was located at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`. Playwright successfully launched Edge with `channel: "msedge"`, and the local Next.js server was available on `http://localhost:3000`. The first Edge navigation exposed and fixed an A5 defect: `/admin/login` was self-redirecting because the pathname header was not forwarded through the middleware request. `src/lib/supabase/proxy.ts` and `src/proxy.ts` now forward that header; `/admin/login` returns 200 and protected routes redirect to it correctly when unauthenticated.

`A5_ADMIN_EMAIL` and `A5_ADMIN_PASSWORD` were present in `.env.local` and loaded only inside the Playwright process. The real `/admin/login` form was submitted in Edge, but the page remained on `/admin/login` and no active Admin session was established. No credential was printed, guessed, reused from another account, or used to bypass authorization. Therefore the following authenticated route/viewport combinations remain unverified:

| Route                     | 1440px                                          | 1024px                                          | 768px                                           | 375px                                           |
| ------------------------- | ----------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| `/admin/users`            | BLOCKED — Admin login did not establish session | BLOCKED — Admin login did not establish session | BLOCKED — Admin login did not establish session | BLOCKED — Admin login did not establish session |
| `/admin/users/[userId]`   | BLOCKED — Admin login did not establish session | BLOCKED — Admin login did not establish session | BLOCKED — Admin login did not establish session | BLOCKED — Admin login did not establish session |
| `/admin/agents`           | BLOCKED — Admin login did not establish session | BLOCKED — Admin login did not establish session | BLOCKED — Admin login did not establish session | BLOCKED — Admin login did not establish session |
| `/admin/agents/[agentId]` | BLOCKED — Admin login did not establish session | BLOCKED — Admin login did not establish session | BLOCKED — Admin login did not establish session | BLOCKED — Admin login did not establish session |

### Test reconciliation

The previous report described six A5 tests, but the suite increased by three tests because three of those six were already present in the 60-file/750-test baseline. The current six A5 tests are:

- `tests/unit/admin-users.test.ts`: `deactivates a user AND writes an audit row`, `reactivates both identity rows atomically`, `refuses self-deactivation`, `requires an active Admin actor`, `protects the last active Admin`.
- `tests/unit/admin-a5-agents.test.ts`: `uses bounded server-side search/pagination and returns status counts`.

Compared with the baseline, the three newly added tests are `reactivates both identity rows atomically`, `requires an active Admin actor`, and `protects the last active Admin`; no tests were removed, renamed, or skipped. Command: `npm.cmd test`.

### Repository-wide ESLint

`npm.cmd run lint` reports 12 errors and 25 warnings. Errors are pre-existing outside A5: `scratch/test_bridge.ts` (`prefer-rest-params`, `@typescript-eslint/no-explicit-any`); `src/app/admin/kyc/KycQueueClient.tsx` (two `react-hooks/set-state-in-effect`); `src/app/admin/kyc/[submissionId]/KycReviewStudioClient.tsx` (`react-hooks/set-state-in-effect`); `src/app/admin/moderation/ModerationQueueClient.tsx` (two `react-hooks/set-state-in-effect`); `src/app/admin/moderation/[propertyId]/page.tsx` (`react-hooks/error-boundaries`); `src/app/admin/resales/ResaleQueueClient.tsx` (two `react-hooks/set-state-in-effect`); `src/app/investor/flip/FlipperWorkspaceClient.tsx` (`react-hooks/set-state-in-effect`); and `src/app/investor/flip/projects/[id]/ProjectDetailClient.tsx` (`react-hooks/set-state-in-effect`).

The 25 warnings are existing unused-variable warnings in A3/A4/future-phase tests/components plus three `@next/next/no-img-element` warnings in existing review-studio components. Targeted ESLint over all A5 source and test files reports zero errors and zero warnings. No A5 file introduces a new repository-wide lint finding.

## Phase 6 completion (2026-11-19, ADR-062)

- **Authenticated Admin session:** `tests/e2e/helpers/adminSession.ts`
  (password sign-in, then a test-only MFA recovery grant for that session).
- **Route, viewport and accessibility verification:** `tests/e2e/admin-a5.spec.ts`
  covers 19 main Admin pages at 1440, 1024, 768 and 375 px: no server error,
  heading visible, no sideways scrolling below 1024 px, axe WCAG 2 A/AA
  with no serious or critical findings. Passed against the dev server after
  fixing the defects it found (header contrast on Admin pages, unnamed
  dropdowns, `/admin/users` overflow on phones, low-contrast muted and
  "Soon" elements, warning badges).
- **Agency management:** `/admin/agents/agencies` groups Agents by verified
  company and suspends or reactivates a whole agency (audited).

Still not implemented (unchanged, out of A5 scope): role changes, subtype
changes from the users page, identity/email edits, account deletion
(retention rules are Phase 7), Agent impersonation, editable listing caps.
