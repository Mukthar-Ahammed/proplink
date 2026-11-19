import Link from "next/link";

import { PortalSection } from "@/components/portal/PortalShell";
import { Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { listMarketplace } from "@/services/landlord/marketplace";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Agent — Landlord listings",
  robots: { index: false },
};

const INPUT =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body focus:border-accent focus:outline-none";
const OUTCOME: Record<string, string> = {
  REFURBISHMENT: "Refurbishment",
  DEVELOPMENT_JV: "Development joint venture",
};
const PROPOSAL: Record<string, string> = {
  SUBMITTED: "Proposal sent",
  WITHDRAWN: "Proposal withdrawn",
  DECLINED: "Declined by the Landlord",
  SELECTED: "Selected",
};

/**
 * Private Landlord listings for verified Agents (Phase 2 Task 5, ADR-038;
 * TRD AG-1, LL-3). Approved listings only; never public, never indexed.
 */
export default async function AgentMarketplacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePageRole(Role.AGENT);
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return typeof value === "string" && value.trim() ? value : undefined;
  };
  const result = await listMarketplace(
    {
      profileId: session.user.authUserId,
      legacyUserId: session.user.id,
      role: session.user.role,
    },
    {
      location: one("location"),
      kind: one("kind"),
      work: one("work"),
      outcome: one("outcome"),
    },
  );

  if (!result.ok) {
    return (
      <PortalSection title="Landlord listings">
        <p className="text-sm text-body">{result.error}</p>
        <Link
          href="/agent/company"
          className="mt-3 inline-block text-sm font-semibold text-primary underline"
        >
          Check your company
        </Link>
      </PortalSection>
    );
  }

  return (
    <>
      <PortalSection title="Landlord listings">
        <p className="text-sm text-muted">
          Private properties whose owners want an agent. Approved by PropLink; visible
          only to verified agents. Send one proposal per property; the landlord compares
          proposals and chooses.
        </p>
        <form method="get" className="mt-6 grid gap-3 sm:grid-cols-5" role="search">
          <label className="text-sm font-medium text-primary sm:col-span-2">
            Town or postcode
            <input
              name="location"
              defaultValue={result.filters.location ?? ""}
              maxLength={60}
              className={INPUT}
            />
          </label>
          <label className="text-sm font-medium text-primary">
            Type
            <select
              name="kind"
              defaultValue={result.filters.kind ?? ""}
              className={INPUT}
            >
              <option value="">Any</option>
              <option value="PROPERTY">Property</option>
              <option value="LAND">Land</option>
            </select>
          </label>
          <label className="text-sm font-medium text-primary">
            Work required
            <input
              name="work"
              defaultValue={result.filters.work ?? ""}
              maxLength={60}
              placeholder="e.g. roof"
              className={INPUT}
            />
          </label>
          <label className="text-sm font-medium text-primary">
            Outcome
            <select
              name="outcome"
              defaultValue={result.filters.outcome ?? ""}
              className={INPUT}
            >
              <option value="">Any</option>
              <option value="REFURBISHMENT">Refurbishment</option>
              <option value="DEVELOPMENT_JV">Development JV</option>
            </select>
          </label>
          <div className="flex gap-3 sm:col-span-5">
            <button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white">
              Filter
            </button>
            <Link
              href="/agent/marketplace"
              className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-primary"
            >
              Clear
            </Link>
          </div>
        </form>
      </PortalSection>

      <PortalSection
        title={`${result.data.length} ${result.data.length === 1 ? "property" : "properties"}`}
      >
        {result.data.length === 0 ? (
          <p className="text-sm text-muted">
            No approved listings match. Try fewer filters.
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {result.data.map((listing) => (
              <li
                key={listing.id}
                className="rounded-lg border border-line bg-white p-4"
                data-testid={`market-card-${listing.id}`}
              >
                <Link
                  href={`/agent/marketplace/${listing.id}`}
                  className="text-base font-semibold text-primary underline-offset-2 hover:underline"
                >
                  {listing.title}
                </Link>
                <p className="mt-1 text-sm text-muted">
                  {[listing.city, listing.district].filter(Boolean).join(" · ") ||
                    "Location on request"}
                  {" · "}
                  {listing.propertyKind === "LAND"
                    ? "Land"
                    : (listing.propertyType ?? "Property")}
                  {listing.desiredOutcome && ` · ${OUTCOME[listing.desiredOutcome]}`}
                </p>
                {listing.workSummary && (
                  <p className="mt-2 line-clamp-2 text-sm text-body">
                    {listing.workSummary}
                  </p>
                )}
                <p className="mt-2 text-xs text-muted">
                  {listing.photoCount} {listing.photoCount === 1 ? "photo" : "photos"}
                  {listing.myProposal && (
                    <span className="ml-2 font-semibold text-primary">
                      {PROPOSAL[listing.myProposal]}
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </PortalSection>
    </>
  );
}
