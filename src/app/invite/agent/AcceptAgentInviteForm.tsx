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
import { acceptInviteAction, inspectInviteAction, type InviteView } from "./actions";

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

  useEffect(() => {
    inspectInviteAction(token)
      .then(setView)
      .catch(() => setView({ kind: "problem", message: UNAVAILABLE }));
  }, [token]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await acceptInviteAction({ token, ...form });
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
      aside={{
        headline: (
          <>
            Invitation only,
            <span className="mt-1 block font-light">verified from day one</span>
          </>
        ),
        points: [
          "Agent accounts are created by PropLink invitation",
          "Your invitation works once and only for your email",
          "You will land straight in your agent dashboard",
        ],
      }}
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
