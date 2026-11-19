import Link from "next/link";
import { redirect } from "next/navigation";

import { SubscriptionBanner } from "@/components/billing/SubscriptionGate";
import { auth } from "@/lib/auth";
import { listThreadsFor } from "@/services/chat/threads";

export const dynamic = "force-dynamic";
export const metadata = { title: "Messages — PropLink UK", robots: { index: false } };

const PAIR: Record<string, string> = {
  LANDLORD_AGENT: "Landlord and agent",
  AGENT_INVESTOR: "Agent and investor",
  LEAD_CO_INVESTOR: "Lead and co-investor",
  BUYER_AGENT: "Buyer and agent",
};
const STATUS: Record<string, string> = {
  PENDING: "Waiting for PropLink to authorise",
  AUTHORIZED: "Open",
  CLOSED: "Closed (read-only)",
};

/** Every one-to-one chat the signed-in person is part of (Phase 3, ADR-043). */
export default async function MessagesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const threads = await listThreadsFor({
    profileId: session.user.authUserId,
    role: session.user.role,
  });

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-primary">Messages</h1>
      <p className="mt-2 text-sm text-muted">
        One-to-one conversations about a property. A chat opens once PropLink authorises
        it (buyer enquiries open straight away).
      </p>
      <div className="mt-6">
        <SubscriptionBanner />
      </div>
      {threads.length === 0 ? (
        <p className="mt-8 text-sm text-muted">No conversations yet.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {threads.map((thread) => (
            <li key={thread.id}>
              <Link
                href={`/messages/${thread.id}`}
                className="block rounded-lg border border-line bg-white p-4 hover:border-accent"
                data-testid={`thread-${thread.id}`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-primary">{thread.title}</span>
                  {thread.unread > 0 && (
                    <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white">
                      {thread.unread} new
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-sm text-muted">
                  {thread.counterpart} · {PAIR[thread.pairType]} · {STATUS[thread.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
