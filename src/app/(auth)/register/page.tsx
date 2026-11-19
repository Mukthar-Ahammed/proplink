"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  signupBuyer,
  signupInvestor,
  signupLandlord,
  type AuthActionResult,
} from "@/app/(auth)/actions";
import {
  AUTH_BUTTON,
  AUTH_INPUT,
  AUTH_LABEL,
  AuthShell,
} from "@/components/auth/AuthShell";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { TurnstileWidget } from "@/components/security/TurnstileWidget";
import { runAuthAction } from "@/lib/security/auth-action-client";

// Public sign-up is limited to these three roles (Phase 1 Task 2). Agents join
// by Admin invitation only; there is no Agent option here or in the API.
// Each role's description renders in the same fixed three-line slot under the
// switch, so changing role never changes the page height (no scroll jump).
const roles = [
  {
    value: "LANDLORD",
    label: "Landlord",
    hint: "List a distressed property privately — only verified agents see it, and landlords never pay.",
  },
  {
    value: "INVESTOR",
    label: "Investor",
    hint: "Lead or co-invest, set per project. ID check (KYC) before investing; chat needs a subscription and Admin approval. Pledges are interest only until you sign the Solicitor's agreement; funds never pass through PropLink.",
  },
  {
    value: "BUYER",
    label: "Buyer",
    hint: "Search approved listings with disclosed defects, then enquire, book viewings and make offers. Always free.",
  },
] as const;

type PublicRole = (typeof roles)[number]["value"];

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "BUYER" as PublicRole,
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
      const base = {
        name: form.name,
        email: form.email,
        password: form.password,
        gdprConsent: form.gdprConsent,
        turnstileToken,
      };
      const response: AuthActionResult = await runAuthAction(() => {
        // No investor sub-type here: Lead Investor and Co-Investor are positions
        // in a project, set per project (TRD CI-1; ADR-072), not at sign-up.
        if (form.role === "INVESTOR") return signupInvestor(base);
        if (form.role === "LANDLORD") return signupLandlord(base);
        return signupBuyer(base);
      });

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
      wide
      title="Create your account"
      subtitle="Join PropLink UK as a landlord, investor or buyer."
    >
      <form
        onSubmit={onSubmit}
        className="space-y-4 [@media(max-height:820px)]:space-y-3"
      >
        <div className="grid gap-4 sm:grid-cols-2">
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
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="password" className={AUTH_LABEL}>
              Password
            </label>
            <span className="text-xs text-muted">At least 8 characters</span>
          </div>
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
        </div>

        <fieldset>
          <legend className={AUTH_LABEL}>I am a…</legend>
          <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-full border border-line bg-surface p-1">
            {roles.map((role) => (
              <label
                key={role.value}
                className={`cursor-pointer rounded-full px-2 py-2 text-center text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40 ${
                  form.role === role.value
                    ? "bg-accent font-semibold text-white shadow-sm"
                    : "text-secondary hover:bg-background"
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
              </label>
            ))}
          </div>
          <p aria-live="polite" className="mt-2 text-xs leading-5 text-muted sm:h-15">
            {roles.find((role) => role.value === form.role)?.hint}
          </p>
        </fieldset>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            required
            checked={form.gdprConsent}
            onChange={(event) => setForm({ ...form, gdprConsent: event.target.checked })}
            className="mt-1"
          />
          <span>
            I agree to the{" "}
            <Link href="/privacy" className="text-accent underline">
              privacy policy
            </Link>{" "}
            and{" "}
            <Link href="/terms" className="text-accent underline">
              terms of service
            </Link>
            .
          </span>
        </label>

        <TurnstileWidget onToken={setTurnstileToken} resetKey={turnstileResetKey} />

        {result.message && (
          <p
            role="alert"
            className="rounded-xl bg-danger/10 px-4 py-3 text-sm font-medium text-danger"
          >
            {result.message}
          </p>
        )}

        <button type="submit" disabled={submitting} className={AUTH_BUTTON}>
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-muted">
        Already registered?{" "}
        <Link
          href="/login"
          className="font-semibold text-primary underline decoration-line underline-offset-4 hover:decoration-accent"
        >
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
