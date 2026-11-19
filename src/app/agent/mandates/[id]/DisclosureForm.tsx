"use client";

import { useActionState } from "react";

import { BUTTON, LABEL } from "@/app/landlord/listings/ui";

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
    <form action={action} className="space-y-5">
      <input type="hidden" name="mandateId" value={mandateId} />
      <fieldset className="space-y-2.5">
        <legend className={`${LABEL} mb-3`}>Show investors (when you publish)</legend>
        {fields.map((field) => (
          <label
            key={field.key}
            className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-line bg-white px-4 py-3 text-sm text-body transition-colors hover:border-accent/50 has-[:checked]:border-accent has-[:checked]:bg-pale/60 has-[:checked]:text-primary"
          >
            <input
              type="checkbox"
              name={field.key}
              defaultChecked={field.checked}
              className="h-4 w-4 accent-accent"
            />
            {field.label}
            {field.personal && (
              <span className="rounded-full border border-warning/25 bg-warning/10 px-2.5 py-0.5 text-xs font-semibold text-warning">
                Landlord&apos;s personal data
              </span>
            )}
          </label>
        ))}
      </fieldset>
      <p className="text-xs leading-relaxed text-muted">
        Never shown to investors: the landlord&apos;s contact details and ownership
        documents. Town and postcode district are always shown.
      </p>
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <button disabled={pending} className={BUTTON}>
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
