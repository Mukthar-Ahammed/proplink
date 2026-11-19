"use client";

import { useActionState, useState } from "react";

import { askQuestionAction, declineProposalAction, type FormState } from "../../actions";
import { DANGER_SM, INPUT, SECONDARY_SM } from "../../ui";

const IDLE: FormState = { kind: "idle" };

function Feedback({ state, done }: { state: FormState; done: string }) {
  if (state.kind === "error") {
    return (
      <p role="alert" className="text-sm text-danger">
        {state.message}
      </p>
    );
  }
  if (state.kind === "saved") {
    return (
      <p role="status" className="text-sm text-success">
        {done}
      </p>
    );
  }
  return null;
}

export function AskQuestion({
  listingId,
  proposalId,
}: {
  listingId: string;
  proposalId: string;
}) {
  const [state, action, pending] = useActionState(askQuestionAction, IDLE);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="proposalId" value={proposalId} />
      <textarea
        name="question"
        required
        minLength={5}
        maxLength={500}
        rows={2}
        aria-label="Your question"
        placeholder="Ask about the valuation, fee or terms"
        className={INPUT}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={SECONDARY_SM}>
          {pending ? "Sending…" : "Ask"}
        </button>
        <Feedback state={state} done="Question sent. The agent will answer here." />
      </div>
    </form>
  );
}

export function DeclineProposal({
  listingId,
  proposalId,
}: {
  listingId: string;
  proposalId: string;
}) {
  const [state, action, pending] = useActionState(declineProposalAction, IDLE);
  const [confirming, setConfirming] = useState(false);
  if (state.kind === "saved") return <Feedback state={state} done="Declined." />;
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={DANGER_SM}>
        Decline
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="proposalId" value={proposalId} />
      <button disabled={pending} className={DANGER_SM}>
        Yes, decline
      </button>
      <button type="button" onClick={() => setConfirming(false)} className={SECONDARY_SM}>
        Cancel
      </button>
      <Feedback state={state} done="Declined." />
    </form>
  );
}
