"use client";

import { useActionState } from "react";

import {
  authoriseAgentAction,
  notifyAgentsAction,
  type MigrationFormState,
} from "./actions";

const BUTTON =
  "rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60";

function Outcome({ state }: { state: MigrationFormState }) {
  if (state.kind === "error") {
    return (
      <p role="alert" className="text-xs text-danger">
        {state.message}
      </p>
    );
  }
  if (state.kind === "notified") {
    return (
      <p role="status" className="text-xs text-success">
        Emailed {state.sent}. Skipped {state.skipped} (already confirmed or emailed in the
        last 24 hours). Failed {state.failed}.
      </p>
    );
  }
  if (state.kind === "authorised") {
    return (
      <p role="status" className="text-xs text-success">
        Authorised.
      </p>
    );
  }
  return null;
}

export type NotifyRow = {
  profileId: string;
  name: string;
  email: string | null;
  selectable: boolean;
};

/** Bulk notify: one form whose checkboxes name the selected Agents. */
export function NotifyForm({ rows }: { rows: NotifyRow[] }) {
  const [state, formAction, pending] = useActionState(notifyAgentsAction, {
    kind: "idle",
  } as MigrationFormState);
  const selectable = rows.filter((row) => row.selectable);

  if (selectable.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted">No agents are waiting to be emailed.</p>
        <Outcome state={state} />
      </div>
    );
  }
  return (
    <form action={formAction} className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-primary">
          Agents to email (up to 50 at a time)
        </legend>
        {selectable.map((row, index) => (
          <label key={row.profileId} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="profileId"
              value={row.profileId}
              defaultChecked={index < 50}
              className="mt-1 h-4 w-4"
            />
            <span>
              {row.name}
              {row.email && <span className="block text-xs text-muted">{row.email}</span>}
            </span>
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? "Sending…" : "Email selected agents"}
      </button>
      <Outcome state={state} />
    </form>
  );
}

export function AuthoriseButton({
  profileId,
  name,
}: {
  profileId: string;
  name: string;
}) {
  const [state, formAction, pending] = useActionState(authoriseAgentAction, {
    kind: "idle",
  } as MigrationFormState);
  return (
    <form action={formAction} className="space-y-1">
      <input type="hidden" name="profileId" value={profileId} />
      <button
        type="submit"
        disabled={pending}
        className={BUTTON}
        aria-label={`Authorise ${name}`}
      >
        {pending ? "Authorising…" : "Authorise"}
      </button>
      <Outcome state={state} />
    </form>
  );
}
