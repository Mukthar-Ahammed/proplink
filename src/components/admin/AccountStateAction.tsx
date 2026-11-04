"use client";

import { useState } from "react";

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
  const nextLabel = active ? "Suspend account" : "Reactivate account";

  return (
    <form
      action={async (formData) => {
        if (
          !window.confirm(
            `${nextLabel}? This changes access to protected PropLink functionality.`,
          )
        )
          return;
        setBusy(true);
        try {
          await action(formData);
        } finally {
          setBusy(false);
        }
      }}
      className="inline-flex"
    >
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="nextActive" value={String(!active)} />
      <button
        type="submit"
        disabled={busy}
        className={
          active
            ? "text-xs font-semibold text-danger hover:underline disabled:opacity-50"
            : "text-xs font-semibold text-success hover:underline disabled:opacity-50"
        }
      >
        {busy ? "Saving…" : nextLabel}
      </button>
    </form>
  );
}
