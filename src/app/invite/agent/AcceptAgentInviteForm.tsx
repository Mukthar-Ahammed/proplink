"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  AUTH_BUTTON,
  AUTH_INPUT,
  AUTH_LABEL,
  AuthShell,
} from "@/components/auth/AuthShell";
import { PasswordInput } from "@/components/auth/PasswordInput";
import type { CompanySummary } from "@/services/companiesHouse/types";

import {
  acceptInviteAction,
  inspectInviteAction,
  searchCompanyForInviteAction,
  type InviteView,
} from "./actions";

const LOOKUP_UNAVAILABLE =
  "We can't reach Companies House right now. Please try again in a few minutes.";

const UNAVAILABLE =
  "Too many attempts, or the service is temporarily unavailable. Please wait a minute and try again.";

function readToken(): string {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return params.get("token") ?? "";
}

export function AcceptAgentInviteForm() {
  const router = useRouter();
  // Read once in the browser; the server render never sees the fragment.
  const [token] = useState(() => (typeof window === "undefined" ? "" : readToken()));
  const [view, setView] = useState<InviteView | { kind: "loading" }>({ kind: "loading" });
  const [form, setForm] = useState({ name: "", password: "", acceptTerms: false });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Business Q1: the company is checked against Companies House on acceptance.
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyResults, setCompanyResults] = useState<CompanySummary[] | null>(null);
  const [company, setCompany] = useState<CompanySummary | null>(null);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [lookupUnavailable, setLookupUnavailable] = useState(false);

  async function searchCompany() {
    setCompanyError(null);
    setSearching(true);
    try {
      const result = await searchCompanyForInviteAction(token, companyQuery);
      if (result.ok) {
        setCompanyResults(result.results);
      } else {
        setCompanyResults(null);
        setCompanyError(result.error);
        if (result.unavailable) setLookupUnavailable(true);
      }
    } catch {
      setCompanyError(LOOKUP_UNAVAILABLE);
      setLookupUnavailable(true);
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    inspectInviteAction(token)
      .then(setView)
      .catch(() => setView({ kind: "problem", message: UNAVAILABLE }));
  }, [token]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!company && !lookupUnavailable) {
      setError("Find and choose your company on the Companies House register.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await acceptInviteAction({
        token,
        ...form,
        ...(company ? { companyNumber: company.companyNumber } : {}),
      });
      if (result.kind === "success") {
        // Drop the token from the address bar and history before moving on.
        window.history.replaceState(null, "", window.location.pathname);
        router.push(result.destination);
        router.refresh();
        return;
      }
      setError(result.message);
    } catch {
      setError(UNAVAILABLE);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Join PropLink UK as an agent"
      subtitle="Set your password to accept your invitation."
    >
      {view.kind === "loading" && (
        <p className="text-sm text-muted">Checking your invitation…</p>
      )}

      {view.kind === "problem" && (
        <div className="space-y-4">
          <p
            role="alert"
            className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger"
          >
            {view.message}
          </p>
          <Link href="/login" className="text-sm font-semibold text-primary underline">
            Go to sign in
          </Link>
        </div>
      )}

      {view.kind === "ready" && (
        <form onSubmit={onSubmit} className="space-y-5">
          <div>
            <p className={AUTH_LABEL}>Email</p>
            <p
              className="mt-1 text-sm font-medium text-primary"
              data-testid="invite-email"
            >
              {view.email}
            </p>
          </div>
          <div>
            <label htmlFor="name" className={AUTH_LABEL}>
              Full name
            </label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              required
              minLength={2}
              maxLength={100}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className={AUTH_INPUT}
            />
          </div>
          <div>
            <label htmlFor="password" className={AUTH_LABEL}>
              Password
            </label>
            <PasswordInput
              id="password"

              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              className={AUTH_INPUT}
            />
            <p className="mt-1 text-xs text-muted">At least 8 characters.</p>
          </div>
          <fieldset className="space-y-2" data-testid="invite-company">
            <legend className={AUTH_LABEL}>Your company</legend>
            {company ? (
              <div className="rounded-xl border border-line bg-white p-3 text-sm">
                <p className="font-medium text-primary">{company.companyName}</p>
                <p className="text-xs text-muted">
                  Company number {company.companyNumber} · {company.status}
                </p>
                <button
                  type="button"
                  onClick={() => setCompany(null)}
                  className="mt-2 text-xs font-semibold text-accent underline"
                >
                  Choose a different company
                </button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <label htmlFor="company-query" className="sr-only">
                    Company name or number
                  </label>
                  <input
                    id="company-query"
                    type="text"
                    autoComplete="organization"
                    maxLength={160}
                    placeholder="Company name or number"
                    value={companyQuery}
                    onChange={(event) => setCompanyQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void searchCompany();
                      }
                    }}
                    className={AUTH_INPUT}
                  />
                  <button
                    type="button"
                    onClick={() => void searchCompany()}
                    disabled={searching || companyQuery.trim().length < 2}
                    className="shrink-0 rounded-xl border border-line px-3 text-sm font-semibold text-primary disabled:opacity-60"
                  >
                    {searching ? "Searching…" : "Search"}
                  </button>
                </div>
                <p className="text-xs text-muted">
                  We check it against the public Companies House register.
                </p>
                {companyResults && companyResults.length === 0 && (
                  <p className="text-xs text-muted">
                    No matches. Try your company number instead.
                  </p>
                )}
                {companyResults && companyResults.length > 0 && (
                  <ul className="divide-y divide-line rounded-xl border border-line bg-white">
                    {companyResults.map((result) => (
                      <li
                        key={result.companyNumber}
                        className="flex items-center justify-between gap-3 p-3 text-sm"
                      >
                        <span>
                          <span className="block font-medium text-primary">
                            {result.companyName}
                          </span>
                          <span className="block text-xs text-muted">
                            {result.companyNumber} · {result.status}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setCompany(result)}
                          aria-label={`Choose ${result.companyName}`}
                          className="shrink-0 text-xs font-semibold text-accent underline"
                        >
                          Choose
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {companyError && (
                  <p role="alert" className="text-xs text-danger">
                    {companyError}
                    {lookupUnavailable &&
                      " You can still accept now and finish the company check from your dashboard."}
                  </p>
                )}
              </>
            )}
          </fieldset>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              required
              checked={form.acceptTerms}
              onChange={(event) =>
                setForm({ ...form, acceptTerms: event.target.checked })
              }
              className="mt-1"
            />
            <span>
              I accept the{" "}
              <Link href="/terms" className="text-accent underline">
                terms of service
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="text-accent underline">
                privacy policy
              </Link>
              .
            </span>
          </label>
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger"
            >
              {error}
            </p>
          )}
          <button type="submit" disabled={submitting} className={AUTH_BUTTON}>
            {submitting ? "Creating your account…" : "Accept invitation"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
