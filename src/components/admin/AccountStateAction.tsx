"use client";

import { useId, useState } from "react";

/**
 * Suspend / reinstate (Phase 1 Task 9, ADR-028). A logged reason is required;
 * typing it is the confirmation, so no browser dialog is used.
 */
export function AccountStateAction({
  userId,
  active,
  action,
}: {
  userId: string;
  active: boolean;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const nextLabel = active ? "Suspend account" : "Reinstate account";

  return (
    <form
      action={async (formData) => {
        setBusy(true);
        setError(null);
        try {
          await action(formData);
        } catch (caught) {
          setError(
            caught instanceof Error ? caught.message : "Could not change the account",
          );
        } finally {
          setBusy(false);
        }
      }}
      className="flex flex-col gap-1"
    >
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="nextActive" value={String(!active)} />
      <label htmlFor={`${id}-reason`} className="sr-only">
        Reason to {active ? "suspend" : "reinstate"} (logged)
      </label>
      <input
        id={`${id}-reason`}
        name="reason"
        required
        minLength={10}
        maxLength={500}
        placeholder="Reason (logged)"
        className="w-48 rounded border border-line px-2 py-1 text-xs"
      />
      <button
        type="submit"
        disabled={busy}
        className={
          active
            ? "text-left text-xs font-semibold text-danger hover:underline disabled:opacity-50"
            : "text-left text-xs font-semibold text-success hover:underline disabled:opacity-50"
        }
      >
        {busy ? "Saving…" : nextLabel}
      </button>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
