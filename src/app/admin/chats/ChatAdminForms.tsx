"use client";

import { useActionState } from "react";

import {
  decideChatsAction,
  resolveReportAction,
  revokeChatAction,
  type ChatAdminState,
} from "./actions";

const IDLE: ChatAdminState = { kind: "idle" };
const BUTTON =
  "rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60";
const SECONDARY =
  "rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-primary disabled:opacity-60";
const INPUT =
  "w-full rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-body";

function Feedback({ state }: { state: ChatAdminState }) {
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

export type PendingRow = {
  id: string;
  title: string;
  pair: string;
  a: string;
  b: string;
  waitingSince: string;
};

/** Bulk authorisation queue: tick chats, then approve or reject. */
export function PendingQueue({ rows }: { rows: PendingRow[] }) {
  const [state, action, pending] = useActionState(decideChatsAction, IDLE);
  return (
    <form action={action} className="space-y-3">
      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex items-start gap-3 rounded-lg border border-line bg-white p-3"
          >
            <input
              type="checkbox"
              name="threadId"
              value={row.id}
              aria-label={`Select ${row.title}`}
              className="mt-1"
            />
            <div className="text-sm">
              <p className="font-semibold text-primary">{row.title}</p>
              <p className="text-muted">
                {row.pair}: {row.a} and {row.b} · waiting since {row.waitingSince}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-3">
        <button name="decision" value="APPROVE" disabled={pending} className={BUTTON}>
          Authorise selected
        </button>
        <label className="flex-1 text-sm text-body">
          <span className="block">Reason (needed to reject)</span>
          <input name="reason" maxLength={500} className={INPUT} />
        </label>
        <button name="decision" value="REJECT" disabled={pending} className={SECONDARY}>
          Reject selected
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function RevokeForm({ threadId }: { threadId: string }) {
  const [state, action, pending] = useActionState(revokeChatAction, IDLE);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="threadId" value={threadId} />
      <input
        name="reason"
        required
        minLength={3}
        maxLength={500}
        placeholder="Reason"
        className={INPUT}
        aria-label="Reason for closing"
      />
      <button disabled={pending} className={SECONDARY}>
        Close chat
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function ResolveForm({ reportId }: { reportId: string }) {
  const [state, action, pending] = useActionState(resolveReportAction, IDLE);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="reportId" value={reportId} />
      <input
        name="resolution"
        required
        minLength={3}
        maxLength={1000}
        placeholder="What was done"
        className={INPUT}
        aria-label="Resolution"
      />
      <button disabled={pending} className={SECONDARY}>
        Resolve
      </button>
      <Feedback state={state} />
    </form>
  );
}
