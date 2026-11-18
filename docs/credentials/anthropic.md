# Anthropic (AI listing assistant)

## Purpose and status

Powers the Landlord's AI listing assistant (Phase 2 Task 2, ADR-036; business
Q5). The Landlord types a few words about the property; the AI drafts the
description, defects and work-required text; the Landlord reviews the draft,
puts it into the listing form, edits it and saves. The AI has no tools and
cannot read or change anything.

- Interface: `src/services/ai/` (`AiProvider`).
- Real adapter: `AnthropicAiProvider` (official `@anthropic-ai/sdk`, Messages
  API with structured JSON output, effort `low`, server-side refusal
  fallback).
- Mock adapter: `MockAiProvider`, which builds a plain `[Mock draft]` from the
  Landlord's own answers with no network call.
- Status: **not configured** in any environment. Local development and tests
  use the mock. Human task H1.9.

## Environment variables

| Key                              | Scope       | Values / notes                                                                                                                  |
| -------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `AI_PROVIDER`                    | server-only | `mock` (default outside production), `anthropic` (default in production) or `disabled` (assistant hidden; server refuses calls) |
| `ANTHROPIC_API_KEY`              | server-only | Required when the provider is `anthropic`                                                                                       |
| `AI_MODEL`                       | server-only | Default `claude-opus-5-5`                                                                                                       |
| `AI_DAILY_TOKEN_BUDGET_PER_USER` | server-only | Default `40000` tokens per Landlord per UTC day (about eight drafts)                                                            |
| `AI_GLOBAL_DAILY_BUDGET`         | server-only | Default `1000000` tokens per UTC day across everyone; at Opus 5.5 prices this caps spend at roughly US$20 a day                 |

The app refuses to start in production with the mock provider, or with the
`anthropic` provider and no key. Set `AI_PROVIDER=disabled` to launch without
the assistant. Never use a `NEXT_PUBLIC_` name for the key.

## Create the account and key

1. Go to `https://console.anthropic.com/` and sign up with a shared team
   mailbox, not a personal one. Create an organisation named for PropLink.
2. **Billing:** add a payment method and buy a small amount of prepaid credit
   (for example US$20 for development).
3. **Spend limit:** in Settings → Limits, set a monthly spend limit (for
   example US$50 for development, the agreed figure for production). This is
   the hard stop; the app's daily budgets above are the first line.
4. **Workspaces:** create separate workspaces for development and production
   so each has its own key and its own limit.
5. **API key:** in the workspace, Settings → API keys → Create key. Name it
   `proplink-<environment>-listing-assistant`. Copy it once.
6. Put it in `.env.local` (development) or the hosting provider's secret store
   (staging, production) as `ANTHROPIC_API_KEY`, and set
   `AI_PROVIDER=anthropic`. Restart the app.

## Smoke test (real provider)

1. With the key set, sign in as a Landlord with an editable listing.
2. Open the listing, expand "Draft the description with the AI assistant",
   type a few words in each box and press "Write a draft".
3. Expect a draft within a few seconds, with no `[Mock draft]` prefix. Press
   "Put this draft into the form", then "Save draft".
4. Check the server log for one `ai.usage` line with `outcome: "ok"`,
   `provider: "anthropic"` and token counts, and no listing text.
5. Check `public.ai_usage` has a `COMPLETED` row with token counts.

Record the date and result in `docs/phases/PHASE-2-REPORT.md`.

## Rotation

Rotate at least every 90 days, when someone with access leaves, or at once if
the key may have leaked:

1. Create a new key in the same workspace.
2. Replace `ANTHROPIC_API_KEY` in each environment and redeploy.
3. Confirm one assistant draft works (smoke test steps 2-4).
4. Delete the old key in the console.

## What is sent and what is logged

- **Sent:** only the Landlord's short answers from the assistant boxes, plus
  property type, town and desired outcome from the form. Email addresses,
  phone numbers and links are removed first, and each answer is length
  capped. The street address and postcode are never sent.
- **Logged:** usage only (`ai.usage` events and `public.ai_usage` rows: user,
  feature, model, token counts, outcome). Prompts and drafts are never
  logged or stored by PropLink.
- Anthropic's own data-retention terms apply to API traffic; check them before
  production and record the result with H5.2.
