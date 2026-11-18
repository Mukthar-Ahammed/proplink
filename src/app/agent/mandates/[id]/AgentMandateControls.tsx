"use client";

import { useActionState, useState } from "react";

import { agentMandateAction, type MandateState } from "../actions";

const IDLE: MandateState = { kind: "idle" };
const BUTTON =
  "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60";
const SECONDARY =
  "rounded-lg border border-line px-4 py-2 text-sm font-semibold text-primary disabled:opacity-60";

function Feedback({ state }: { state: MandateState }) {
  if (state.kind === "idle") return null;
  return (
    <p
      role={state.kind === "error" ? "alert" : "status"}
      className={state.kind === "error" ? "text-sm text-danger" : "text-sm text-success"}
    >
      {state.message}
    </p>
  );
}

export function RespondToOffer({ mandateId }: { mandateId: string }) {
  const [state, action, pending] = useActionState(agentMandateAction, IDLE);
  if (state.kind === "done") return <Feedback state={state} />;
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="mandateId" value={mandateId} />
      <button name="intent" value="accept" disabled={pending} className={BUTTON}>
        Accept the mandate
      </button>
      <button name="intent" value="decline" disabled={pending} className={SECONDARY}>
        Decline
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function TerminateMandate({ mandateId }: { mandateId: string }) {
  const [state, action, pending] = useActionState(agentMandateAction, IDLE);
  const [open, setOpen] = useState(false);
  if (state.kind === "done") return <Feedback state={state} />;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={SECONDARY}>
        Terminate early…
      </button>
    );
  }
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="mandateId" value={mandateId} />
      <input type="hidden" name="intent" value="terminate" />
      <label className="block space-y-1 text-sm font-medium text-primary">
        <span className="block">Why are you ending it? (shared with the landlord)</span>
        <textarea
          name="reason"
          required
          minLength={10}
          maxLength={500}
          rows={3}
          className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body"
        />
      </label>
      <div className="flex flex-wrap gap-3">
        <button disabled={pending} className={SECONDARY}>
          Terminate the mandate
        </button>
        <button type="button" onClick={() => setOpen(false)} className={SECONDARY}>
          Cancel
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}
