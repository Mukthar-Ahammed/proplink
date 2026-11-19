import Link from "next/link";

import { AuthShell } from "@/components/auth/AuthShell";

export const metadata = { title: "Check your email" };

export default function CheckEmailPage() {
  return (
    <AuthShell
      title="Check your email"
      subtitle="If the address is eligible, an email with the next step is on its way."
    >
      <p className="text-sm leading-relaxed text-body">
        Open the message and follow the link. The link first opens a confirmation page; it
        is not consumed until you press the button there.
      </p>
      <Link
        href="/login"
        className="mt-6 block text-center text-sm font-semibold text-primary underline"
      >
        Return to login
      </Link>
    </AuthShell>
  );
}
