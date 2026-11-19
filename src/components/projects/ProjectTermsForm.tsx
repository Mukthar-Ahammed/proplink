"use client";

import { useActionState } from "react";

export type ProjectFormState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "done"; message: string };

const IDLE: ProjectFormState = { kind: "idle" };

export type ProjectTermsDefaults = {
  title?: string;
  summary?: string;
  mode?: "REFURBISHMENT" | "DEVELOPMENT_JV";
  capitalRequired?: string;
  minimumPledge?: string;
  fundingDeadline?: string;
  purchase?: string;
  marketValue?: string;
  expectedProfit?: string;
  expectedMonths?: string;
};

const input =
  "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body";

function Field({
  label,
  name,
  hint,
  defaultValue,
  type = "text",
  required = true,
}: {
  label: string;
  name: string;
  hint?: string;
  defaultValue?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm font-medium text-primary">
      {label}
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        inputMode={type === "text" && name !== "title" ? "decimal" : undefined}
        className={input}
      />
      {hint && <span className="mt-1 block text-xs font-normal text-muted">{hint}</span>}
    </label>
  );
}

/**
 * Project terms (Phase 4 Task 1). Used to publish and, until the project
 * opens for investment, to edit. Amounts in pounds; the server converts to
 * pence and is authoritative.
 */
export function ProjectTermsForm({
  action,
  hidden,
  defaults = {},
  submitLabel,
  notice,
}: {
  action: (state: ProjectFormState, formData: FormData) => Promise<ProjectFormState>;
  hidden: Record<string, string>;
  defaults?: ProjectTermsDefaults;
  submitLabel: string;
  notice: string;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  return (
    <form action={formAction} className="space-y-4">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Field
        label="Title investors see"
        name="title"
        defaultValue={defaults.title}
        type="text"
        hint="Your own title; the landlord's listing title is never shown."
      />
      <label className="block text-sm font-medium text-primary">
        Summary
        <textarea
          name="summary"
          required
          rows={5}
          defaultValue={defaults.summary}
          className={input}
        />
      </label>
      <label className="block text-sm font-medium text-primary">
        Project type
        <select
          name="mode"
          defaultValue={defaults.mode ?? "REFURBISHMENT"}
          className={input}
        >
          <option value="REFURBISHMENT">Refurbishment / build</option>
          <option value="DEVELOPMENT_JV">
            Development joint venture (landlord is a party)
          </option>
        </select>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Total capital required (£)"
          name="capitalRequired"
          defaultValue={defaults.capitalRequired}
        />
        <Field
          label="Minimum pledge (£)"
          name="minimumPledge"
          defaultValue={defaults.minimumPledge}
        />
        <Field
          label="Funding deadline"
          name="fundingDeadline"
          type="date"
          defaultValue={defaults.fundingDeadline}
        />
        <Field
          label="Purchase amount (£)"
          name="purchase"
          defaultValue={defaults.purchase}
        />
        <Field
          label="Market value (£)"
          name="marketValue"
          defaultValue={defaults.marketValue}
        />
        <Field
          label="Expected profit (£, optional)"
          name="expectedProfit"
          required={false}
          defaultValue={defaults.expectedProfit}
          hint="Shown to investors only once financial promotions are approved."
        />
        <Field
          label="Expected time (months, optional)"
          name="expectedMonths"
          required={false}
          defaultValue={defaults.expectedMonths}
        />
      </div>
      <p className="rounded-lg border border-line bg-surface p-3 text-xs text-muted">
        {notice}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={pending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : submitLabel}
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
