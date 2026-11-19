"use client";

import Link from "next/link";
import { useActionState } from "react";

import { BUTTON } from "@/app/landlord/listings/ui";

import { confirmAccountAction, type ConfirmFormState } from "./actions";

export function ConfirmForm() {
  const [state, formAction, pending] = useActionState(confirmAccountAction, {
    kind: "idle",
  } as ConfirmFormState);

  if (state.kind === "done") {
    return (
      <p
        role="status"
        className="rounded-2xl border border-success/25 bg-success/10 p-4 text-sm leading-relaxed text-success"
      >
        Thank you. Your account is confirmed and is now waiting for PropLink to authorise
        it. Your listings and leads keep working in the meantime.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-sm text-body transition-colors hover:border-accent/50 has-[:checked]:border-accent has-[:checked]:bg-pale/60">
        <input
          type="checkbox"
          name="acceptTerms"
          required
          className="mt-1 h-4 w-4 accent-[var(--color-accent)]"
        />
        <span>
          I confirm these details are mine and I accept the{" "}
          <Link
            href="/terms"
            className="font-semibold text-accent underline underline-offset-2 hover:text-accent-strong"
          >
            terms of service
          </Link>
          .
        </span>
      </label>
      <button type="submit" disabled={pending} className={BUTTON}>
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
