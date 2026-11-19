"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  loginAction,
  resendConfirmationAction,
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

function requestedDestination(): string {
  if (typeof window === "undefined") return "/portal";
  return new URLSearchParams(window.location.search).get("callbackUrl") ?? "/portal";
}

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [result, setResult] = useState<AuthActionResult>({ kind: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [loginRetrySeconds, setLoginRetrySeconds] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(
      () => setResendSeconds((seconds) => Math.max(0, seconds - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  useEffect(() => {
    if (loginRetrySeconds <= 0) return;
    const timer = window.setInterval(
      () => setLoginRetrySeconds((seconds) => Math.max(0, seconds - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [loginRetrySeconds]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setResult({ kind: "idle" });
    setSubmitting(true);
    try {
      const response = await runAuthAction(() =>
        loginAction({ ...form, turnstileToken }, requestedDestination()),
      );
      if (response.kind === "success") {
        router.push(response.destination ?? "/portal");
        router.refresh();
        return;
      }
      setResult(response);
      if (response.kind === "limited") {
        setLoginRetrySeconds(response.cooldownSeconds ?? 60);
      }
    } finally {
      setSubmitting(false);
      setTurnstileToken(undefined);
      setTurnstileResetKey((key) => key + 1);
    }
  }

  async function resend() {
    if (resendSeconds > 0) return;
    const response = await runAuthAction(() =>
      resendConfirmationAction(form.email, turnstileToken),
    );
    setResult(response);
    setResendSeconds(response.cooldownSeconds ?? 60);
    setTurnstileToken(undefined);
    setTurnstileResetKey((key) => key + 1);
  }

  return (
    <AuthShell title="Log in" subtitle="Welcome back to PropLink UK.">
      <form onSubmit={onSubmit} className="space-y-5">
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
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="password" className={AUTH_LABEL}>
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-secondary underline decoration-line underline-offset-4 hover:decoration-accent"
            >
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="password"

            autoComplete="current-password"
            required
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            className={AUTH_INPUT}
          />
        </div>

        {result.message && (
          <div
            role="alert"
            className="rounded-xl bg-danger/10 px-4 py-3 text-sm font-medium text-danger"
          >
            <p>{result.message}</p>
            {result.kind === "limited" && loginRetrySeconds > 0 ? (
              <p aria-live="polite">Try again in {loginRetrySeconds} seconds.</p>
            ) : null}
            {result.kind === "unconfirmed" && (
              <button
                type="button"
                disabled={resendSeconds > 0}
                onClick={resend}
                className="mt-2 underline disabled:opacity-60"
              >
                {resendSeconds > 0
                  ? `Resend available in ${resendSeconds}s`
                  : "Resend confirmation email"}
              </button>
            )}
          </div>
        )}

        <TurnstileWidget onToken={setTurnstileToken} resetKey={turnstileResetKey} />

        <button
          type="submit"
          disabled={submitting || loginRetrySeconds > 0}
          className={AUTH_BUTTON}
        >
          {submitting ? "Logging in…" : "Log in"}
        </button>
      </form>

      <p className="mt-8 text-center text-sm text-muted">
        New to PropLink?{" "}
        <Link
          href="/register"
          className="font-semibold text-primary underline decoration-line underline-offset-4 hover:decoration-accent"
        >
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
