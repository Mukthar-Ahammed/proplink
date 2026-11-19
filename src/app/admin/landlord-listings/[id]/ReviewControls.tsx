"use client";

import { useActionState, useState } from "react";

import { decideAction, holdAction, type ReviewState } from "../actions";

const BUTTON =
  "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60";
const SECONDARY =
  "rounded-lg border border-line px-4 py-2 text-sm font-semibold text-primary disabled:opacity-60";
const DANGER =
  "rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-60";
const IDLE: ReviewState = { kind: "idle" };

function Feedback({ state }: { state: ReviewState }) {
  if (state.kind === "idle") return null;
  return (
    <p
      role={state.kind === "error" ? "alert" : "status"}
      className={state.kind === "error" ? "text-sm text-danger" : "text-sm text-success"}
    >
      {state.message}
    </p>
  );
}

/** Claim, take over, release or hand to another Admin. */
export function HoldControls({
  id,
  heldBy,
  admins,
}: {
  id: string;
  heldBy: "me" | "other" | "nobody";
  admins: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(holdAction, IDLE);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {heldBy === "nobody" && (
          <form action={action}>
            <input type="hidden" name="id" value={id} />
            <button name="intent" value="claim" disabled={pending} className={BUTTON}>
              Claim for review
            </button>
          </form>
        )}
        {heldBy === "other" && (
          <form action={action}>
            <input type="hidden" name="id" value={id} />
            <button
              name="intent"
              value="takeover"
              disabled={pending}
              className={SECONDARY}
            >
              Take over review
            </button>
          </form>
        )}
        {heldBy === "me" && (
          <form action={action}>
            <input type="hidden" name="id" value={id} />
            <button
              name="intent"
              value="release"
              disabled={pending}
              className={SECONDARY}
            >
              Return to queue
            </button>
          </form>
        )}
      </div>
      {admins.length > 0 && (
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="intent" value="assign" />
          <label className="space-y-1 text-sm font-medium text-primary">
            <span className="block">Assign to</span>
            <select
              name="assignee"
              required
              defaultValue=""
              className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-body"
            >
              <option value="" disabled>
                Choose an Admin
              </option>
              {admins.map((admin) => (
                <option key={admin.id} value={admin.id}>
                  {admin.name}
                </option>
              ))}
            </select>
          </label>
          <button disabled={pending} className={SECONDARY}>
            Assign
          </button>
        </form>
      )}
      <Feedback state={state} />
    </div>
  );
}

/** Approve, or reject with a reason the Landlord will read. */
export function DecisionControls({
  id,
  kycApproved,
}: {
  id: string;
  kycApproved: boolean;
}) {
  const [state, action, pending] = useActionState(decideAction, IDLE);
  const [rejecting, setRejecting] = useState(false);
  if (state.kind === "done") return <Feedback state={state} />;
  return (
    <div className="space-y-3">
      {!kycApproved && (
        <p className="text-sm text-warning">
          The Landlord&apos;s identity check is no longer approved. Reject with a reason
          or wait.
        </p>
      )}
      {rejecting ? (
        <form action={action} className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="decision" value="REJECT" />
          <label className="block space-y-1 text-sm font-medium text-primary">
            <span className="block">What should the Landlord change?</span>
            <textarea
              name="reason"
              required
              minLength={10}
              maxLength={500}
              rows={4}
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body"
            />
          </label>
          <p className="text-xs text-muted">
            The Landlord sees this reason by email and on the listing.
          </p>
          <div className="flex flex-wrap gap-3">
            <button disabled={pending} className={DANGER}>
              {pending ? "Sending…" : "Reject with reason"}
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className={SECONDARY}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-3">
          <form action={action}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="decision" value="APPROVE" />
            <button disabled={pending || !kycApproved} className={BUTTON}>
              {pending ? "Approving…" : "Approve"}
            </button>
          </form>
          <button type="button" onClick={() => setRejecting(true)} className={SECONDARY}>
            Reject…
          </button>
        </div>
      )}
      <Feedback state={state} />
    </div>
  );
}
