"use client";

import { useActionState, useState } from "react";

import {
  answerQuestionAction,
  submitProposalAction,
  withdrawProposalAction,
  type ProposalState,
} from "../actions";

const INPUT =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body focus:border-accent focus:outline-none";
const BUTTON =
  "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60";
const SECONDARY =
  "rounded-lg border border-line px-4 py-2 text-sm font-semibold text-primary disabled:opacity-60";
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
    <form action={action} className="space-y-4">
      <input type="hidden" name="listingId" value={listingId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block space-y-1 text-sm font-medium text-primary">
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
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium text-primary">Your fee</legend>
          <div className="flex gap-2">
            <select
              name="feeType"
              value={feeType}
              onChange={(event) => setFeeType(event.target.value as "PERCENT" | "FIXED")}
              className="rounded-lg border border-line bg-white px-2 py-2 text-sm"
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
        <label className="block space-y-1 text-sm font-medium text-primary">
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
      <label className="block space-y-1 text-sm font-medium text-primary">
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
      <label className="block space-y-1 text-sm font-medium text-primary">
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
      <div className="flex flex-wrap items-center gap-4">
        <button disabled={pending} className={BUTTON}>
          {pending ? "Sending…" : editing ? "Update proposal" : "Send proposal"}
        </button>
        <Feedback state={state} />
      </div>
      <p className="text-xs text-muted">
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
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="proposalId" value={proposalId} />
      <span className="text-sm text-body">
        Withdraw it? The landlord will no longer see it.
      </span>
      <button disabled={pending} className={SECONDARY}>
        Yes, withdraw
      </button>
      <button type="button" onClick={() => setConfirming(false)} className={SECONDARY}>
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
    <form action={action} className="mt-2 space-y-2">
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
      <div className="flex items-center gap-3">
        <button disabled={pending} className={BUTTON}>
          {pending ? "Sending…" : "Answer"}
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}
