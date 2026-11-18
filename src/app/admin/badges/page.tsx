import { Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { listBadgeQueue } from "@/services/profiles/badges";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { VerifiedBadge } from "@/components/profiles/VerifiedBadge";

import { AwardForm, RevokeForm } from "./BadgeForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — Verified badges | PropLink" };

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 16).replace("T", " ");
}

const BASIS: Record<string, string> = {
  kyc: "KYC approved",
  company: "Company check passed",
};

/**
 * Verified badges / blue tick (Phase 1 Task 7, ADR-027). Suggested once an
 * account's verification passes; awarded and revoked by Admin only.
 */
export default async function AdminBadgesPage() {
  await requirePageRole(Role.ADMIN);
  const { suggested, awarded } = await listBadgeQueue();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Verified badges"
        description="The blue tick appears on profiles and listings. Accounts are suggested once their KYC (Landlords, Investors) or company check (Agents) has passed. Every award and revocation is logged."
      />

      <Card>
        <CardTitle>Suggested ({suggested.length})</CardTitle>
        <CardBody>
          {suggested.length === 0 ? (
            <p className="text-sm text-muted">
              No verified accounts are waiting for a badge.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {suggested.map((row) => (
                <li
                  key={row.profileId}
                  className="grid gap-3 py-4 sm:grid-cols-[1fr_minmax(220px,320px)]"
                  data-testid={`badge-suggested-${row.profileId}`}
                >
                  <div>
                    <p className="font-semibold text-primary">{row.name}</p>
                    <p className="text-xs break-all text-muted">
                      {row.role}
                      {row.email ? ` · ${row.email}` : ""}
                    </p>
                    {row.eligibility.eligible && (
                      <p className="mt-1 text-xs text-success">
                        {BASIS[row.eligibility.basis]}
                      </p>
                    )}
                  </div>
                  <AwardForm profileId={row.profileId} name={row.name} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardTitle>Awarded ({awarded.length})</CardTitle>
        <CardBody>
          {awarded.length === 0 ? (
            <p className="text-sm text-muted">No badges awarded yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {awarded.map((row) => (
                <li
                  key={row.profileId}
                  className="grid gap-3 py-4 sm:grid-cols-[1fr_minmax(220px,320px)]"
                  data-testid={`badge-awarded-${row.profileId}`}
                >
                  <div>
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-primary">
                      {row.name} <VerifiedBadge />
                    </p>
                    <p className="text-xs break-all text-muted">
                      {row.role}
                      {row.email ? ` · ${row.email}` : ""}
                    </p>
                    {row.badge && (
                      <p className="mt-1 text-xs text-muted">
                        Awarded {formatDate(row.badge.awardedAt)} UTC
                        {row.badge.note ? ` · “${row.badge.note}”` : ""}
                      </p>
                    )}
                    {!row.eligibility.eligible && (
                      <p className="mt-1 text-xs text-warning">
                        Verification no longer passes: {row.eligibility.reason}
                      </p>
                    )}
                  </div>
                  <RevokeForm profileId={row.profileId} name={row.name} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
