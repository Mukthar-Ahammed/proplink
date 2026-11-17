"use client";

import { useActionState, useId } from "react";

import { overrideCompanyCheckAction, type OverrideFormState } from "./actions";

const INPUT =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body focus:border-accent focus:outline-none";

export function OverrideForm({ profileId }: { profileId: string }) {
  const [state, formAction, pending] = useActionState(overrideCompanyCheckAction, {
    kind: "idle",
  } as OverrideFormState);
  const id = useId();

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="profileId" value={profileId} />
      <label htmlFor={`${id}-reason`} className="block text-xs font-medium text-primary">
        Reason (logged)
      </label>
      <textarea
        id={`${id}-reason`}
        name="reason"
        required
        minLength={10}
        maxLength={500}
        rows={2}
        className={INPUT}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          name="decision"
          value="APPROVED"
          disabled={pending}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
        >
          Approve
        </button>
        <button
          type="submit"
          name="decision"
          value="REJECTED"
          disabled={pending}
          className="rounded-lg border border-danger px-3 py-1.5 text-xs font-semibold text-danger disabled:opacity-60"
        >
          Reject
        </button>
      </div>
      {state.kind === "error" && (
        <p role="alert" className="text-xs text-danger">
          {state.message}
        </p>
      )}
      {state.kind === "saved" && (
        <p role="status" className="text-xs text-success">
          Decision saved.
        </p>
      )}
    </form>
  );
}
