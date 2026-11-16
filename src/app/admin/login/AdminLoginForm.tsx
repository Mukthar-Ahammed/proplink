"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { adminLoginAction, type AuthActionResult } from "@/app/(auth)/actions";
import {
  AUTH_BUTTON,
  AUTH_INPUT,
  AUTH_LABEL,
  AuthShell,
} from "@/components/auth/AuthShell";
import { TurnstileWidget } from "@/components/security/TurnstileWidget";
import { runAuthAction } from "@/lib/security/auth-action-client";

export function AdminLoginForm() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [result, setResult] = useState<AuthActionResult>({ kind: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  useEffect(() => {
    if (retrySeconds <= 0) return;
    const timer = window.setInterval(
      () => setRetrySeconds((seconds) => Math.max(0, seconds - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [retrySeconds]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setResult({ kind: "idle" });
    setSubmitting(true);
    try {
      const response = await runAuthAction(() =>
        adminLoginAction({ ...form, turnstileToken }),
      );
      if (response.kind === "success") {
        router.push("/admin");
        router.refresh();
        return;
      }
      setResult(response);
      if (response.kind === "limited") {
        setRetrySeconds(response.cooldownSeconds ?? 60);
      }
    } finally {
      setSubmitting(false);
      setTurnstileToken(undefined);
      setTurnstileResetKey((key) => key + 1);
    }
  }

  return (
    <AuthShell
      title="Admin sign in"
      subtitle="Restricted access for PropLink platform administrators."
      aside={{
        headline: (
          <>
            Platform operations,
            <span className="mt-1 block font-light">securely separated</span>
          </>
        ),
        points: [
          "Review platform users and account status",
          "Moderate listings through server-authorized controls",
          "Access administrative queues with least privilege",
        ],
      }}
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <label htmlFor="admin-email" className={AUTH_LABEL}>
            Admin email
          </label>
          <input
            id="admin-email"
            type="email"
            autoComplete="username"
            required
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            className={AUTH_INPUT}
          />
        </div>
        <div>
          <label htmlFor="admin-password" className={AUTH_LABEL}>
            Password
          </label>
          <input
            id="admin-password"
            type="password"
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
            {result.message}
            {result.kind === "limited" && retrySeconds > 0 ? (
              <p aria-live="polite">Try again in {retrySeconds} seconds.</p>
            ) : null}
          </div>
        )}

        <TurnstileWidget onToken={setTurnstileToken} resetKey={turnstileResetKey} />

        <button
          type="submit"
          disabled={submitting || retrySeconds > 0}
          className={AUTH_BUTTON}
        >
          {submitting ? "Signing in…" : "Sign in to Admin"}
        </button>
      </form>

      <p className="mt-8 text-center text-sm text-muted">
        Not an administrator?{" "}
        <Link
          href="/login"
          className="font-semibold text-primary underline decoration-line underline-offset-4 hover:decoration-accent"
        >
          Use user sign in
        </Link>
      </p>
    </AuthShell>
  );
}
