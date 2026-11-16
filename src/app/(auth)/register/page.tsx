"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  signupBuyer,
  signupInvestor,
  type AuthActionResult,
} from "@/app/(auth)/actions";
import {
  AUTH_BUTTON,
  AUTH_INPUT,
  AUTH_LABEL,
  AuthShell,
} from "@/components/auth/AuthShell";
import { TurnstileWidget } from "@/components/security/TurnstileWidget";
import { runAuthAction } from "@/lib/security/auth-action-client";

const roles = [
  { value: "BUYER", label: "Buyer", hint: "Search and purchase property" },
  { value: "INVESTOR", label: "Investor", hint: "Flipping & syndicate investments" },
] as const;

const investorSubtypes = [
  {
    value: "FLIPPER",
    label: "Property Flipper",
    description: "Buy properties, renovate them and prepare them for resale.",
  },
  {
    value: "SYNDICATE",
    label: "Syndicate Investor",
    description: "Join property investment opportunities with other investors.",
  },
  {
    value: "BOTH",
    label: "Both",
    description: "Access both property flipping and syndicate investment opportunities.",
  },
] as const;

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "BUYER" as "BUYER" | "INVESTOR",
    investorType: "FLIPPER" as "FLIPPER" | "SYNDICATE" | "BOTH",
    gdprConsent: false,
  });
  const [result, setResult] = useState<AuthActionResult>({ kind: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setResult({ kind: "idle" });
    setSubmitting(true);
    try {
      const response: AuthActionResult = await runAuthAction(() =>
        form.role === "INVESTOR"
          ? signupInvestor({
              name: form.name,
              email: form.email,
              password: form.password,
              investorType: form.investorType,
              gdprConsent: form.gdprConsent,
              turnstileToken,
            })
          : signupBuyer({
              name: form.name,
              email: form.email,
              password: form.password,
              gdprConsent: form.gdprConsent,
              turnstileToken,
            }),
      );

      if (response.kind === "success") {
        router.push(response.destination ?? "/check-email?purpose=signup");
        return;
      }
      setResult(response);
    } finally {
      setSubmitting(false);
      setTurnstileToken(undefined);
      setTurnstileResetKey((key) => key + 1);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Join PropLink UK as a buyer or investor."
      aside={{
        headline: (
          <>
            Distressed property,
            <span className="mt-1 block font-light">end to end</span>
          </>
        ),
        points: [
          "Buyers and investors: search, enquire, book viewings and make offers",
          "Agents: list stock with disclosed defects and build a verified record",
          "Listings include EPC ratings and disclosed material defects",
        ],
      }}
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <label htmlFor="name" className={AUTH_LABEL}>
            Full name
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            className={AUTH_INPUT}
          />
        </div>

        <div>
          <label htmlFor="email" className={AUTH_LABEL}>
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            className={AUTH_INPUT}
          />
        </div>

        <div>
          <label htmlFor="password" className={AUTH_LABEL}>
            Password
          </label>
          <input
            id="password"
            type="password"
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

        <fieldset>
          <legend className={AUTH_LABEL}>I am a…</legend>
          <div className="mt-2 grid grid-cols-2 gap-2.5">
            {roles.map((role) => (
              <label
                key={role.value}
                className={`cursor-pointer rounded-xl border p-3 text-center text-sm transition-colors ${
                  form.role === role.value
                    ? "border-accent bg-pale font-semibold text-secondary"
                    : "border-line bg-white hover:border-secondary"
                }`}
              >
                <input
                  type="radio"
                  name="role-choice"
                  value={role.value}
                  checked={form.role === role.value}
                  onChange={() => setForm({ ...form, role: role.value })}
                  className="sr-only"
                />
                {role.label}
                <span className="mt-1 block text-xs font-normal text-muted">
                  {role.hint}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {form.role === "INVESTOR" && (
          <div className="space-y-3 rounded-2xl border border-line bg-pale/40 p-4">
            <fieldset>
              <legend className="text-sm font-semibold text-primary">
                What type of investor are you?
              </legend>
              <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                {investorSubtypes.map((subtype) => (
                  <label
                    key={subtype.value}
                    className={`cursor-pointer rounded-xl border p-3.5 text-left text-sm transition-all ${
                      form.investorType === subtype.value
                        ? "border-accent bg-white font-semibold text-primary shadow-sm ring-1 ring-accent"
                        : "border-line bg-white/70 hover:border-secondary hover:bg-white"
                    }`}
                  >
                    <input
                      type="radio"
                      name="investor-subtype-choice"
                      value={subtype.value}
                      checked={form.investorType === subtype.value}
                      onChange={() => setForm({ ...form, investorType: subtype.value })}
                      className="sr-only"
                    />
                    <div className="font-medium">{subtype.label}</div>
                    <p className="mt-1 text-xs font-normal leading-relaxed text-muted">
                      {subtype.description}
                    </p>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="rounded-xl border border-line bg-white p-3 text-xs text-muted">
              <span className="font-semibold text-primary">Identity verification required:</span>{" "}
              Investor accounts must complete identity verification before accessing investment-related financial actions.
            </div>
          </div>
        )}

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            required
            checked={form.gdprConsent}
            onChange={(event) =>
              setForm({ ...form, gdprConsent: event.target.checked })
            }
            className="mt-1"
          />
          <span>
            I agree to the <Link href="/privacy" className="text-accent underline">privacy policy</Link>{" "}
            and <Link href="/terms" className="text-accent underline">terms of service</Link>.
          </span>
        </label>

        <TurnstileWidget
          onToken={setTurnstileToken}
          resetKey={turnstileResetKey}
        />

        {result.message && (
          <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
            {result.message}
          </p>
        )}

        <button type="submit" disabled={submitting} className={AUTH_BUTTON}>
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-8 text-center text-sm text-muted">
        Already registered?{" "}
        <Link href="/login" className="font-semibold text-primary underline decoration-line underline-offset-4 hover:decoration-accent">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
