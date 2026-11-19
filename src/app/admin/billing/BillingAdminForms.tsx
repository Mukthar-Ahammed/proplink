"use client";

import { useActionState } from "react";

import { setGraceAction, setPriceAction, type AdminBillingState } from "./actions";

const IDLE: AdminBillingState = { kind: "idle" };
const INPUT = "w-28 rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-body";
const BUTTON =
  "rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60";

function Feedback({ state }: { state: AdminBillingState }) {
  if (state.kind === "idle") return null;
  return (
    <p
      role={state.kind === "error" ? "alert" : "status"}
      className={state.kind === "error" ? "text-xs text-danger" : "text-xs text-success"}
    >
      {state.message}
    </p>
  );
}

export function PriceForm({
  audience,
  interval,
  current,
}: {
  audience: string;
  interval: string;
  current: string;
}) {
  const [state, action, pending] = useActionState(setPriceAction, IDLE);
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="audience" value={audience} />
      <input type="hidden" name="interval" value={interval} />
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted">£</span>
        <input
          name="amount"
          inputMode="decimal"
          defaultValue={current}
          placeholder="not set"
          aria-label={`${audience} ${interval} price in pounds`}
          className={INPUT}
        />
        <button disabled={pending} className={BUTTON}>
          Save
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function GraceForm({ graceDays }: { graceDays: number }) {
  const [state, action, pending] = useActionState(setGraceAction, IDLE);
  return (
    <form action={action} className="space-y-1">
      <label className="flex items-center gap-2 text-sm text-body">
        Grace period after a failed payment
        <input
          name="graceDays"
          type="number"
          min={0}
          max={60}
          defaultValue={graceDays}
          className={INPUT}
        />
        days
      </label>
      <button disabled={pending} className={BUTTON}>
        Save
      </button>
      <Feedback state={state} />
    </form>
  );
}
