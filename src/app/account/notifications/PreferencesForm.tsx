"use client";

import { useActionState } from "react";

import type { PreferenceRow } from "@/services/notifications/preferences";

import { savePreferencesAction, type PreferencesFormState } from "./actions";

export function PreferencesForm({
  rows,
  currentPhase,
}: {
  rows: PreferenceRow[];
  currentPhase: number;
}) {
  const [state, formAction, pending] = useActionState(savePreferencesAction, {
    kind: "idle",
  } as PreferencesFormState);

  return (
    <form action={formAction} className="space-y-6">
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Notification preferences</caption>
          <thead className="text-xs tracking-wide text-muted uppercase">
            <tr>
              <th scope="col" className="px-4 py-3">
                Notification
              </th>
              <th scope="col" className="px-4 py-3 text-center">
                In app
              </th>
              <th scope="col" className="px-4 py-3 text-center">
                Email
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-line align-top">
                <th scope="row" className="px-4 py-3 font-normal">
                  <span className="block font-medium text-primary">{row.label}</span>
                  <span className="block text-xs text-muted">{row.description}</span>
                  {row.mandatory && (
                    <span className="mt-1 block text-xs text-muted">
                      Always on: required for your account&apos;s safety and records.
                    </span>
                  )}
                  {!row.mandatory && row.deliveredInPhase > currentPhase && (
                    <span className="mt-1 block text-xs text-muted">Coming soon</span>
                  )}
                </th>
                {(["inApp", "email"] as const).map((channel) => (
                  <td key={channel} className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      name={`${row.key}:${channel}`}
                      defaultChecked={row[channel]}
                      disabled={row.mandatory}
                      aria-label={`${row.label}: ${channel === "inApp" ? "in app" : "email"}`}
                      className="h-4 w-4"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save preferences"}
        </button>
        {state.kind === "saved" && (
          <p role="status" className="text-sm text-success">
            Saved.
          </p>
        )}
        {state.kind === "error" && (
          <p role="alert" className="text-sm text-danger">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
