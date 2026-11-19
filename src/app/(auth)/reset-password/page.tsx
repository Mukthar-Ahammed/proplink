"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { resetPasswordAction } from "@/app/(auth)/actions";
import {
  AUTH_BUTTON,
  AUTH_INPUT,
  AUTH_LABEL,
  AuthShell,
} from "@/components/auth/AuthShell";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { runAuthAction } from "@/lib/security/auth-action-client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await runAuthAction(() => resetPasswordAction(password));
      if (result.kind === "success") {
        router.push("/login?reset=1");
        router.refresh();
        return;
      }
      setError(result.message ?? "Unable to update the password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Your verified reset session is valid for a limited time."
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <label htmlFor="password" className={AUTH_LABEL}>
            New password
          </label>
          <PasswordInput
            id="password"

            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={AUTH_INPUT}
          />
          <p className="mt-1 text-xs text-muted">At least 8 characters.</p>
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger"
          >
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting} className={AUTH_BUTTON}>
          {submitting ? "Saving…" : "Set new password"}
        </button>
      </form>
      <Link
        href="/forgot-password"
        className="mt-6 block text-center text-sm font-semibold text-primary underline"
      >
        Request a new reset email
      </Link>
    </AuthShell>
  );
}
