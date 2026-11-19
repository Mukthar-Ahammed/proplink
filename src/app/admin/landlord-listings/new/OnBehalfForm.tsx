"use client";

import { useActionState } from "react";

import { createOnBehalfAction, type OnBehalfState } from "./actions";

const INPUT =
  "w-full rounded-2xl border border-line bg-white px-3 py-2 text-sm text-body focus:border-accent focus:outline-none";

function Text({
  name,
  label,
  max,
  type = "text",
  multiline,
  required,
}: {
  name: string;
  label: string;
  max: number;
  type?: string;
  multiline?: boolean;
  required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="block text-sm font-medium text-primary">
        {label}
      </label>
      {multiline ? (
        <textarea id={name} name={name} rows={4} maxLength={max} className={INPUT} />
      ) : (
        <input
          id={name}
          name={name}
          type={type}
          maxLength={max}
          required={required}
          className={INPUT}
        />
      )}
    </div>
  );
}

export function OnBehalfForm() {
  const [state, formAction, pending] = useActionState(createOnBehalfAction, {
    kind: "idle",
  } as OnBehalfState);

  if (state.kind === "created") {
    return (
      <div role="status" className="space-y-2 text-sm">
        <p className="font-semibold text-success">Listing created for the Landlord.</p>
        <p className="text-muted">
          It now waits for the Landlord: they check the details, add their ownership
          documents and confirm, which also requires their identity check. It does not
          enter the review queue until they confirm.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="max-w-2xl space-y-5">
      <Text
        name="landlordEmail"
        label="Landlord's account email"
        type="email"
        max={320}
        required
      />
      <Text name="title" label="Title" max={120} required />
      <Text name="addressLine1" label="Address" max={200} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Text name="city" label="Town or city" max={100} />
        <Text name="postcode" label="Postcode" max={10} />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-primary">Property or land</legend>
        <label className="mr-6 inline-flex items-center gap-2 text-sm">
          <input type="radio" name="propertyKind" value="PROPERTY" defaultChecked />{" "}
          Property
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="radio" name="propertyKind" value="LAND" /> Development land
        </label>
      </fieldset>
      <Text name="landAreaSqm" label="Land area in square metres (land only)" max={9} />
      <Text name="description" label="Description" max={5000} multiline />
      <Text name="requiredWork" label="Work required" max={3000} multiline />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-primary">Desired outcome</legend>
        <label className="mr-6 inline-flex items-center gap-2 text-sm">
          <input type="radio" name="desiredOutcome" value="REFURBISHMENT" /> Refurbishment
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="radio" name="desiredOutcome" value="DEVELOPMENT_JV" /> Development
          joint venture
        </label>
      </fieldset>
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create for this Landlord"}
      </button>
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      )}
    </form>
  );
}
