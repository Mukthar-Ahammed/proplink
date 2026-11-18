"use client";

import { useActionState } from "react";

import { createListingAction, type FormState } from "../actions";

const INPUT =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body focus:border-accent focus:outline-none";

export function NewListingForm() {
  const [state, formAction, pending] = useActionState(createListingAction, {
    kind: "idle",
  } as FormState);
  return (
    <form action={formAction} className="max-w-xl space-y-5">
      <div className="space-y-1">
        <label htmlFor="title" className="block text-sm font-medium text-primary">
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
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-primary">
          What are you listing?
        </legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="propertyKind" value="PROPERTY" defaultChecked />A
          property (house, flat, commercial building)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="propertyKind" value="LAND" />
          Development land
        </label>
      </fieldset>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create draft"}
      </button>
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      )}
    </form>
  );
}
