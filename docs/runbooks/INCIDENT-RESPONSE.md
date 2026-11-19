# Runbook: incident response

For any event that affects security, personal data, money records or
availability. Keep a timeline in the incident note from the first minute.

## 1. Classify (first 15 minutes)

| Severity  | Examples                                                                                                                                 | Who                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **SEV-1** | Personal data exposed; private listing visible to the wrong people; ledger or agreement tampered; Admin account taken over; site down    | Owner + developer immediately           |
| **SEV-2** | A provider down (KYC, e-signature, email, Stripe); rate limiter degraded; a role can do something it should not, without evidence of use | Developer within 1 hour; owner informed |
| **SEV-3** | Single-user bug, cosmetic issue                                                                                                          | Normal work                             |

## 2. Contain

- **Suspected account takeover (Admin or Solicitor):** Admin → Users →
  deactivate the account (revokes sessions); revoke its Admin permissions at
  Admin → Admin Roles (needs a second super-admin). Rotate any key it could
  see ([`KEY-ROTATION.md`](KEY-ROTATION.md)).
- **Data exposure through a page or API:** disable the route by deploying a
  revert ([`DEPLOY-AND-ROLLBACK.md`](DEPLOY-AND-ROLLBACK.md)) or, quicker,
  turn the feature flag off if one exists (`UPLOADS_ENABLED`,
  `AI_PROVIDER=disabled`, `FLIPPER_FLOWS_ENABLED=false`) and redeploy.
- **Leaked secret:** rotate it first, investigate after.
- **Abuse/traffic spike:** limits fail closed for sensitive routes; check
  Admin → System → Security events; block offending IP ranges at Vercel
  Firewall.

## 3. Investigate

- Audit log (append-only): query `"AuditLog"` by actor, entity and time in the database (the Admin audit page is not built yet; sidebar "soon").
- Security events (per-minute counts) and Sentry issues for the window.
- Vercel runtime logs: `security.*`, `jobs.*`, `notification.*` events.
- Database: chat authorisation history, data-request records, ledger
  entries are append-only and show who did what.

## 4. Personal data breach (UK GDPR)

If personal data was, or may have been, accessed without authorisation:

1. Record facts: what data, whose, how many, when, how found.
2. **Report to the ICO within 72 hours** of becoming aware, unless the
   breach is unlikely to result in a risk to people's rights (record why).
3. Tell affected people without undue delay if the risk is high.
4. KYC or financial records involved: also inform the KYC provider and the
   project Solicitor.

## 5. Recover and learn

- Restore from backup only per [`RESTORE.md`](RESTORE.md).
- Within 5 working days: a short write-up (timeline, cause, fix, follow-up
  tasks), an ADR if a design changes, and a test that would have caught it.
