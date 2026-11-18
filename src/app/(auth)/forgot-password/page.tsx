"use client";

import Link from "next/link";
import { useState } from "react";

import { requestPasswordResetAction } from "@/app/(auth)/actions";
import {
  AUTH_BUTTON,
  AUTH_INPUT,
  AUTH_LABEL,
  AuthShell,
} from "@/components/auth/AuthShell";
import { TurnstileWidget } from "@/components/security/TurnstileWidget";
import {
  AUTH_ACTION_UNAVAILABLE_MESSAGE,
  runAuthAction,
} from "@/lib/security/auth-action-client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const result = await runAuthAction(() =>
        requestPasswordResetAction(email, turnstileToken),
      );
      if (result.kind === "limited") {
        // Keep the form so the user can retry once the limit clears.
        setError(result.message ?? AUTH_ACTION_UNAVAILABLE_MESSAGE);
        return;
      }
      setError(null);
      setMessage(result.message ?? "If an account exists, a reset email will be sent.");
    } finally {
      setSubmitting(false);
      setTurnstileToken(undefined);
      setTurnstileResetKey((key) => key + 1);
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We will email a verification link before accepting a new password."
      aside={{
        headline: (
          <>
            <>Recover access,</>
            <span className="mt-1 block font-light">without bypassing verification</span>
          </>
        ),
        points: [
          "Responses never reveal whether an account exists",
          "Reset links require an explicit verification button press",
          "Reset sessions expire and are single-use",
        ],
      }}
    >
      {message ? (
        <p className="rounded-xl bg-pale px-4 py-3 text-sm text-body">{message}</p>
      ) : (
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
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={AUTH_INPUT}
            />
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger"
            >
              {error}
            </p>
          )}
          <TurnstileWidget onToken={setTurnstileToken} resetKey={turnstileResetKey} />
          <button type="submit" disabled={submitting} className={AUTH_BUTTON}>
            {submitting ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
      <p className="mt-8 text-center text-sm text-muted">
        <Link href="/login" className="font-semibold text-primary underline">
          Back to log in
        </Link>
      </p>
    </AuthShell>
  );
}
