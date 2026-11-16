"use client";

import { useActionState } from "react";

import { createInviteAction, resendInviteAction, type InviteFormState } from "./actions";

const INPUT =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body focus:border-accent focus:outline-none";
const BUTTON =
  "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60";

function Outcome({ state }: { state: InviteFormState }) {
  if (state.kind === "error") {
    return (
      <p role="alert" className="text-sm text-danger">
        {state.message}
      </p>
    );
  }
  if (state.kind !== "sent") return null;
  return (
    <div role="status" className="space-y-2 text-sm">
      <p className="text-success">
        {state.emailed
          ? "Invitation created and emailed."
          : "Invitation created, but the email could not be sent. Use Resend to try again."}
      </p>
      {state.devInviteUrl && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
          <p className="font-semibold text-warning">
            Development only: emails are not sent in this environment.
          </p>
          <p className="mt-1 text-xs text-muted">
            Give this link only to the invited person. It works once and is shown only
            now.
          </p>
          <input
            readOnly
            value={state.devInviteUrl}
            aria-label="Invitation link"
            data-testid="dev-invite-url"
            className={`${INPUT} mt-2 font-mono text-xs`}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      )}
    </div>
  );
}

export function CreateInviteForm() {
  const [state, formAction, pending] = useActionState(createInviteAction, {
    kind: "idle",
  } as InviteFormState);
  return (
    <form action={formAction} className="space-y-3">
      <label htmlFor="invite-email" className="block text-sm font-medium text-primary">
        Agent email
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="invite-email"
          name="email"
          type="email"
          required
          maxLength={320}
          className={INPUT}
        />
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? "Sending…" : "Send invitation"}
        </button>
      </div>
      <Outcome state={state} />
    </form>
  );
}

export function ResendInviteButton({ inviteId }: { inviteId: string }) {
  const [state, formAction, pending] = useActionState(resendInviteAction, {
    kind: "idle",
  } as InviteFormState);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="inviteId" value={inviteId} />
      <button
        type="submit"
        disabled={pending}
        className="text-sm font-semibold text-primary underline disabled:opacity-60"
      >
        {pending ? "Resending…" : "Resend"}
      </button>
      <Outcome state={state} />
    </form>
  );
}
