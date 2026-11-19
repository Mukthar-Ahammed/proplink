"use client";

import { useActionState } from "react";

import type { ProjectFormState } from "@/components/projects/ProjectTermsForm";

const IDLE: ProjectFormState = { kind: "idle" };

/**
 * A one-button form for project actions (nominate, accept, approve…). Extra
 * fields (a reason box) can be passed as children.
 */
export function ActionButton({
  action,
  hidden,
  label,
  pendingLabel = "Working…",
  tone = "primary",
  children,
}: {
  action: (state: ProjectFormState, formData: FormData) => Promise<ProjectFormState>;
  hidden: Record<string, string>;
  label: string;
  pendingLabel?: string;
  tone?: "primary" | "secondary" | "danger";
  children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const style =
    tone === "primary"
      ? "bg-primary text-white"
      : tone === "danger"
        ? "border border-danger text-danger"
        : "border border-line text-primary";
  return (
    <form action={formAction} className="space-y-2">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={pending}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-60 ${style}`}
        >
          {pending ? pendingLabel : label}
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
