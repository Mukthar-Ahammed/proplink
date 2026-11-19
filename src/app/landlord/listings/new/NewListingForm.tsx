"use client";

import { useActionState } from "react";

import { createListingAction, type FormState } from "../actions";
import { BUTTON, CHOICE, INPUT, LABEL } from "../ui";

export function NewListingForm() {
  const [state, formAction, pending] = useActionState(createListingAction, {
    kind: "idle",
  } as FormState);
  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-1.5">
        <label htmlFor="title" className={LABEL}>
          Title
        </label>
        <input
          id="title"
          name="title"
          required
          minLength={3}
          maxLength={120}
          placeholder="e.g. Victorian terrace needing full renovation"
          className={INPUT}
        />
      </div>
      <fieldset>
        <legend className={`${LABEL} mb-2`}>What are you listing?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={CHOICE}>
            <input
              className="accent-accent"
              type="radio"
              name="propertyKind"
              value="PROPERTY"
              defaultChecked
            />
            <span>
              <span className="block font-semibold text-primary">A property</span>
              <span className="text-xs text-muted">House, flat, commercial building</span>
            </span>
          </label>
          <label className={CHOICE}>
            <input
              className="accent-accent"
              type="radio"
              name="propertyKind"
              value="LAND"
            />
            <span>
              <span className="block font-semibold text-primary">Development land</span>
              <span className="text-xs text-muted">
                Plots, paddocks, brownfield sites
              </span>
            </span>
          </label>
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? "Creating…" : "Create draft"}
        </button>
        {state.kind === "error" && (
          <p role="alert" className="text-sm text-danger">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
