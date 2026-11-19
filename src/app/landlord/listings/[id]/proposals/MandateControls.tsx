"use client";

import { useActionState, useState } from "react";

import { chooseAgentAction, mandateAction, type FormState } from "../../actions";
import { BUTTON_SM, DANGER_SM, INPUT, SECONDARY_SM } from "../../ui";

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

/** Choose this Agent: offers them the exclusive mandate (business Q7, Q8). */
export function ChooseAgent({
  listingId,
  proposalId,
  agentName,
}: {
  listingId: string;
  proposalId: string;
  agentName: string;
}) {
  const [state, action, pending] = useActionState(chooseAgentAction, IDLE);
  const [open, setOpen] = useState(false);
  if (state.kind === "saved") {
    return <Feedback state={state} done={`Offer sent to ${agentName}.`} />;
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_SM}>
        Choose this agent
      </button>
    );
  }
  return (
    <form
      action={action}
      className="space-y-3 rounded-2xl border border-accent/25 bg-pale/60 p-4"
    >
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="proposalId" value={proposalId} />
      <p className="text-sm leading-relaxed text-body">
        This offers {agentName} an <strong>exclusive</strong> mandate on the terms in
        their proposal. No other agent can work on this property while it lasts.
      </p>
      <label className="block space-y-1 text-sm font-medium text-primary">
        <span className="block">Renewal terms you agreed (optional)</span>
        <textarea name="renewalTerms" maxLength={1000} rows={2} className={INPUT} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={pending} className={BUTTON_SM}>
          {pending ? "Sending…" : "Offer the mandate"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={SECONDARY_SM}>
          Cancel
        </button>
      </div>
      <Feedback state={state} done="" />
    </form>
  );
}

/** Withdraw an unanswered offer, close at contract end, or terminate with a reason. */
export function LandlordMandateControls({
  listingId,
  mandateId,
  status,
  contractEnded,
}: {
  listingId: string;
  mandateId: string;
  status: "OFFERED" | "ACTIVE";
  contractEnded: boolean;
}) {
  const [state, action, pending] = useActionState(mandateAction, IDLE);
  const [terminating, setTerminating] = useState(false);
  if (state.kind === "saved") return <Feedback state={state} done="Done." />;
  const hidden = (
    <>
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="mandateId" value={mandateId} />
    </>
  );
  if (status === "OFFERED") {
    return (
      <form action={action} className="flex flex-wrap items-center gap-2">
        {hidden}
        <button
          name="intent"
          value="withdraw"
          disabled={pending}
          className={SECONDARY_SM}
        >
          Withdraw the offer
        </button>
        <Feedback state={state} done="" />
      </form>
    );
  }
  return (
    <div className="space-y-3">
      {contractEnded && (
        <form action={action} className="flex flex-wrap items-center gap-2">
          {hidden}
          <button name="intent" value="close" disabled={pending} className={BUTTON_SM}>
            Close the mandate (contract ended)
          </button>
        </form>
      )}
      {terminating ? (
        <form
          action={action}
          className="space-y-3 rounded-2xl border border-danger/30 bg-danger/5 p-4"
        >
          {hidden}
          <input type="hidden" name="intent" value="terminate" />
          <label className="block space-y-1 text-sm font-medium text-primary">
            <span className="block">Why are you ending it? (shared with the agent)</span>
            <textarea
              name="reason"
              required
              minLength={10}
              maxLength={500}
              rows={3}
              className={INPUT}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button disabled={pending} className={DANGER_SM}>
              Terminate the mandate
            </button>
            <button
              type="button"
              onClick={() => setTerminating(false)}
              className={SECONDARY_SM}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setTerminating(true)} className={DANGER_SM}>
          Terminate early…
        </button>
      )}
      <Feedback state={state} done="" />
    </div>
  );
}
