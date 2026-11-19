# ADR-048: Project agreements and e-signature

- **Status:** Accepted (2026-11-18)
- **Phase:** 4, Task 6 · **Business sources:** Q16-Q17 (agreements signed in
  the app via the Solicitor), SO-2; OD-05; OD-06 (loss allocation and
  cancellation are agreement terms); OD-14 (Landlord a party only where the
  agreement names them); Q44 (expired links, failed signing); new OD-24
  (provider choice)

## Decision

1. **Provider interface with two adapters.** Dropbox Sign by default (OD-24,
   owner confirms; DocuSign would be another adapter) and a mock that is
   refused in production. Production deployments also refuse test-mode
   signatures. Credentials and the live smoke test:
   `docs/credentials/esignature.md`.
2. **Non-embedded signing with Dropbox Sign.** Each signer gets Dropbox
   Sign's own email; PropLink shows progress and can re-send. This needs no
   client-side library or CSP change. (Embedded signing inside PropLink pages
   can be added later behind the same `signingUrl`.) The mock issues
   HMAC-signed, 30-minute signing links to `/esign/mock` for the party only.
3. **Agreements** (`project_agreements`, versioned per project) are prepared
   by the project's ACTIVE Solicitor from their own clean PDF upload, once
   the project is funded; one draft or sent agreement at a time. Parties
   (`agreement_parties`): every live pledge (share default = pledge ÷
   capital, split with the largest-remainder rule so it is exactly 100%),
   the Agent (signs without an interest by default), and the Landlord in a
   development JV or when the agreement names them. The Solicitor may set
   the shares written in the agreement while it is a draft; they must add
   up to 100% (service and trigger). Loss allocation, the cancellation
   payment and other terms are stored as written and displayed, never
   computed.
4. **Sending:** the draft goes to the provider as one envelope; terms,
   parties and shares are then fixed (trigger). Pledges named in an
   agreement out for signature cannot be cancelled (trigger).
5. **Events:** `POST /api/webhooks/esign`. Verified by the provider's
   signature (Dropbox Sign event hash; mock HMAC header); forgeries 401,
   malformed or stale (older than 7 days) 400; each event recorded only
   after it was applied (append-only `esign_webhook_events`), so replays are
   acknowledged without effect and a failed run is retried by the provider.
   Every state change is guarded by the current status.
6. **Completion:** when every party has signed, the signed PDF is downloaded,
   stored through the upload pipeline (scanned, private, owned by the
   Solicitor) with its SHA-256, the agreement becomes SIGNED and a trigger
   makes every named pledge BINDING. Signed agreements never change or get
   deleted. Settlement (Task 8) reads shares from the latest signed
   agreement (`signedShares`).
7. **Who sees what:** the project's Solicitor, Admin and Agent see every
   version and party; investors and the Landlord see the agreements they
   are a party to (not drafts) with only their own row; parties download
   the signed PDF through access-checked, short-lived links. A Solicitor's
   Data API session reads only their project's agreements (RLS, ADR-047).
8. **Q44:** declined or expired agreements stay as they are; Admin
   re-issues a fresh version (sent straight away, with the parties whose
   pledges are still live) or re-sends a pending signer's link. Voiding
   (Solicitor or Admin) cancels the envelope.

## Consequences

- Chat does not offer "send for signature" (the Phase 3 groundwork hook is
  removed); agreements live on the project.
- Uploads must be enabled where agreements are signed (the signed PDF is
  stored through the pipeline).
