import Link from "next/link";

import {
  ArrowIcon,
  ArrowLink,
  FileIcon,
  IconChip,
  InvestorEmpty,
  InvestorSectionTitle,
  StatusPill,
} from "@/components/investor/InvestorUi";
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
const STATUS_TONE: Record<string, "accent" | "success" | "warning" | "neutral"> = {
  OFFERED: "warning",
  ACTIVE: "success",
};
const CHIP_TONE: Record<string, "accent" | "success" | "warning"> = {
  OFFERED: "warning",
  ACTIVE: "success",
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
    <section className="space-y-5">
      <InvestorSectionTitle
        title="Mandates"
        description="Exclusive mandates landlords have offered you, and the ones you hold."
      />
      {mandates.length === 0 ? (
        <InvestorEmpty
          title="No mandates yet"
          action={
            <ArrowLink href="/agent/marketplace">Browse landlord listings</ArrowLink>
          }
        >
          When a landlord chooses your proposal, the offer appears here.
        </InvestorEmpty>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-white shadow-sm">
          {mandates.map((mandate) => (
            <li
              key={mandate.id}
              className="group relative flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4 transition-colors hover:bg-surface/60 sm:px-6"
            >
              <div className="flex min-w-0 items-center gap-3">
                <IconChip tone={CHIP_TONE[mandate.status] ?? "accent"}>
                  <FileIcon />
                </IconChip>
                <div className="min-w-0">
                  {/* The link's ::after covers the row, so the whole row is clickable. */}
                  <Link
                    href={`/agent/mandates/${mandate.id}`}
                    className="font-semibold text-primary after:absolute after:inset-0 focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent focus-visible:after:ring-inset"
                  >
                    {mandate.listing.title}
                  </Link>
                  <p className="mt-0.5 text-sm text-muted">
                    {mandate.listing.city ? `${mandate.listing.city} · ` : ""}offered{" "}
                    {day(mandate.offeredAt)}
                    {mandate.status === "ACTIVE" &&
                      ` · contract ends ${day(mandate.endsAt)}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <StatusPill tone={STATUS_TONE[mandate.status] ?? "neutral"}>
                  {STATUS[mandate.status]}
                </StatusPill>
                <ArrowIcon className="h-4 w-4 text-accent transition-transform group-hover:translate-x-0.5" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
