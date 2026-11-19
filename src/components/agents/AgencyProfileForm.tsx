"use client";

import { useActionState } from "react";

import {
  createAgencyProfileAction,
  type AgencyProfileFormState,
} from "@/app/agent/profile/actions";
import { BUTTON, INPUT, LABEL } from "@/app/landlord/listings/ui";

/**
 * Self-service agency profile form (ADR-074). Used for the first profile on
 * `/agent/profile` and for adding another one.
 */
export function AgencyProfileForm({
  suggestedName,
  submitLabel = "Create agency profile",
}: {
  /** Pre-filled from the company the Agent confirmed on Companies House. */
  suggestedName: string;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(createAgencyProfileAction, {
    kind: "idle",
  } as AgencyProfileFormState);

  return (
    <form action={formAction} className="space-y-5 text-left">
      <div>
        <label htmlFor="agencyName" className={LABEL}>
          Agency name
        </label>
        <input
          id="agencyName"
          name="agencyName"
          required
          minLength={2}
          maxLength={120}
          defaultValue={suggestedName}
          placeholder="e.g. Northgate Distressed Assets"
          className={`mt-1.5 ${INPUT}`}
        />
        <p className="mt-1.5 text-xs text-muted">
          The name buyers, landlords and investors see on your listings.
        </p>
      </div>
      <div>
        <label htmlFor="bio" className={LABEL}>
          About the agency <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id="bio"
          name="bio"
          rows={4}
          maxLength={2000}
          placeholder="Areas you cover and the kinds of property you handle."
          className={`mt-1.5 resize-y ${INPUT}`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? "Creating…" : submitLabel}
        </button>
        {state.kind === "error" ? (
          <p role="alert" className="text-sm font-semibold text-danger">
            {state.message}
          </p>
        ) : state.kind === "created" ? (
          <p role="status" className="text-sm font-semibold text-success">
            {state.agencyName} is ready.
          </p>
        ) : null}
      </div>
    </form>
  );
}
