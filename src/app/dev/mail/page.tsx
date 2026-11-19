import { SubmitButton } from "@/components/ui/submit-button";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

import { isDemoMode } from "@/env";
import { requirePageRole } from "@/lib/authz";
import { clearOutbox, isDevOutboxEnabled, readOutbox } from "@/services/email/devOutbox";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dev mail inbox", robots: { index: false } };

/**
 * The hosted demo (ADR-076) is on the public internet and its emails carry
 * invitation links, so there the inbox is for signed-in Admins only.
 */
async function guardInbox() {
  if (!isDevOutboxEnabled()) notFound();
  if (isDemoMode()) await requirePageRole("ADMIN");
}

async function clearAction() {
  "use server";
  await guardInbox();
  await clearOutbox();
  revalidatePath("/dev/mail");
}

/** Links in emails become clickable; everything else stays plain text. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} className="break-all text-accent underline">
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/**
 * TEMPORARY development inbox (until Resend is configured). Shows every
 * email the app has "sent" while the mock mailer is active. 404 in
 * production or whenever a real email provider is configured; Admin-only in
 * the hosted demo.
 */
export default async function DevMailPage() {
  await guardInbox();
  const mails = await readOutbox();

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10 sm:px-6">
      <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
        <p className="font-semibold text-warning">
          Development and demo only: emails are not really sent.
        </p>
        <p className="mt-1 text-muted">
          This page shows what the app would have emailed. It disappears when a real email
          provider (Resend) is configured. Sign-up confirmation and password-reset emails
          come from Supabase, not this app, so they do not appear here.
        </p>
      </div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-primary">Mail inbox ({mails.length})</h1>
        <form action={clearAction}>
          <SubmitButton
            type="submit"
            className="rounded-2xl border border-line px-3 py-1.5 text-sm font-semibold text-primary"
          >
            Clear
          </SubmitButton>
        </form>
      </div>
      {mails.length === 0 ? (
        <p className="text-sm text-muted">No emails yet.</p>
      ) : (
        <ul className="space-y-4">
          {mails.map((mail) => (
            <li
              key={mail.id}
              className="rounded-2xl border border-line bg-white p-4"
              data-testid="dev-mail"
            >
              <p className="text-xs text-muted">
                {mail.sentAt.replace("T", " ").slice(0, 19)} UTC · to {mail.to}
              </p>
              <p className="mt-1 font-semibold text-primary">{mail.subject}</p>
              <p className="mt-3 text-sm whitespace-pre-line text-body">
                <Linkified text={mail.text} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
