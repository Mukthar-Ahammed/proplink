import Link from "next/link";

import { AuthShell } from "@/components/auth/AuthShell";

export const metadata = { title: "Check your email" };

export default function CheckEmailPage() {
  return (
    <AuthShell
      title="Check your email"
      subtitle="If the address is eligible, an email with the next step is on its way."
      aside={{
        headline: <><>One inbox check,</><span className="mt-1 block font-light">then you are ready</span></>,
        points: [
          "Registration does not create a usable session before confirmation",
          "The same response is shown for new and existing addresses",
          "Return to login if you need to resend the confirmation email",
        ],
      }}
    >
      <p className="text-sm leading-relaxed text-body">
        Open the message and follow the link. The link first opens a confirmation
        page; it is not consumed until you press the button there.
      </p>
      <Link href="/login" className="mt-6 block text-center text-sm font-semibold text-primary underline">
        Return to login
      </Link>
    </AuthShell>
  );
}

