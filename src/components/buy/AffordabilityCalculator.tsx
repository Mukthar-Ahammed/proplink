"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { affordability } from "@/lib/affordability";

/**
 * The buyer's affordability calculator (Task 5.7).
 *
 * Client-side and instant: the maths is pure (`@/lib/affordability`, unit
 * tested), so there is nothing to submit and no round trip. Its output feeds
 * straight into the search — the budget becomes `maxPrice`, which is the whole
 * point of putting it on a search page rather than on a tools page.
 *
 * **It is a guide, not a decision.** Lenders stress-test affordability, credit
 * score, and apply their own multiples. Saying so is not a disclaimer for its
 * own sake: a buyer who treats this as a mortgage offer will waste an agent's
 * time and their own.
 */

/** Pounds in the inputs, pence in the maths — the boundary is here. */
const toPence = (pounds: number) => Math.round(pounds * 100);

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

const FIELD =
  "mt-1 w-full rounded-2xl border border-line bg-background px-3 py-2 text-sm text-primary focus:border-accent focus:outline-none";

function Field({
  label,
  suffix,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  suffix?: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
        {label}
        {suffix ? <span className="font-normal normal-case"> ({suffix})</span> : null}
      </span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(e.currentTarget.valueAsNumber)}
        className={FIELD}
      />
    </label>
  );
}

/**
 * Rendered inside the buyer search bar's "What can you spend?" panel
 * (`<SearchFilters variant="bar" calculator>`), so it has no frame of its own.
 */
export function AffordabilityCalculator() {
  const [deposit, setDeposit] = useState(50_000);
  const [income, setIncome] = useState(60_000);
  const [multiple, setMultiple] = useState(4.5);
  const [rate, setRate] = useState(5);
  const [term, setTerm] = useState(25);

  const result = useMemo(
    () =>
      affordability({
        depositGBP: toPence(deposit),
        annualIncomeGBP: toPence(income),
        incomeMultiple: multiple,
        annualRatePct: rate,
        termYears: term,
      }),
    [deposit, income, multiple, rate, term],
  );

  const budgetPounds = Math.floor(result.maxBudgetGBP / 100);

  return (
    <section data-testid="affordability" aria-labelledby="affordability-heading">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <h2 id="affordability-heading" className="text-base font-semibold text-primary">
            What can you spend?
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            A guide, not a mortgage decision — lenders apply their own checks.
          </p>
        </div>
        <p className="flex items-baseline gap-2">
          <span
            data-testid="max-budget"
            className="text-2xl font-semibold tracking-tight text-primary"
          >
            {GBP.format(result.maxBudgetGBP / 100)}
          </span>
          <span className="text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
            Max budget
          </span>
        </p>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Field
          label="Deposit"
          suffix="£"
          value={deposit}
          onChange={setDeposit}
          step={1000}
        />
        <Field
          label="Annual income"
          suffix="£"
          value={income}
          onChange={setIncome}
          step={1000}
        />
        <Field
          label="Income multiple"
          value={multiple}
          onChange={setMultiple}
          step={0.1}
        />
        <Field
          label="Interest rate"
          suffix="%"
          value={rate}
          onChange={setRate}
          step={0.1}
        />
        <Field label="Term" suffix="years" value={term} onChange={setTerm} />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
        <dl className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <div className="flex items-baseline gap-2">
            <dt className="text-muted">Borrowing</dt>
            <dd className="font-semibold text-primary">
              {GBP.format(result.maxBorrowGBP / 100)}
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-muted">Per month</dt>
            <dd className="font-semibold text-primary">
              {GBP.format(result.monthlyRepaymentGBP / 100)}
            </dd>
          </div>
        </dl>
        <a
          href="https://www.moneyhelper.org.uk/en/homes/buying-a-home/mortgage-agreement-in-principle"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-primary underline decoration-line underline-offset-4 hover:decoration-accent"
        >
          About decisions in principle
        </a>
        {/* The calculator's whole reason for sitting on a search page. */}
        <Link
          href={`/buy?maxPrice=${budgetPounds}`}
          className="inline-flex h-11 items-center rounded-full bg-accent px-5 font-semibold text-white transition-colors hover:bg-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:ml-auto"
        >
          Show listings up to {GBP.format(budgetPounds)}
        </Link>
      </div>
    </section>
  );
}
