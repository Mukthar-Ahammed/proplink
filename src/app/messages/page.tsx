import { redirect } from "next/navigation";

import { SubscriptionBanner } from "@/components/billing/SubscriptionGate";
import { MessagesShell } from "@/components/chat/MessagesShell";
import { ThreadList } from "@/components/chat/ThreadList";
import { auth } from "@/lib/auth";
import { listThreadsFor } from "@/services/chat/threads";

export const dynamic = "force-dynamic";
export const metadata = { title: "Messages — PropLink UK", robots: { index: false } };

/** Every one-to-one chat the signed-in person is part of (Phase 3, ADR-043). */
export default async function MessagesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const threads = await listThreadsFor({
    profileId: session.user.authUserId,
    role: session.user.role,
  });

  return (
    <MessagesShell
      conversationOpen={false}
      list={
        <div className="flex h-full min-h-0 flex-col gap-3">
          {/* Phones see only this pane, so the subscription notice sits here too. */}
          <div className="lg:hidden">
            <SubscriptionBanner />
          </div>
          <div className="min-h-[24rem] flex-1 lg:min-h-0">
            <ThreadList threads={threads} />
          </div>
        </div>
      }
    >
      <section className="flex h-full flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-line bg-surface p-8 text-center">
        <span
          aria-hidden
          className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-accent ring-1 ring-line"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-8 w-8"
          >
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
            <path d="M8.5 11h7M8.5 14h4" />
          </svg>
        </span>
        <div>
          <h2 className="text-lg font-semibold text-primary">Pick a conversation</h2>
          <p className="mt-1 max-w-md text-sm text-muted">
            Choose one from the list. Each chat is one-to-one and about one property. A
            chat opens once PropLink authorises it (buyer enquiries open straight away).
          </p>
        </div>
        <div className="w-full max-w-lg text-left">
          <SubscriptionBanner />
        </div>
      </section>
    </MessagesShell>
  );
}
