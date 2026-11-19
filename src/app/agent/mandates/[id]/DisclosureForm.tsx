"use client";

import { useActionState } from "react";

import { updateDisclosureAction, type MandateState } from "../actions";

const IDLE: MandateState = { kind: "idle" };

export type DisclosureFieldView = {
  key: string;
  label: string;
  personal: boolean;
  checked: boolean;
};

/**
 * TRD AG-7: the mandated Agent chooses which Landlord data investors will
 * see when they publish (Phase 4). Personal details start unticked.
 */
export function DisclosureForm({
  mandateId,
  fields,
}: {
  mandateId: string;
  fields: DisclosureFieldView[];
}) {
  const [state, action, pending] = useActionState(updateDisclosureAction, IDLE);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="mandateId" value={mandateId} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-primary">
          Show investors (when you publish)
        </legend>
        {fields.map((field) => (
          <label key={field.key} className="flex items-center gap-2 text-sm text-body">
            <input type="checkbox" name={field.key} defaultChecked={field.checked} />
            {field.label}
            {field.personal && (
              <span className="text-xs text-warning">Landlord&apos;s personal data</span>
            )}
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-muted">
        Never shown to investors: the landlord&apos;s contact details and ownership
        documents. Town and postcode district are always shown.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={pending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save what investors see"}
        </button>
        {state.kind !== "idle" && (
          <p
            role={state.kind === "error" ? "alert" : "status"}
            className={
              state.kind === "error" ? "text-sm text-danger" : "text-sm text-success"
            }
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
