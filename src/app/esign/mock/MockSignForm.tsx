"use client";

import { useActionState } from "react";

import { mockSignAction, type MockSignState } from "./actions";

const IDLE: MockSignState = { kind: "idle" };

export function MockSignForm({ query }: { query: string }) {
  const [state, action, pending] = useActionState(mockSignAction, IDLE);
  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="query" value={query} />
      <p className="text-sm text-body">
        By pressing &ldquo;Sign&rdquo; you confirm you have read the agreement. This mock
        stands in for the real e-signature provider during development.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          name="decision"
          value="sign"
          disabled={pending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          Sign
        </button>
        <button
          name="decision"
          value="decline"
          disabled={pending}
          className="rounded-lg border border-danger px-4 py-2 text-sm font-semibold text-danger disabled:opacity-60"
        >
          Decline
        </button>
      </div>
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      )}
    </form>
  );
}
