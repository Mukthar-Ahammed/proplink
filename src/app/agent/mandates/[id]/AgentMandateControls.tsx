"use client";

import { useActionState, useState } from "react";

import {
  BUTTON,
  DANGER_SM,
  INPUT,
  LABEL,
  SECONDARY,
  SECONDARY_SM,
} from "@/app/landlord/listings/ui";

import { agentMandateAction, type MandateState } from "../actions";

const IDLE: MandateState = { kind: "idle" };

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
      <button type="button" onClick={() => setOpen(true)} className={DANGER_SM}>
        Terminate early…
      </button>
    );
  }
  return (
    <form
      action={action}
      className="space-y-3 rounded-2xl border border-danger/30 bg-danger/5 p-4"
    >
      <input type="hidden" name="mandateId" value={mandateId} />
      <input type="hidden" name="intent" value="terminate" />
      <label className={`${LABEL} space-y-1.5`}>
        <span className="block">Why are you ending it? (shared with the landlord)</span>
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
        <button type="button" onClick={() => setOpen(false)} className={SECONDARY_SM}>
          Cancel
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}
