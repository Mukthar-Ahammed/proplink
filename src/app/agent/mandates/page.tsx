import Link from "next/link";

import { PortalSection } from "@/components/portal/PortalShell";
import { Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { listAgentMandates } from "@/services/landlord/mandates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent — Mandates", robots: { index: false } };

const STATUS: Record<string, string> = {
  OFFERED: "Offered to you: accept or decline",
  ACTIVE: "Active",
  DECLINED: "You declined",
  WITHDRAWN: "Offer withdrawn by the landlord",
  TERMINATED: "Terminated",
  CLOSED: "Closed",
};
const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : "—");

/** Exclusive mandates offered to or held by this Agent (Phase 2 Task 6, ADR-039). */
export default async function AgentMandatesPage() {
  const session = await requirePageRole(Role.AGENT);
  const mandates = await listAgentMandates({
    profileId: session.user.authUserId,
    legacyUserId: session.user.id,
    role: session.user.role,
  });
  return (
    <PortalSection title="Mandates">
      {mandates.length === 0 ? (
        <p className="text-sm text-muted">
          No mandates yet. When a landlord chooses your proposal, the offer appears here.
        </p>
      ) : (
        <ul className="space-y-3">
          {mandates.map((mandate) => (
            <li key={mandate.id} className="rounded-lg border border-line bg-white p-4">
              <Link
                href={`/agent/mandates/${mandate.id}`}
                className="font-semibold text-primary underline-offset-2 hover:underline"
              >
                {mandate.listing.title}
              </Link>
              <p className="text-sm text-muted">
                {mandate.listing.city ?? ""} · {STATUS[mandate.status]} · offered{" "}
                {day(mandate.offeredAt)}
                {mandate.status === "ACTIVE" && ` · contract ends ${day(mandate.endsAt)}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </PortalSection>
  );
}
