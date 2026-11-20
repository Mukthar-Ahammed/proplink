# ADR-078: Project Q&A removed from the screens — investors use Messages

**Status:** Accepted (owner decision, 2026-11-20)
**Date:** 2026-11-20
**Partly replaces:** ADR-046 §3 (project Q&A)

## Context

ADR-046 gave every investor project two ways to ask the Agent something:

- a public **Q&A**: the investor's name is hidden, the Agent answers once,
  every investor on the project sees the answer, and Admin moderates it;
- private **project Messages**: the Agent or Lead chats with one investor.

The owner found two question channels confusing and asked for one:
Messages.

## Decision

- The Q&A section is removed from the investor, Agent and Admin project
  pages. The three server actions behind it (`askQuestionAction`,
  `answerQuestionAction`, `hideQuestionAction`) and `QuestionList` are
  deleted.
- Investors ask questions with **Message the agent** / **Message the
  lead** on the project page. Clarification Answers Q14 ("ask questions")
  is met through Messages.
- The `project_questions` table, its database guards and the service
  functions in `src/services/projects/community.ts` (and their integration
  tests) stay. Migrations must be additive, existing questions are kept for
  audit, and bringing Q&A back would only mean restoring the UI.

## Consequences

- Asking a question now needs what a project chat needs: an active
  Lead/Co-Investor subscription on both sides and PropLink's authorisation
  of the chat. The free, anonymous route to the Agent is gone.
- An answer reaches only the investor who asked. Before, every investor on
  the project saw it. There is no screen for the Agent to send one message to
  every investor on the project; add one if the owner needs it.
