# ADR-020: Start Phase 1 while the Phase 0 manual authentication test is pending

**Status:** Accepted
**Date:** 2026-11-16

## Context

Phase 1's prerequisite in `PROPLINK_PHASE_PROMPTS.md` is "Phase 0 exit gate
passed". On 2026-11-16 every Phase 0 exit-gate item had passed or been carried
to a named later phase (ADR-019) except the manual authentication hand test.

That test needs a real inbox (sign-up confirmation and password-reset emails)
and access to the Supabase dashboard (session revocation), so only the owner can
run it. On 2026-11-16 the agent ran the parts that need neither, using the
seeded test accounts against the reconciled development project:

- Buyer login, sign-out, and `/buy` redirecting to `/login` afterwards: pass.
- Unknown email and wrong password give the same generic message: pass.
- The login rate limit blocks the sixth attempt: pass, after fixing two defects
  found on the way (`67ad6c5`): the forms showed nothing when the proxy
  rate-limited a Server Action, and development logs printed Server Action
  arguments, including passwords.

The owner chose to start Phase 1 now rather than wait.

## Decision

- Phase 1 starts on branch `phase-1-roles-access`, created from
  `phase-0-stabilise`.
- **Phase 0 stays open.** The manual authentication test is not waived,
  carried or weakened. The owner runs the remaining steps (1–3, the Admin and
  unverified-account checks in step 4, 6 and 7) and the gate is closed only on
  their reported results.
- Phase 1 starts with work that does not depend on the outcome of the
  remaining manual steps: roles and schema (Task 1), registration rules (Task
  2), Agent invitations (Task 3) and the permission-matrix harness (Task 13).
- Any defect the manual test finds is fixed on `phase-0-stabilise` and merged
  forward into the Phase 1 branch.
- Phase 1 cannot exit, and nothing is merged to `main` or deployed, until the
  Phase 0 gate has passed.

## Consequences

- Phase 1 work may need rework if the manual test exposes an auth defect;
  Tasks 1–3 and 13 touch registration and roles, so that risk is real but
  bounded.
- `docs/phases/PHASE-0-REPORT.md`, `docs/sprints/STATUS.md`,
  `docs/PROJECT-STATUS.md` and `docs/CONTEXT.md` describe Phase 0 as open with
  one owner step pending and Phase 1 as in progress.
