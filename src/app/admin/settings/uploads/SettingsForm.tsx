"use client";

import { useActionState } from "react";

import { saveUploadSettingsAction, type SettingsState } from "./actions";

const INPUT =
  "w-40 rounded-lg border border-line bg-white px-3 py-2 text-sm text-body focus:border-accent focus:outline-none";

export function SettingsForm({
  maxFileMb,
  userQuotaMb,
}: {
  maxFileMb: number;
  userQuotaMb: number;
}) {
  const [state, formAction, pending] = useActionState(saveUploadSettingsAction, {
    kind: "idle",
  } as SettingsState);
  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="maxFileMb" className="block text-sm font-medium text-primary">
          Largest file (MB)
        </label>
        <input
          id="maxFileMb"
          name="maxFileMb"
          type="number"
          min={1}
          max={500}
          required
          defaultValue={maxFileMb}
          className={INPUT}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="userQuotaMb" className="block text-sm font-medium text-primary">
          Storage per user (MB)
        </label>
        <input
          id="userQuotaMb"
          name="userQuotaMb"
          type="number"
          min={1}
          required
          defaultValue={userQuotaMb}
          className={INPUT}
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save limits"}
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
    </form>
  );
}
