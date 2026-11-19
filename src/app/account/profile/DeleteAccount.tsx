"use client";

import { useState } from "react";

import { logoutAction } from "@/app/(auth)/actions";

type Result =
  | { kind: "idle" }
  | { kind: "blocked"; error: string; blocking: string[] }
  | { kind: "error"; error: string };

/**
 * Self-service erasure (Phase 7 Task 4, ADR-065). Calls DELETE /api/me; the
 * server checks legal holds and lists what blocks erasure. On success the
 * member is signed out.
 */
export function DeleteAccount() {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result>({ kind: "idle" });

  async function erase() {
    setPending(true);
    try {
      const res = await fetch("/api/me", { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        blocking?: string[];
      };
      if (res.ok) {
        await logoutAction();
        return;
      }
      if (res.status === 409) {
        setResult({
          kind: "blocked",
          error: body.error ?? "Your account cannot be deleted yet.",
          blocking: body.blocking ?? [],
        });
      } else {
        setResult({
          kind: "error",
          error: body.error ?? "Something went wrong. Try again.",
        });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="delete-account"
      className="rounded-xl border border-line p-5"
    >
      <h2 id="delete-account" className="text-lg font-semibold text-primary">
        Delete your account
      </h2>
      <p className="mt-2 text-sm text-muted">
        Your name, contact details and profile are removed and you are signed out. Some
        records are kept where the law or other members need them, such as identity check
        outcomes and signed agreements.
      </p>
      {result.kind === "blocked" ? (
        <div role="alert" className="mt-4 text-sm text-body">
          <p className="font-semibold">{result.error}</p>
          <ul className="mt-2 list-disc pl-5">
            {result.blocking.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.kind === "error" ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {result.error}
        </p>
      ) : null}
      {confirming ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={erase}
            disabled={pending}
            className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? "Deleting…" : "Yes, delete my account"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-body"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-4 rounded-lg border border-danger px-4 py-2 text-sm font-semibold text-danger"
        >
          Delete account
        </button>
      )}
    </section>
  );
}
