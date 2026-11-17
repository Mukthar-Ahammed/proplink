"use client";

import Link from "next/link";
import { useActionState } from "react";

import { confirmAccountAction, type ConfirmFormState } from "./actions";

export function ConfirmForm() {
  const [state, formAction, pending] = useActionState(confirmAccountAction, {
    kind: "idle",
  } as ConfirmFormState);

  if (state.kind === "done") {
    return (
      <p role="status" className="text-sm text-success">
        Thank you. Your account is confirmed and is now waiting for PropLink to authorise
        it. Your listings and leads keep working in the meantime.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <label className="flex items-start gap-3 text-sm text-body">
        <input
          type="checkbox"
          name="acceptTerms"
          required
          className="mt-1 h-4 w-4 accent-[var(--color-accent)]"
        />
        <span>
          I confirm these details are mine and I accept the{" "}
          <Link href="/terms" className="text-accent underline">
            terms of service
          </Link>
          .
        </span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Confirming…" : "Confirm my account"}
      </button>
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      )}
    </form>
  );
}
