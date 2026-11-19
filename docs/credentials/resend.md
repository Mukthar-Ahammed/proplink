# Resend

## Purpose and status

Resend delivers verification, password-reset, and notification email. The local
mock accepts messages without logging the recipient, subject, body, or tokens.

## Create and configure

1. Create a separate Resend account/project for each environment where email is
   needed.
2. Verify a sender domain and configure its required DNS records.
3. Create an API key restricted to sending email for the verified domain.
4. Store the key as server-only `RESEND_API_KEY` and set `EMAIL_PROVIDER=resend`.
   Set `EMAIL_FROM` to the verified sender.

## Permissions, rotation, and testing

Do not grant unrelated account permissions to the sending key. Rotate by
creating a replacement key, updating the relevant secret store, sending a
staging verification/reset message, and revoking the old key. Verify failures
return a generic client response and do not log provider response bodies.

## Cost and data handling

Pricing and sending limits vary by plan. Email content can contain personal
information and one-time links; complete the DPA and retention review before
production use.

## Development setup in use (2026-11-18, no domain yet)

Supabase Auth emails (sign-up confirmation, password reset) on the
**development** Supabase project go through Resend SMTP:

1. Resend account; API key with **Sending access** (kept only in Supabase's
   SMTP settings, never in the repo or chat).
2. Supabase → Authentication → Emails → SMTP Settings → custom SMTP:
   host `smtp.resend.com`, port `465`, username `resend`, password = the API
   key, sender `onboarding@resend.dev`, sender name `PropLink UK (dev)`.
3. Supabase → Authentication → URL Configuration: Site URL
   `http://localhost:3000`, redirect URL `http://localhost:3000/**`.
4. Templates link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
   (confirm sign-up) and `...&type=recovery` (reset password).

Limits: without a verified domain Resend delivers only to the Resend account
owner's address, so test sign-ups must use that address (or a `+` alias of
it). The app's own emails stay on the mock (`EMAIL_PROVIDER` unset) and show at
`/dev/mail`. For staging/production: buy and verify a domain (SPF, DKIM,
DMARC), send from it, and set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` and
`EMAIL_FROM` in the app.
