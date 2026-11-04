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
