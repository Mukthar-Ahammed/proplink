import { notFound, redirect } from "next/navigation";

import { SubscriptionGate } from "@/components/billing/SubscriptionGate";
import { MessagesShell } from "@/components/chat/MessagesShell";
import { ThreadList } from "@/components/chat/ThreadList";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { listMessages } from "@/services/chat/messages";
import { contextTitles, counterpartLabel, listThreadsFor } from "@/services/chat/threads";
import { photoUrlsFor } from "@/services/profiles/userProfiles";

import { ChatWindow } from "./ChatWindow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Conversation — PropLink UK", robots: { index: false } };

const NOTICE: Record<string, string> = {
  pending:
    "PropLink is reviewing this chat. You can send messages once it is authorised (usually within a working day).",
  closed: "This chat is closed. You can still read its history.",
  your_subscription:
    "Your subscription is not active, so this chat is read-only until you renew (Billing).",
  their_subscription:
    "This chat is read-only until the other person renews their subscription.",
};

/** One conversation (Phase 3, ADR-043). Participants only; same 404 otherwise. */
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id } = await params;
  const viewer = { profileId: session.user.authUserId, role: session.user.role };
  const result = await listMessages(viewer, id);
  if (!result.ok) notFound();
  const { thread } = result.access;
  const counterpart = await db.profile.findUnique({
    where: { id: result.access.counterpartId },
    select: { name: true, verificationBadge: { select: { profileId: true } } },
  });
  const titles = await contextTitles([thread]);
  const counterpartName = counterpartLabel(
    thread,
    viewer.profileId,
    counterpart?.name ?? null,
  );

  const threads = await listThreadsFor(viewer);
  // Lead/co-investor chats are anonymised, so the counterpart never gets a photo.
  const anonymised = thread.pairType === "LEAD_CO_INVESTOR";
  const photos = await photoUrlsFor(viewer, [
    viewer.profileId,
    ...(anonymised ? [] : [result.access.counterpartId]),
  ]);
  const title = titles.get(`${thread.contextType}:${thread.contextId}`) ?? "Conversation";

  return (
    <MessagesShell
      conversationOpen
      list={<ThreadList threads={threads} activeId={thread.id} />}
    >
      <div className="flex h-full min-h-0 flex-col gap-3">
        <h2 className="sr-only">
          {title}, with {counterpartName}
        </h2>
        {result.access.blocked === "your_subscription" && (
          <div
            data-testid="chat-subscribe"
            className="flex flex-col gap-3 rounded-2xl border border-accent/30 bg-pale p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="text-sm text-body">
              You need an active subscription to send messages in this chat.
            </p>
            {/* Opens the popup straight away: this is the moment it is needed. */}
            <SubscriptionGate autoOpen />
          </div>
        )}
        <div className="h-[calc(100dvh-10rem)] min-h-[28rem] lg:h-auto lg:min-h-0 lg:flex-1">
          <ChatWindow
            threadId={thread.id}
            viewerId={viewer.profileId}
            viewerName={session.user.name}
            counterpart={counterpartName}
            counterpartVerified={Boolean(counterpart?.verificationBadge)}
            counterpartPhotoUrl={
              anonymised ? null : (photos.get(result.access.counterpartId) ?? null)
            }
            viewerPhotoUrl={photos.get(viewer.profileId) ?? null}
            context={title}
            initialMessages={result.messages}
            initialCanSend={result.access.canSend}
            initialNotice={result.access.blocked ? NOTICE[result.access.blocked] : null}
          />
        </div>
      </div>
    </MessagesShell>
  );
}
