"use client";

import { useActionState, useMemo, useState } from "react";

import { formatPounds, previewPledge } from "@/services/projects/shares";

export type PledgeState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "done"; message: string };

const IDLE: PledgeState = { kind: "idle" };
const POUNDS = /^\d{1,12}(?:\.\d{1,2})?$/;

function toPence(raw: string): bigint | null {
  const cleaned = raw.replace(/[£,\s]/g, "");
  if (!POUNDS.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return BigInt(whole) * BigInt(100) + BigInt((fraction + "00").slice(0, 2));
}

function newKey(): string {
  return crypto.randomUUID();
}

/**
 * Capital Contribution Calculator (Phase 4 Task 4, acceptance criterion 8):
 * a live preview of share = pledge ÷ total capital, in whole parts per
 * million. The server recomputes everything and is authoritative; a retried
 * submit reuses the same idempotency key, so it never pledges twice.
 */
export function PledgeCalculator({
  projectId,
  capital,
  minimum,
  pledgedSoFar,
  expectedProfit,
  showProjection,
  action,
}: {
  projectId: string;
  capital: string;
  minimum: string;
  pledgedSoFar: string;
  expectedProfit: string | null;
  showProjection: boolean;
  action: (state: PledgeState, formData: FormData) => Promise<PledgeState>;
}) {
  const [amount, setAmount] = useState("");
  const [key] = useState(newKey);
  const [state, formAction, pending] = useActionState(action, IDLE);
  const preview = useMemo(() => {
    const pledge = toPence(amount);
    if (pledge === null) return null;
    return previewPledge({
      pledge,
      capital: BigInt(capital),
      minimum: BigInt(minimum),
      pledgedSoFar: BigInt(pledgedSoFar),
      expectedProfit: expectedProfit === null ? null : BigInt(expectedProfit),
      showProjection,
    });
  }, [amount, capital, minimum, pledgedSoFar, expectedProfit, showProjection]);

  return (
    <form action={formAction} className="space-y-3" data-testid="pledge-form">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <label className="block text-sm font-medium text-primary">
        Your pledge (£)
        <input
          name="amount"
          inputMode="decimal"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className="mt-1 w-48 rounded-lg border border-line bg-white px-3 py-2 text-sm text-body"
        />
      </label>
      <div aria-live="polite" className="text-sm" data-testid="pledge-preview">
        {preview === null ? (
          <p className="text-muted">
            Minimum {formatPounds(BigInt(minimum))};{" "}
            {formatPounds(BigInt(capital) - BigInt(pledgedSoFar))} remains unfunded.
          </p>
        ) : preview.ok ? (
          <p className="text-body">
            Your share: <strong>{preview.share}</strong> of the project ·{" "}
            {formatPounds(preview.remainingAfter)} would remain
            {preview.projectedProfitShare !== null && (
              <>
                {" "}
                · projected profit share {formatPounds(preview.projectedProfitShare)} (the
                agent&apos;s estimate, not a promise)
              </>
            )}
          </p>
        ) : (
          <p className="text-danger">{preview.reason}</p>
        )}
      </div>
      <p className="text-xs text-muted">
        A pledge is an expression of interest until you sign the project agreement. No
        money is paid through PropLink: the Solicitor tells you how and when to transfer
        funds. Your capital is at risk.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={pending || !preview?.ok}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Pledging…" : "Pledge (expression of interest)"}
        </button>
        {state.kind !== "idle" && (
          <p
            role={state.kind === "error" ? "alert" : "status"}
            className={
              state.kind === "error" ? "text-sm text-danger" : "text-sm text-success"
            }
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
