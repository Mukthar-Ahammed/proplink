import Form from "next/form";
import { SubmitButton } from "@/components/ui/submit-button";
import Link from "next/link";

import {
  AlertIcon,
  ArrowIcon,
  HomeIcon,
  IconChip,
  InvestorEmpty,
  InvestorSectionTitle,
  SearchIcon,
  StatusPill,
} from "@/components/investor/InvestorUi";
import { Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { BUTTON, INPUT, LABEL, SECONDARY } from "@/app/landlord/listings/ui";
import { listMarketplace } from "@/services/landlord/marketplace";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Agent — Landlord listings",
  robots: { index: false },
};

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
const PROPOSAL_TONE: Record<string, "accent" | "neutral" | "success"> = {
  SUBMITTED: "accent",
  WITHDRAWN: "neutral",
  DECLINED: "neutral",
  SELECTED: "success",
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
      <section className="space-y-5">
        <InvestorSectionTitle title="Landlord" tail="listings" />
        <div className="flex items-start gap-3 rounded-3xl border border-warning/25 bg-warning/5 p-5 sm:p-6">
          <IconChip tone="warning">
            <AlertIcon />
          </IconChip>
          <div className="min-w-0">
            <p className="text-sm leading-relaxed text-body">{result.error}</p>
            <Link
              href="/agent/company"
              className="group mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:text-accent-strong"
            >
              Check your company
              <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const count = result.data.length;

  return (
    <div className="space-y-12">
      <section className="space-y-5">
        <InvestorSectionTitle
          title="Landlord"
          tail="listings"
          description="Private properties whose owners want an agent. Approved by PropLink; visible only to verified agents. Send one proposal per property; the landlord compares proposals and chooses."
        />
        <Form
          action=""
          className="grid gap-4 rounded-3xl border border-line bg-white p-6 shadow-sm sm:grid-cols-2 sm:p-7 lg:grid-cols-5"
          role="search"
        >
          <label className={`${LABEL} space-y-1.5 sm:col-span-2`}>
            <span className="block">Town or postcode</span>
            <input
              name="location"
              defaultValue={result.filters.location ?? ""}
              maxLength={60}
              className={INPUT}
            />
          </label>
          <label className={`${LABEL} space-y-1.5`}>
            <span className="block">Type</span>
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
          <label className={`${LABEL} space-y-1.5`}>
            <span className="block">Work required</span>
            <input
              name="work"
              defaultValue={result.filters.work ?? ""}
              maxLength={60}
              placeholder="e.g. roof"
              className={INPUT}
            />
          </label>
          <label className={`${LABEL} space-y-1.5 sm:col-span-2 lg:col-span-1`}>
            <span className="block">Outcome</span>
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
          <div className="flex flex-wrap gap-3 border-t border-line pt-4 sm:col-span-2 lg:col-span-5">
            <SubmitButton className={BUTTON}>
              <SearchIcon className="h-4 w-4" />
              Filter
            </SubmitButton>
            <Link href="/agent/marketplace" className={SECONDARY}>
              Clear
            </Link>
          </div>
        </Form>
      </section>

      <section className="space-y-5">
        <InvestorSectionTitle
          title={`${count}`}
          tail={count === 1 ? "property" : "properties"}
        />
        {count === 0 ? (
          <InvestorEmpty title="No approved listings match">
            Try fewer filters.
          </InvestorEmpty>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {result.data.map((listing) => (
              <li
                key={listing.id}
                className="group relative flex h-full flex-col rounded-2xl border border-line bg-white p-5 transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md sm:p-6"
                data-testid={`market-card-${listing.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <IconChip>
                      <HomeIcon />
                    </IconChip>
                    <div className="min-w-0">
                      {/* The link's ::after covers the card, so the whole card is clickable. */}
                      <Link
                        href={`/agent/marketplace/${listing.id}`}
                        className="font-semibold text-primary after:absolute after:inset-0 after:rounded-2xl focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent"
                      >
                        {listing.title}
                      </Link>
                      <p className="mt-0.5 text-sm text-muted">
                        {[listing.city, listing.district].filter(Boolean).join(" · ") ||
                          "Location on request"}
                        {" · "}
                        {listing.propertyKind === "LAND"
                          ? "Land"
                          : (listing.propertyType ?? "Property")}
                        {listing.desiredOutcome &&
                          ` · ${OUTCOME[listing.desiredOutcome]}`}
                      </p>
                    </div>
                  </div>
                  {listing.myProposal && (
                    <StatusPill tone={PROPOSAL_TONE[listing.myProposal] ?? "neutral"}>
                      {PROPOSAL[listing.myProposal]}
                    </StatusPill>
                  )}
                </div>
                {listing.workSummary && (
                  <p className="mt-4 line-clamp-2 text-sm leading-relaxed text-body">
                    {listing.workSummary}
                  </p>
                )}
                <div className="mt-auto pt-5">
                  <div className="flex items-center justify-between border-t border-line pt-4 text-xs text-muted">
                    <span>
                      {listing.photoCount} {listing.photoCount === 1 ? "photo" : "photos"}
                    </span>
                    <span className="inline-flex items-center gap-1 font-semibold text-accent">
                      Open
                      <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
