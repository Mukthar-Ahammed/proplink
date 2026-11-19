"use client";

import { useActionState } from "react";

import { manageBillingAction, subscribeAction, type BillingState } from "./actions";

const IDLE: BillingState = { kind: "idle" };

function ErrorLine({ state }: { state: BillingState }) {
  return state.kind === "error" ? (
    <p role="alert" className="text-sm text-danger">
      {state.message}
    </p>
  ) : null;
}

export function SubscribeButton({
  audience,
  interval,
  label,
}: {
  audience: string;
  interval: string;
  label: string;
}) {
  const [state, action, pending] = useActionState(subscribeAction, IDLE);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="audience" value={audience} />
      <input type="hidden" name="interval" value={interval} />
      <button
        disabled={pending}
        className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Opening secure checkout…" : label}
      </button>
      <ErrorLine state={state} />
    </form>
  );
}

export function ManageBillingButton() {
  const [state, action, pending] = useActionState(manageBillingAction, IDLE);
  return (
    <form action={action} className="space-y-2">
      <button
        disabled={pending}
        className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-primary disabled:opacity-60"
      >
        {pending ? "Opening…" : "Manage billing"}
      </button>
      <ErrorLine state={state} />
    </form>
  );
}
