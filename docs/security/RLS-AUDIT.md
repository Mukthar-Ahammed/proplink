# Database access audit (Phase 7 Task 2)

Evidence: `tests/integration/rls-audit-db.test.ts` (disposable database, 9
tests) and the service-level matrices (`tests/unit/permission-matrix.test.ts`
for the section-5 role matrix, `tests/unit/admin-permissions.test.ts` for
Admin permissions). ADR-063.

## Layers

| Layer                         | Enforces                                                                                                                                 | Evidence                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Server guards and services    | Role, relationship, KYC, subscription, Admin permission on every page, action and API                                                    | permission-matrix, admin-permissions, per-feature DB tests |
| Database triggers             | Business rules that must hold even if a service is bypassed (pledge caps, Buyer-only offers, ledger, reviews, maker-checker, cases, ads) | `*-db.test.ts` files (raw SQL bypass attempts)             |
| Row-level security and grants | Client roles (`anon`, `authenticated`): deny by default; a short list of policy-backed reads                                             | rls-audit-db                                               |

## Client role summary (after migration 20261121000000)

- **RLS:** on for every public table (108 of 109; `spatial_ref_sys` is
  PostGIS reference data).
- **Writes:** none, for either client role, on any table.
- **Reads:** 38 tables have a reviewed, policy-backed SELECT grant (12 also
  for `anon`: public listing, agency, case-study, comparable-sale and
  partner data). Everything else refuses both roles.
- **Data API:** off (`scripts/check-data-api.ps1`); the app uses the server
  role only.

## Roles in the app (enforced on the server, tested)

Landlord, Agent, Investor (Lead and Co-Investor), Buyer, Solicitor (one
project's scope), Admin (13 permissions, ADR-058), Advertiser (no login,
OD-25). See `docs/security/THREAT-MODEL.md` §2.

## Still to do on real environments (H7.2, H7.3)

- Re-run the Supabase Security Advisor on staging and production and
  resolve findings.
- Production: PostGIS, pg_trgm and fuzzystrmatch in an `extensions` schema
  from project creation; confirm the Data API is off.
