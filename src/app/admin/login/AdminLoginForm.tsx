"use client";

import Link from "next/link";
import { useActionState, useCallback, useEffect, useState, useTransition } from "react";

import { adminLoginAction, type AuthActionResult } from "@/app/(auth)/actions";
import {
  redeemRecoveryCodeAction,
  startEnrollmentAction,
  verifyChallengeAction,
  verifyEnrollmentAction,
  type EnrollStart,
  type RecoveryState,
  type VerifyState,
} from "@/app/mfa/actions";
import {
  AUTH_BUTTON,
  AUTH_INPUT,
  AUTH_LABEL,
  AuthShell,
} from "@/components/auth/AuthShell";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { TurnstileWidget } from "@/components/security/TurnstileWidget";
import { runAuthAction } from "@/lib/security/auth-action-client";

import {
  adminLoginStepAction,
  cancelAdminLoginAction,
  type AdminLoginStep,
} from "./actions";

type CardStep = Exclude<AdminLoginStep, "done">;

const LINK =
  "font-semibold text-primary underline decoration-line underline-offset-4 hover:decoration-accent";

/**
 * Admin sign-in (ADR-030): one card that changes in place. Password first; then
 * the authenticator code (or, the first time, authenticator set-up) on the
 * same page. Only after both does the Admin reach /admin and its chrome.
 */
export function AdminLoginForm({ initialStep }: { initialStep: CardStep }) {
  const [step, setStep] = useState<CardStep>(initialStep);

  // A full page load, not router.push: /admin/login shares app/admin/layout.tsx
  // with the portal, and Next keeps a layout across client navigation, so a
  // soft push would keep the shell-less login layout (no sidebar or header).
  const enterAdmin = useCallback(() => {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load is required (see above)
    window.location.assign("/admin");
  }, []);

  async function afterPassword() {
    const next = await adminLoginStepAction();
    if (next === "done") enterAdmin();
    else setStep(next);
  }

  if (step === "challenge") {
    return (
      <AuthShell
        title="Enter authentication code"
        subtitle="Open your authenticator app and enter the 6-digit code for PropLink."
      >
        <ChallengeCard onVerified={enterAdmin} />
      </AuthShell>
    );
  }
  if (step === "enroll") {
    return (
      <AuthShell
        title="Set up two-step verification"
        subtitle="Admin accounts must use an authenticator app. Set it up to continue."
      >
        <EnrollCard onDone={enterAdmin} />
      </AuthShell>
    );
  }
  return (
    <AuthShell
      title="Admin sign in"
      subtitle="Restricted access for PropLink platform administrators."
    >
      <PasswordCard onSignedIn={afterPassword} />
    </AuthShell>
  );
}

function PasswordCard({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
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
        await onSignedIn();
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
    <>
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
          <PasswordInput
            id="admin-password"
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
        <Link href="/login" className={LINK}>
          Use user sign in
        </Link>
      </p>
    </>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-xl bg-danger/10 px-4 py-3 text-sm font-medium text-danger"
    >
      {message}
    </div>
  );
}

function CodeInput({ id, autoFocus }: { id: string; autoFocus?: boolean }) {
  return (
    <div>
      <label htmlFor={id} className={AUTH_LABEL}>
        Authentication code
      </label>
      <input
        id={id}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        autoFocus={autoFocus}
        placeholder="123456"
        className={`${AUTH_INPUT} text-center font-mono text-lg tracking-[0.5em]`}
      />
    </div>
  );
}

/** Signs out the password-only session so another account can be used. */
function CancelLink() {
  return (
    <form action={cancelAdminLoginAction} className="mt-8 text-center text-sm text-muted">
      Wrong account?{" "}
      <button type="submit" className={LINK}>
        Start again
      </button>
    </form>
  );
}

function ChallengeCard({ onVerified }: { onVerified: () => void }) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [state, formAction, pending] = useActionState(verifyChallengeAction, {
    kind: "idle",
  } as VerifyState);
  const [recovery, recoveryAction, recoveryPending] = useActionState(
    redeemRecoveryCodeAction,
    { kind: "idle" } as RecoveryState,
  );

  const verified = state.kind === "verified" || recovery.kind === "ok";
  useEffect(() => {
    if (verified) onVerified();
  }, [verified, onVerified]);

  if (useRecovery) {
    return (
      <>
        <form action={recoveryAction} className="space-y-5">
          <div>
            <label htmlFor="admin-recovery-code" className={AUTH_LABEL}>
              Recovery code
            </label>
            <input
              id="admin-recovery-code"
              name="recoveryCode"
              autoComplete="off"
              maxLength={20}
              required
              autoFocus
              className={`${AUTH_INPUT} font-mono`}
            />
          </div>
          {recovery.kind === "error" && <ErrorBox message={recovery.message} />}
          <button
            type="submit"
            disabled={recoveryPending || verified}
            className={AUTH_BUTTON}
          >
            {recoveryPending || verified ? "Checking…" : "Use recovery code"}
          </button>
        </form>
        <p className="mt-5 text-center text-sm text-muted">
          <button type="button" className={LINK} onClick={() => setUseRecovery(false)}>
            Use your authenticator app instead
          </button>
        </p>
        <CancelLink />
      </>
    );
  }

  return (
    <>
      <form action={formAction} className="space-y-5">
        <CodeInput id="admin-mfa-code" autoFocus />
        {state.kind === "error" && <ErrorBox message={state.message} />}
        <button type="submit" disabled={pending || verified} className={AUTH_BUTTON}>
          {pending || verified ? "Verifying…" : "Verify and continue"}
        </button>
      </form>
      <p className="mt-5 text-center text-sm text-muted">
        Lost your phone?{" "}
        <button type="button" className={LINK} onClick={() => setUseRecovery(true)}>
          Use a recovery code
        </button>
      </p>
      <CancelLink />
    </>
  );
}

function EnrollCard({ onDone }: { onDone: () => void }) {
  const [enrollment, setEnrollment] = useState<EnrollStart | null>(null);
  const [starting, startTransition] = useTransition();
  const [state, formAction, pending] = useActionState(verifyEnrollmentAction, {
    kind: "idle",
  } as VerifyState);

  const verifiedWithoutCodes = state.kind === "verified" && !state.recoveryCodes;
  useEffect(() => {
    if (verifiedWithoutCodes) onDone();
  }, [verifiedWithoutCodes, onDone]);

  if (state.kind === "verified" && state.recoveryCodes) {
    return (
      <div className="space-y-5" role="status">
        <p className="text-sm text-body">
          Save these recovery codes somewhere safe, such as a password manager. Each works
          once if you lose your phone. They are shown only now.
        </p>
        <ul
          className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-white p-4 font-mono text-sm"
          data-testid="recovery-codes"
        >
          {state.recoveryCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <button type="button" className={AUTH_BUTTON} onClick={onDone}>
          I&apos;ve saved them, continue
        </button>
      </div>
    );
  }

  if (!enrollment || enrollment.kind === "error") {
    return (
      <>
        <div className="space-y-5">
          {enrollment?.kind === "error" && <ErrorBox message={enrollment.message} />}
          <button
            type="button"
            className={AUTH_BUTTON}
            disabled={starting}
            onClick={() =>
              startTransition(async () => setEnrollment(await startEnrollmentAction()))
            }
          >
            {starting ? "Starting…" : "Set up authenticator app"}
          </button>
        </div>
        <CancelLink />
      </>
    );
  }

  return (
    <>
      <form action={formAction} className="space-y-5">
        <p className="text-sm text-body">
          Scan this QR code with an authenticator app (for example Google Authenticator,
          Microsoft Authenticator or 1Password), then enter the 6-digit code it shows.
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element -- data URI from Supabase */}
        <img
          src={enrollment.qrCode}
          alt="QR code to add PropLink to your authenticator app"
          className="mx-auto h-44 w-44 rounded-xl border border-line bg-white p-2"
        />
        <p className="text-xs text-muted">
          Can&apos;t scan? Enter this key instead:{" "}
          <code className="break-all font-mono">{enrollment.secret}</code>
        </p>
        <input type="hidden" name="factorId" value={enrollment.factorId} />
        <CodeInput id="admin-enroll-code" />
        {state.kind === "error" && <ErrorBox message={state.message} />}
        <button type="submit" disabled={pending} className={AUTH_BUTTON}>
          {pending ? "Checking…" : "Verify and turn on"}
        </button>
      </form>
      <CancelLink />
    </>
  );
}
