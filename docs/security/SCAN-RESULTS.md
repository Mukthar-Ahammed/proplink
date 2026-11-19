# Security scan results

Re-run before launch and after any dependency upgrade. CI runs the
dependency audit, secret scan and Semgrep on every push.

## 2026-11-19 (Phase 7 Task 1), local

| Scan                                                                          | Result                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm audit` (all dependencies)                                                | 0 critical, 0 high, 11 moderate (5 in production dependencies). CI fails on high/critical (`npm run audit:check`). Moderates accepted until upstream fixes; re-checked before launch.                                                                                                                                                                                      |
| gitleaks, full history                                                        | No leaks. Also runs on every commit (hook) and in CI.                                                                                                                                                                                                                                                                                                                      |
| Semgrep 1.97.0 (TypeScript, Next.js, React, secrets, OWASP Top 10; 647 files) | 1 warning: `dangerouslySetInnerHTML` for listing JSON-LD — reviewed and accepted (public fields, `<` and line separators escaped, ADR-057); annotated `nosemgrep`. 0 errors. Generated Prisma code excluded (`.semgrepignore`). Now a CI job.                                                                                                                              |
| Manual review                                                                 | One `$queryRawUnsafe` (AI budget): only a constant is interpolated, values are parameters — safe. Server-side `fetch` only to fixed provider hosts (no SSRF). API routes and server actions without a guard are public by design: ad click and image, the retired appraisal endpoint (410), search count, advertiser application, invitation acceptance (one-time tokens). |

## Not run here (need staging or containers)

- OWASP ZAP baseline against staging (human task H7.2).
- Supabase Security Advisor on staging and production (H7.2).
- Container or image scan: the app deploys to Vercel without a custom
  container image; re-assess if a container (for example ClamAV) is added.
