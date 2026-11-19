"use client";

import { useActionState } from "react";

import { startVerificationAction, type VerifyFormState } from "./actions";

/** Starts identity verification with PropLink's verification partner. */
export function VerifyButton({ label = "Verify my identity" }: { label?: string }) {
  const [state, formAction, pending] = useActionState(startVerificationAction, {
    kind: "idle",
  } as VerifyFormState);
  return (
    <form action={formAction} className="space-y-2">
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {pending ? "Opening…" : label}
      </button>
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      )}
    </form>
  );
}
