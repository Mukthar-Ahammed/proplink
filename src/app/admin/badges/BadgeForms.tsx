"use client";

import { useActionState, useId } from "react";

import { awardBadgeAction, revokeBadgeAction, type BadgeFormState } from "./actions";

const INPUT =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body focus:border-accent focus:outline-none";

function Outcome({ state, done }: { state: BadgeFormState; done: string }) {
  if (state.kind === "error") {
    return (
      <p role="alert" className="text-xs text-danger">
        {state.message}
      </p>
    );
  }
  if (state.kind === "done") {
    return (
      <p role="status" className="text-xs text-success">
        {done}
      </p>
    );
  }
  return null;
}

export function AwardForm({ profileId, name }: { profileId: string; name: string }) {
  const [state, formAction, pending] = useActionState(awardBadgeAction, {
    kind: "idle",
  } as BadgeFormState);
  const id = useId();
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="profileId" value={profileId} />
      <label htmlFor={`${id}-note`} className="block text-xs font-medium text-primary">
        Note (optional, Admins only)
      </label>
      <input id={`${id}-note`} name="note" maxLength={500} className={INPUT} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Award verified badge to ${name}`}
        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Awarding…" : "Award badge"}
      </button>
      <Outcome state={state} done="Badge awarded." />
    </form>
  );
}

export function RevokeForm({ profileId, name }: { profileId: string; name: string }) {
  const [state, formAction, pending] = useActionState(revokeBadgeAction, {
    kind: "idle",
  } as BadgeFormState);
  const id = useId();
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="profileId" value={profileId} />
      <label htmlFor={`${id}-reason`} className="block text-xs font-medium text-primary">
        Reason (logged)
      </label>
      <input
        id={`${id}-reason`}
        name="reason"
        required
        minLength={10}
        maxLength={500}
        className={INPUT}
      />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Revoke verified badge from ${name}`}
        className="rounded-lg border border-danger px-3 py-1.5 text-xs font-semibold text-danger disabled:opacity-60"
      >
        {pending ? "Revoking…" : "Revoke badge"}
      </button>
      <Outcome state={state} done="Badge revoked." />
    </form>
  );
}
