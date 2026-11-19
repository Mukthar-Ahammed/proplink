"use client";

import { useActionState, useState } from "react";

import {
  BUTTON,
  BUTTON_SM,
  DANGER_SM,
  INPUT,
  LABEL,
  SECONDARY,
  SECONDARY_SM,
} from "@/app/landlord/listings/ui";

import {
  answerQuestionAction,
  submitProposalAction,
  withdrawProposalAction,
  type ProposalState,
} from "../actions";

const FIELD = `${LABEL} space-y-1.5`;
const IDLE: ProposalState = { kind: "idle" };

function Feedback({ state }: { state: ProposalState }) {
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

export type ProposalDefaults = {
  valuation: string;
  feeType: "PERCENT" | "FIXED";
  feePercent: string;
  feeAmount: string;
  contractMonths: string;
  terms: string;
  pitch: string;
};

/** The structured proposal (TRD AG-1): valuation, terms, fee, period, pitch. */
export function ProposalForm({
  listingId,
  defaults,
  editing,
}: {
  listingId: string;
  defaults: ProposalDefaults;
  editing: boolean;
}) {
  const [state, action, pending] = useActionState(submitProposalAction, IDLE);
  const [feeType, setFeeType] = useState(defaults.feeType);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="listingId" value={listingId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={FIELD}>
          <span className="block">Your valuation (£)</span>
          <input
            name="valuation"
            required
            inputMode="decimal"
            defaultValue={defaults.valuation}
            maxLength={16}
            className={INPUT}
          />
        </label>
        <fieldset className="space-y-1.5">
          <legend className={LABEL}>Your fee</legend>
          <div className="flex gap-2">
            <select
              name="feeType"
              value={feeType}
              onChange={(event) => setFeeType(event.target.value as "PERCENT" | "FIXED")}
              className="shrink-0 rounded-xl border border-line bg-white px-2.5 py-2.5 text-sm text-body focus:border-accent focus:ring-2 focus:ring-accent/15 focus:outline-none"
              aria-label="Fee type"
            >
              <option value="PERCENT">%</option>
              <option value="FIXED">£ fixed</option>
            </select>
            {feeType === "PERCENT" ? (
              <input
                name="feePercent"
                required
                inputMode="decimal"
                defaultValue={defaults.feePercent}
                placeholder="1.5"
                maxLength={5}
                className={INPUT}
                aria-label="Fee percentage"
              />
            ) : (
              <input
                name="feeAmount"
                required
                inputMode="decimal"
                defaultValue={defaults.feeAmount}
                placeholder="3000"
                maxLength={14}
                className={INPUT}
                aria-label="Fixed fee in pounds"
              />
            )}
          </div>
        </fieldset>
        <label className={FIELD}>
          <span className="block">Contract period (months)</span>
          <input
            name="contractMonths"
            required
            type="number"
            min={1}
            max={60}
            defaultValue={defaults.contractMonths}
            className={INPUT}
          />
        </label>
      </div>
      <label className={FIELD}>
        <span className="block">Proposed terms</span>
        <textarea
          name="terms"
          required
          minLength={20}
          maxLength={2000}
          rows={4}
          defaultValue={defaults.terms}
          className={INPUT}
          placeholder="How you would market or develop it, timescales, what you need from the landlord"
        />
      </label>
      <label className={FIELD}>
        <span className="block">Short pitch</span>
        <textarea
          name="pitch"
          required
          minLength={20}
          maxLength={1500}
          rows={3}
          defaultValue={defaults.pitch}
          className={INPUT}
          placeholder="Why you are the right agent for this property"
        />
      </label>
      <div className="flex flex-wrap items-center gap-4 border-t border-line pt-5">
        <button disabled={pending} className={BUTTON}>
          {pending ? "Sending…" : editing ? "Update proposal" : "Send proposal"}
        </button>
        <Feedback state={state} />
      </div>
      <p className="text-xs leading-relaxed text-muted">
        The landlord sees your name, agency, verified company and this proposal. Further
        discussion moves to chat once PropLink authorises it.
      </p>
    </form>
  );
}

export function WithdrawProposal({
  listingId,
  proposalId,
}: {
  listingId: string;
  proposalId: string;
}) {
  const [state, action, pending] = useActionState(withdrawProposalAction, IDLE);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={SECONDARY}>
        Withdraw proposal
      </button>
    );
  }
  return (
    <form
      action={action}
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-danger/30 bg-danger/5 p-4"
    >
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="proposalId" value={proposalId} />
      <span className="text-sm text-body">
        Withdraw it? The landlord will no longer see it.
      </span>
      <button disabled={pending} className={DANGER_SM}>
        Yes, withdraw
      </button>
      <button type="button" onClick={() => setConfirming(false)} className={SECONDARY_SM}>
        Keep it
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function AnswerForm({
  listingId,
  questionId,
}: {
  listingId: string;
  questionId: string;
}) {
  const [state, action, pending] = useActionState(answerQuestionAction, IDLE);
  if (state.kind === "done") return <Feedback state={state} />;
  return (
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="questionId" value={questionId} />
      <textarea
        name="answer"
        required
        minLength={2}
        maxLength={1000}
        rows={2}
        className={INPUT}
        aria-label="Your answer"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={BUTTON_SM}>
          {pending ? "Sending…" : "Answer"}
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}
