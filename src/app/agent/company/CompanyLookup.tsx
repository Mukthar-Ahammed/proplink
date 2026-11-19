"use client";

import { useActionState } from "react";

import { BUTTON, BUTTON_SM, INPUT, LABEL } from "@/app/landlord/listings/ui";
import type { CompanySummary } from "@/services/companiesHouse/types";

import {
  confirmCompanyAction,
  searchCompaniesAction,
  type ConfirmState,
  type SearchState,
} from "./actions";

function statusLabel(status: string): string {
  const label = status.replace(/-/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function ResultRow({ company }: { company: CompanySummary }) {
  const [state, formAction, pending] = useActionState(confirmCompanyAction, {
    kind: "idle",
  } as ConfirmState);
  const active = company.status.toLowerCase() === "active";

  return (
    <li className="py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold break-words text-primary">
              {company.companyName}
            </p>
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                active
                  ? "border-success/25 bg-success/10 text-success"
                  : "border-warning/25 bg-warning/10 text-warning"
              }`}
            >
              {statusLabel(company.status)}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            Company number {company.companyNumber}
            {company.incorporatedOn ? ` · Incorporated ${company.incorporatedOn}` : ""}
          </p>
          {company.address && (
            <p className="mt-1 text-xs break-words text-muted">{company.address}</p>
          )}
        </div>
        <form action={formAction} className="shrink-0">
          <input type="hidden" name="companyNumber" value={company.companyNumber} />
          <button
            type="submit"
            disabled={pending}
            className={BUTTON_SM}
            aria-label={`This is my company: ${company.companyName}`}
          >
            {pending ? "Checking…" : "This is my company"}
          </button>
        </form>
      </div>
      {state.kind === "error" && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {state.message}
        </p>
      )}
      {state.kind === "saved" && (
        <p role="status" className="mt-2 text-sm text-success">
          {state.verified
            ? `${state.companyName} is verified as active.`
            : `${state.companyName} is saved, but it is not active on the register. PropLink will review it.`}
        </p>
      )}
    </li>
  );
}

export function CompanyLookup() {
  const [state, formAction, pending] = useActionState(searchCompaniesAction, {
    kind: "idle",
  } as SearchState);

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-2" role="search">
        <label htmlFor="company-query" className={LABEL}>
          Company name or number
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="company-query"
            name="query"
            required
            minLength={2}
            maxLength={160}
            autoComplete="organization"
            aria-describedby="company-query-hint"
            className={INPUT}
          />
          <button
            type="submit"
            disabled={pending}
            className={`${BUTTON} shrink-0 justify-center`}
          >
            {pending ? "Searching…" : "Search register"}
          </button>
        </div>
        <p id="company-query-hint" className="text-xs text-muted">
          We search the public Companies House register. Your company number is on your
          certificate of incorporation.
        </p>
      </form>

      <div aria-live="polite">
        {state.kind === "error" && (
          <p role="alert" className="text-sm text-danger">
            {state.message}
          </p>
        )}
        {state.kind === "results" &&
          (state.results.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line bg-surface/60 px-5 py-6 text-center text-sm text-muted">
              No companies match “{state.query}”. Try the company number instead.
            </p>
          ) : (
            <ul className="divide-y divide-line rounded-2xl border border-line bg-white px-5">
              {state.results.map((company) => (
                <ResultRow key={company.companyNumber} company={company} />
              ))}
            </ul>
          ))}
      </div>
    </div>
  );
}
