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

import {
  acceptSolicitorInviteAction,
  inspectSolicitorInviteAction,
  type SolicitorInviteView,
} from "./actions";

const UNAVAILABLE =
  "Too many attempts, or the service is temporarily unavailable. Please wait a minute and try again.";

function readToken(): string {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return params.get("token") ?? "";
}

/** Phase 4 Task 5 (ADR-047): a project's Solicitor accepts their invitation. */
export function AcceptSolicitorInviteForm() {
  const router = useRouter();
  // Read once in the browser; the server render never sees the fragment.
  const [token] = useState(() => (typeof window === "undefined" ? "" : readToken()));
  const [view, setView] = useState<SolicitorInviteView | { kind: "loading" }>({
    kind: "loading",
  });
  const [form, setForm] = useState({ name: "", password: "", acceptTerms: false });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    inspectSolicitorInviteAction(token)
      .then(setView)
      .catch(() => setView({ kind: "problem", message: UNAVAILABLE }));
  }, [token]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await acceptSolicitorInviteAction({ token, ...form });
      if (result.kind === "success") {
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
      title="Your Solicitor account"
      subtitle="Set your password to accept your appointment."
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
        <form onSubmit={onSubmit} className="space-y-4">
          <p className="text-sm text-body">
            Project: <strong>{view.projectTitle}</strong>
            <br />
            Email: <strong>{view.email}</strong>
          </p>
          <label className={AUTH_LABEL}>
            Your full name
            <input
              type="text"
              required
              autoComplete="name"
              maxLength={100}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className={AUTH_INPUT}
            />
          </label>
          <label className={AUTH_LABEL}>
            Password
            <input
              type="password"
              required
              autoComplete="new-password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              className={AUTH_INPUT}
            />
          </label>
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
              <Link
                href="/terms"
                className="font-semibold text-primary underline hover:text-accent"
              >
                terms of service
              </Link>{" "}
              and{" "}
              <Link
                href="/privacy"
                className="font-semibold text-primary underline hover:text-accent"
              >
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
            {submitting ? "Creating your account…" : "Accept appointment"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
