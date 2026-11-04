import Link from "next/link";

import { confirmAuthToken } from "@/app/(auth)/actions";
import { AUTH_BUTTON, AuthShell } from "@/components/auth/AuthShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirm email" };

const errorMessages: Record<string, string> = {
  expired: "This link has expired. Request a new email and try again.",
  reused: "This link has already been used. Log in or request a new email.",
  invalid: "This confirmation link is invalid. Request a new email and try again.",
  unverified: "Email verification is required before a password can be reset.",
};

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; error?: string }>;
}) {
  const { token_hash: tokenHash = "", type = "", error } = await searchParams;
  const validType = type === "email" || type === "recovery";
  const message = error ? errorMessages[error] ?? errorMessages.invalid : undefined;
  const action = confirmAuthToken.bind(null, tokenHash, type);

  return (
    <AuthShell
      title={type === "recovery" ? "Verify password reset" : "Confirm email"}
      subtitle={
        message ??
        (type === "recovery"
          ? "Continue to verify this reset request before choosing a new password."
          : "Use the button below to confirm your email address.")
      }
      aside={{
        headline: <><>Secure access,</><span className="mt-1 block font-light">one deliberate step</span></>,
        points: [
          "Links are consumed only after you press the confirmation button",
          "Expired and previously used links cannot create a session",
          "Confirmation never redirects to a user-supplied destination",
        ],
      }}
    >
      {!message && tokenHash && validType ? (
        <form action={action}>
          <button type="submit" className={AUTH_BUTTON}>
            {type === "recovery" ? "Continue to reset password" : "Confirm email"}
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
            {message ?? errorMessages.invalid}
          </p>
          <Link href="/forgot-password" className="block text-center text-sm font-semibold text-primary underline">
            Request a password reset
          </Link>
          <Link href="/login" className="block text-center text-sm font-semibold text-primary underline">
            Return to login to resend confirmation
          </Link>
        </div>
      )}
    </AuthShell>
  );
}

