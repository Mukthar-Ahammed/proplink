"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";

import {
  redeemRecoveryCodeAction,
  regenerateRecoveryCodesAction,
  startEnrollmentAction,
  verifyChallengeAction,
  verifyEnrollmentAction,
  type EnrollStart,
  type RecoveryState,
  type RegenerateState,
  type VerifyState,
} from "./actions";

const INPUT =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body focus:border-accent focus:outline-none";
const BUTTON =
  "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60";

function CodeField({ id, label }: { id: string; label: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-primary">
        {label}
      </label>
      <input
        id={id}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        className={`${INPUT} max-w-40 tracking-widest`}
      />
    </div>
  );
}

function RecoveryCodes({ codes, next }: { codes: string[]; next: string }) {
  return (
    <div className="space-y-4" role="status">
      <p className="text-sm font-semibold text-success">Authenticator set up.</p>
      <p className="text-sm text-body">
        Save these recovery codes somewhere safe, such as a password manager. Each works
        once if you lose your phone. They are shown only now.
      </p>
      <ul
        className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-white p-4 font-mono text-sm"
        data-testid="recovery-codes"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <Link href={next} className={BUTTON}>
        I&apos;ve saved them, continue
      </Link>
    </div>
  );
}

export function EnrollForm({ next }: { next: string }) {
  const [enrollment, setEnrollment] = useState<EnrollStart | null>(null);
  const [starting, startTransition] = useTransition();
  const [state, formAction, pending] = useActionState(verifyEnrollmentAction, {
    kind: "idle",
  } as VerifyState);

  if (state.kind === "verified") {
    return state.recoveryCodes ? (
      <RecoveryCodes codes={state.recoveryCodes} next={next} />
    ) : (
      <Link href={next} className={BUTTON}>
        Continue
      </Link>
    );
  }

  if (!enrollment || enrollment.kind === "error") {
    return (
      <div className="space-y-3">
        <button
          type="button"
          className={BUTTON}
          disabled={starting}
          onClick={() =>
            startTransition(async () => setEnrollment(await startEnrollmentAction()))
          }
        >
          {starting ? "Starting…" : "Set up authenticator app"}
        </button>
        {enrollment?.kind === "error" && (
          <p role="alert" className="text-sm text-danger">
            {enrollment.message}
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <p className="text-sm text-body">
        Scan this QR code with an authenticator app (for example Google Authenticator,
        Microsoft Authenticator or 1Password), then enter the 6-digit code it shows.
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URI from Supabase */}
      <img
        src={enrollment.qrCode}
        alt="QR code to add PropLink to your authenticator app"
        className="h-48 w-48 rounded-lg border border-line bg-white p-2"
      />
      <p className="text-xs text-muted">
        Can&apos;t scan? Enter this key instead:{" "}
        <code className="break-all font-mono">{enrollment.secret}</code>
      </p>
      <input type="hidden" name="factorId" value={enrollment.factorId} />
      <CodeField id="enroll-code" label="6-digit code" />
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? "Checking…" : "Verify and turn on"}
      </button>
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      )}
    </form>
  );
}

export function ChallengeForm({ next, label }: { next: string; label: string }) {
  const [state, formAction, pending] = useActionState(verifyChallengeAction, {
    kind: "idle",
  } as VerifyState);
  if (state.kind === "verified") {
    return (
      <div role="status" className="space-y-3">
        <p className="text-sm text-success">Verified.</p>
        <Link href={next} className={BUTTON}>
          Continue
        </Link>
      </div>
    );
  }
  return (
    <form action={formAction} className="space-y-3">
      <CodeField id="challenge-code" label={label} />
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? "Checking…" : "Verify"}
      </button>
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      )}
    </form>
  );
}

export function RecoveryForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(redeemRecoveryCodeAction, {
    kind: "idle",
  } as RecoveryState);
  if (state.kind === "ok") {
    return (
      <div role="status" className="space-y-3">
        <p className="text-sm text-success">
          Recovery code accepted for this session. Set up a new authenticator soon: ask
          PropLink to reset your old one if you lost it.
        </p>
        <Link href={next} className={BUTTON}>
          Continue
        </Link>
      </div>
    );
  }
  return (
    <form action={formAction} className="space-y-3">
      <label htmlFor="recovery-code" className="block text-sm font-medium text-primary">
        Recovery code
      </label>
      <input
        id="recovery-code"
        name="recoveryCode"
        autoComplete="off"
        maxLength={20}
        required
        className={`${INPUT} max-w-56 font-mono`}
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-primary disabled:opacity-60"
      >
        {pending ? "Checking…" : "Use recovery code"}
      </button>
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      )}
    </form>
  );
}

export function RegenerateCodes() {
  const [state, formAction, pending] = useActionState(regenerateRecoveryCodesAction, {
    kind: "idle",
  } as RegenerateState);
  if (state.kind === "codes") {
    return (
      <ul
        className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-white p-4 font-mono text-sm"
        role="status"
      >
        {state.codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
    );
  }
  return (
    <form action={formAction} className="space-y-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-primary disabled:opacity-60"
      >
        {pending ? "Generating…" : "Generate new recovery codes"}
      </button>
      <p className="text-xs text-muted">Your old codes stop working.</p>
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      )}
    </form>
  );
}
