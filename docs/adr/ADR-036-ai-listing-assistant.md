# ADR-036: AI listing assistant

- **Status:** Accepted (2026-11-18)
- **Phase:** 2, Task 2 · **Business source:** Q5 (AI listing assistant)

## Context

Landlords of distressed properties often struggle to describe them. Q5 asks
for an AI assistant that turns short answers into a listing description. The
phase prompt requires: server-side calls only, untrusted input, no tools, no
PII beyond what the Landlord typed, length-limited and sanitised output,
usage-only logging, a per-user rate limit, per-user and global daily token
budgets, and a mock for local development.

## Decision

1. **Providers.** `src/services/ai/` exposes `AiProvider` with a mock and an
   Anthropic adapter (official SDK). `AI_PROVIDER=mock|anthropic|disabled`;
   production refuses the mock and requires a key for `anthropic`.
2. **Model call.** One Messages API request, model `AI_MODEL` (default
   `claude-opus-5-5`), effort `low`, at most 4,000 output tokens, structured
   JSON output (`description`, `defects`, `requiredWork`) validated by Zod,
   and server-side refusal fallback (`fallbacks: "default"`). No tools. The
   system prompt stays on the server; the Landlord's answers go in a
   `<landlord_answers>` block that the prompt says to treat as data.
3. **Input.** Each answer is normalised, stripped of control characters,
   email addresses, phone numbers, links and angle brackets, and capped (300
   characters, 600 for "anything else"). Address and postcode are never sent.
4. **Output.** Treated as untrusted text: markup, links and emails removed,
   capped to the listing column limits, shown for review, and only put into
   the form when the Landlord chooses. Nothing is saved automatically.
5. **Limits.** 10 drafts per user per hour (database-backed limiter). Daily
   token budgets per user and globally, held in a new `ai_usage` ledger: each
   call reserves its worst case (estimated input plus maximum output) under a
   single advisory lock, then the reservation is replaced by the actual
   usage. Concurrent calls therefore cannot overshoot a budget. Days are UTC.
6. **Logging.** `ai.usage` events and `ai_usage` rows record user, feature,
   model, token counts and outcome; never prompts or drafts. Provider errors
   log the HTTP status only.

## Consequences

- The Anthropic console's monthly spend limit (H1.9) is the hard stop; the
  daily budgets keep normal use well below it.
- A crashed request leaves its reservation counted for that day (errs on the
  side of spending less).
- Real-provider smoke test waits for the key (BLOCKERS); the mock covers
  development and tests.
- The same service and ledger can serve later AI features (feature name per
  row, e.g. the Phase 4 calculator explainer).
