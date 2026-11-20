import Form from "next/form";
import { notFound } from "next/navigation";

import { DetailHeader, KeyFacts, Panel, TabBody } from "@/components/portal/Detail";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { requireAdminPagePermission } from "@/lib/authz";
import { adminReadThread } from "@/services/chat/messages";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Admin — Read chat | PropLink",
  robots: { index: false },
};

const BACK = { href: "/admin/chats", label: "Back to chats" };

/**
 * Admin reads a chat only after giving a reason; each read is audited
 * (CHAT_ADMIN_READ). Admin never posts in a chat. Laid out per ADR-080.
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

  if (!reason) {
    return (
      <div>
        <h1 className="sr-only">Read a chat</h1>
        <DetailHeader
          back={BACK}
          eyebrow="Private chat"
          title="Read a chat"
          subtitle="Your access is recorded with the reason you give."
        />
        <TabBody>
          <Panel
            title="Give a reason"
            tone="attention"
            description="Chats are private. Reading one is logged against your account with this reason."
            className="max-w-xl"
          >
            <Form action="" className="space-y-3">
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
              <SubmitButton className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white">
                Read (logged)
              </SubmitButton>
            </Form>
          </Panel>
        </TabBody>
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
  const nameA = result.thread.a.name ?? "Participant A";
  const nameB = result.thread.b.name ?? "Participant B";
  const names = new Map([
    [result.thread.participantA, nameA],
    [result.thread.participantB, nameB],
  ]);
  const last = result.messages.at(-1);

  return (
    <div>
      <h1 className="sr-only">Read a chat</h1>
      <DetailHeader
        back={BACK}
        eyebrow="Private chat · read-only"
        title={`${nameA} ↔ ${nameB}`}
        badges={
          <>
            <Badge>{result.thread.status.toLowerCase()}</Badge>
            <Badge tone="warning">Your read was logged</Badge>
          </>
        }
        subtitle={`Status: ${result.thread.status.toLowerCase()}. Your read was logged. Reason: ${reason}`}
      />

      <KeyFacts
        items={[
          { label: "Messages", value: result.messages.length },
          { label: "Participant A", value: nameA },
          { label: "Participant B", value: nameB },
          {
            label: "Last message (UTC)",
            value: last ? last.createdAt.slice(0, 16).replace("T", " ") : "—",
          },
        ]}
      />

      <TabBody>
        <Panel title="Messages" description="Oldest first. Admin cannot post here.">
          {result.messages.length === 0 ? (
            <p className="text-sm text-muted">No messages.</p>
          ) : (
            <ol className="space-y-3 text-sm">
              {result.messages.map((message) => (
                <li
                  key={message.id}
                  className={`max-w-2xl rounded-xl border border-line p-3 ${
                    message.senderId === result.thread.participantB
                      ? "ml-auto bg-pale"
                      : "bg-white"
                  }`}
                >
                  <p className="text-xs text-muted">
                    <span className="font-semibold text-secondary">
                      {names.get(message.senderId)}
                    </span>{" "}
                    · {message.createdAt.slice(0, 16).replace("T", " ")}
                  </p>
                  <p className="mt-1 break-words whitespace-pre-wrap text-body">
                    {message.body}
                  </p>
                  {message.attachments.map((file) => (
                    <p key={file.fileId} className="mt-1 text-xs">
                      {file.url ? (
                        <a href={file.url} className="text-accent underline">
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
        </Panel>
      </TabBody>
    </div>
  );
}
