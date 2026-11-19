import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { PORTAL_HOME } from "@/lib/portalHome";
import { createClient } from "@/lib/supabase/server";
import { isMfaSatisfied, remainingRecoveryCodes, requiresMfa } from "@/services/auth/mfa";

import { ChallengeForm, EnrollForm, RecoveryForm, RegenerateCodes } from "./MfaForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Two-step verification — PropLink UK" };

/** Internal paths only: never an open redirect. */
function safeNext(raw: string | undefined, fallback: string): string {
  return raw && /^\/(?!\/)[\w\-/?=&.%]*$/.test(raw) ? raw : fallback;
}

/**
 * Two-step verification (Phase 1 Task 11, ADR-030): set up an authenticator,
 * verify a code to continue, re-authenticate for sensitive actions, or use a
 * recovery code. Required for Admin and Solicitor; optional for others.
 */
export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reauth?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { user } = session;
  const params = await searchParams;
  const next = safeNext(params.next, PORTAL_HOME[user.role]);
  const reauth = params.reauth === "1";

  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const hasFactor = Boolean(factors?.totp.some((f) => f.status === "verified"));
  const satisfied = await isMfaSatisfied(user);
  const required = requiresMfa(user.role);

  if (hasFactor && satisfied && !reauth && required) redirect(next);
  // An Admin's sign-in second factor is taken on the Admin sign-in card, so
  // the site chrome (and its sign-out) never shows before both steps pass.
  if (user.role === "ADMIN" && !satisfied && !reauth) redirect("/admin/login");

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-bold text-primary">Two-step verification</h1>

      {!hasFactor ? (
        <section className="mt-6 space-y-4">
          <p className="text-sm text-muted">
            {required
              ? "Your account type must use an authenticator app. Set it up to continue."
              : "Add an authenticator app for extra protection when you sign in."}
          </p>
          <EnrollForm next={next} />
        </section>
      ) : reauth || !satisfied ? (
        <section className="mt-6 space-y-8">
          <div className="space-y-2">
            <p className="text-sm text-muted">
              {reauth
                ? "Confirm it's you: enter the current code from your authenticator app."
                : "Enter the current code from your authenticator app to continue."}
            </p>
            <ChallengeForm next={next} label="6-digit code" />
          </div>
          {!reauth && (
            <details className="rounded-2xl border border-line bg-white p-4">
              <summary className="cursor-pointer text-sm font-medium text-primary">
                Lost your phone? Use a recovery code
              </summary>
              <div className="mt-4">
                <RecoveryForm next={next} />
              </div>
            </details>
          )}
        </section>
      ) : (
        <section className="mt-6 space-y-6">
          <p className="text-sm text-success">Two-step verification is on.</p>
          <p className="text-sm text-muted">
            Recovery codes left: {await remainingRecoveryCodes(user.authUserId)}
          </p>
          <RegenerateCodes />
        </section>
      )}
    </main>
  );
}
