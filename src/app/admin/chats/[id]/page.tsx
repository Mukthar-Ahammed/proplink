import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { requireAdminPagePermission } from "@/lib/authz";
import { adminReadThread } from "@/services/chat/messages";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Admin — Read chat | PropLink",
  robots: { index: false },
};

/**
 * Admin reads a chat only after giving a reason; each read is audited
 * (CHAT_ADMIN_READ). Admin never posts in a chat.
 */
export default async function AdminReadChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ reason?: string }>;
}) {
  const session = await requireAdminPagePermission("CHAT_AUTHORIZATION");
  const { id } = await params;
  const { reason } = await searchParams;
  const back = (
    <Link
      href="/admin/chats"
      className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-primary"
    >
      Back to chats
    </Link>
  );

  if (!reason) {
    return (
      <div className="space-y-6">
        <AdminPageHeader
          title="Read a chat"
          description="Your access is recorded with the reason you give."
          action={back}
        />
        <form method="get" className="max-w-lg space-y-3">
          <label className="block text-sm font-medium text-primary">
            Why do you need to read this chat?
            <input
              name="reason"
              required
              minLength={5}
              maxLength={300}
              className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
            />
          </label>
          <button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white">
            Read (logged)
          </button>
        </form>
      </div>
    );
  }

  const result = await adminReadThread(
    {
      profileId: session.user.authUserId,
      legacyUserId: session.user.id,
      role: session.user.role,
    },
    id,
    reason,
  );
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <p className="text-sm text-danger">{result.error}</p>;
  }
  const names = new Map([
    [result.thread.participantA, result.thread.a.name ?? "Participant A"],
    [result.thread.participantB, result.thread.b.name ?? "Participant B"],
  ]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Chat (read-only)"
        description={`Status: ${result.thread.status.toLowerCase()}. Your read was logged.`}
        action={back}
      />
      <Card>
        <CardTitle>Messages</CardTitle>
        <CardBody>
          {result.messages.length === 0 ? (
            <p className="text-sm text-muted">No messages.</p>
          ) : (
            <ol className="space-y-3 text-sm">
              {result.messages.map((message) => (
                <li key={message.id}>
                  <p className="text-xs text-muted">
                    {names.get(message.senderId)} ·{" "}
                    {message.createdAt.slice(0, 16).replace("T", " ")}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-body">
                    {message.body}
                  </p>
                  {message.attachments.map((file) => (
                    <p key={file.fileId} className="text-xs">
                      {file.url ? (
                        <a href={file.url} className="underline">
                          {file.name}
                        </a>
                      ) : (
                        file.name
                      )}
                    </p>
                  ))}
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
