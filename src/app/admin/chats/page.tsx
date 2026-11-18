import Link from "next/link";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { listOpenReports } from "@/services/chat/messages";
import { listPendingThreads } from "@/services/chat/threads";

import { PendingQueue, ResolveForm, RevokeForm } from "./ChatAdminForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — Chats | PropLink" };

const PAIR: Record<string, string> = {
  LANDLORD_AGENT: "Landlord ↔ Agent",
  AGENT_INVESTOR: "Agent ↔ Investor",
  LEAD_CO_INVESTOR: "Lead ↔ Co-Investor",
  BUYER_AGENT: "Buyer ↔ Agent",
};

/**
 * Chat authorisation queue and reported chats (Phase 3 Tasks 2, 3 and 8;
 * ADR-043). Every decision and every Admin read is audited.
 */
export default async function AdminChatsPage() {
  await requirePageRole(Role.ADMIN);
  const [pending, reports] = await Promise.all([listPendingThreads(), listOpenReports()]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Chats"
        description="A chat opens only when PropLink authorises it and both sides who must pay have an active subscription. Buyer enquiries open without authorisation."
        badge={
          pending.length > 0
            ? { label: `${pending.length} waiting`, tone: "warning" }
            : { label: "Queue clear", tone: "success" }
        }
      />
      <Card>
        <CardTitle>Waiting for authorisation</CardTitle>
        <CardBody>
          {pending.length === 0 ? (
            <p className="text-sm text-muted">Nothing waiting.</p>
          ) : (
            <PendingQueue
              rows={pending.map((thread) => ({
                id: thread.id,
                title: thread.title,
                pair: PAIR[thread.pairType],
                a: thread.a.name ?? thread.a.role,
                b: thread.b.name ?? thread.b.role,
                waitingSince: thread.createdAt
                  .toISOString()
                  .slice(0, 16)
                  .replace("T", " "),
              }))}
            />
          )}
        </CardBody>
      </Card>
      <Card>
        <CardTitle>Reported chats</CardTitle>
        <CardBody>
          {reports.length === 0 ? (
            <p className="text-sm text-muted">No open reports.</p>
          ) : (
            <ul className="space-y-4">
              {reports.map((report) => (
                <li
                  key={report.id}
                  className="space-y-2 rounded-lg border border-line bg-white p-3 text-sm"
                >
                  <p className="text-body">
                    <strong>{report.reporter.name ?? report.reporter.role}</strong>{" "}
                    reported a {PAIR[report.thread.pairType]} chat on{" "}
                    {report.createdAt.toISOString().slice(0, 10)}: “{report.reason}”
                  </p>
                  <Link
                    href={`/admin/chats/${report.thread.id}`}
                    className="font-semibold text-primary underline"
                  >
                    Read the chat (your access is logged)
                  </Link>
                  <ResolveForm reportId={report.id} />
                  {report.thread.status !== "CLOSED" && (
                    <RevokeForm threadId={report.thread.id} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
