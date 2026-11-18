import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { listMessages } from "@/services/chat/messages";
import { contextTitles } from "@/services/chat/threads";

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
    select: { name: true },
  });
  const titles = await contextTitles([thread]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <Link href="/messages" className="text-sm font-semibold text-primary underline">
        All messages
      </Link>
      <h1 className="mt-3 text-xl font-bold text-primary">
        {titles.get(`${thread.contextType}:${thread.contextId}`) ?? "Conversation"}
      </h1>
      <p className="text-sm text-muted">
        With {counterpart?.name ?? "a PropLink member"}
      </p>
      <div className="mt-6">
        <ChatWindow
          threadId={thread.id}
          viewerId={viewer.profileId}
          counterpart={counterpart?.name ?? "Them"}
          initialMessages={result.messages}
          initialCanSend={result.access.canSend}
          initialNotice={result.access.blocked ? NOTICE[result.access.blocked] : null}
        />
      </div>
    </main>
  );
}
