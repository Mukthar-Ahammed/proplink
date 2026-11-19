import { SubscriptionBanner } from "@/components/billing/SubscriptionGate";
import { AdSlot } from "@/components/ads/AdSlot";
import Link from "next/link";
import { requirePageRole } from "@/lib/authz";
import { getAgentDashboard } from "@/services/agents/agentDashboard";
import { PortalAnnouncements } from "@/components/portal/Announcements";
import { listActiveAnnouncements } from "@/services/announcements/announcements";
import { getOwnCompanyCheck } from "@/services/agents/companyCheck";
import { getAgentAccessState } from "@/services/agents/agentMigration";
import {
  AlertIcon,
  ArrowIcon,
  ArrowLink,
  ChartIcon,
  CheckIcon,
  FileIcon,
  HomeIcon,
  IconChip,
  InvestorEmpty,
  InvestorSectionTitle,
  PrimaryLink,
  ShieldIcon,
  StatStrip,
  StatusPill,
  UserIcon,
} from "@/components/investor/InvestorUi";

// Middleware-gated, always per-request — never statically prerendered.
export const dynamic = "force-dynamic";
export const metadata = { title: "Agent portal — PropLink UK" };

/**
 * The agent portal's front door (ADR-016), in the ADR-071 portal look shared
 * with the buyer, investor and landlord portals. It replaced a bare
 * `redirect("/agent/listings")`, which left the portal with no home and no
 * overview.
 *
 * `requireRole` again despite the middleware gate: the middleware reads the JWT
 * at the edge and is a routing concern, while this is the server-side check
 * AGENTS.md requires on anything that reads a user's own data.
 */
export default async function AgentHomePage() {
  const { user } = await requirePageRole("AGENT");
  const [data, announcements, company, access] = await Promise.all([
    getAgentDashboard(user.id),
    listActiveAnnouncements("AGENT"),
    getOwnCompanyCheck(user.authUserId),
    getAgentAccessState(user.authUserId),
  ]);
  const migrationPrompt =
    access.kind === "needs_confirmation"
      ? "PropLink now admits agents by invitation. Confirm your account so it can be authorised for new features."
      : access.kind === "awaiting_authorisation"
        ? "Your account is confirmed and waiting for PropLink to authorise it."
        : null;
  const companyPrompt =
    company.status === "NOT_SUBMITTED"
      ? "Check your company against the Companies House register before submitting listings."
      : company.status === "NEEDS_REVIEW" || company.status === "REJECTED_BY_ADMIN"
        ? "Your company check needs attention."
        : null;

  return (
    <div className="space-y-12">
      <PortalAnnouncements items={announcements} />
      <SubscriptionBanner />

      {(migrationPrompt || companyPrompt) && (
        <div className="space-y-4">
          {migrationPrompt && (
            <Prompt
              testId="migration-prompt"
              title="Account confirmation"
              text={migrationPrompt}
              href={access.kind === "needs_confirmation" ? "/agent/confirm" : undefined}
              cta="Confirm account"
            />
          )}
          {companyPrompt && (
            <Prompt
              testId="company-check-prompt"
              title="Company check"
              text={companyPrompt}
              href="/agent/company"
              cta="Company check"
            />
          )}
        </div>
      )}

      {/* ------------------------------------------------------- overview */}
      <section className="space-y-5">
        <InvestorSectionTitle
          title="Your"
          tail="overview"
          description="Where your stock and your enquiries stand today."
          action={<PrimaryLink href="/agent/listings/new">New listing</PrimaryLink>}
        />
        <StatStrip
          items={[
            { value: data.liveListings, label: "Live listings" },
            {
              value: data.pendingListings,
              label: "Awaiting review",
              hint: data.pendingListings > 0 ? "With the moderation queue" : undefined,
            },
            { value: data.draftListings, label: "Drafts" },
            {
              value: data.newLeads,
              label: "New leads",
              hint: data.newLeads > 0 ? "Unactioned enquiries" : undefined,
            },
          ]}
        />
      </section>

      {/* ---------------------------------------------- leads + record */}
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <section className="flex flex-col rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <IconChip>
                <UserIcon />
              </IconChip>
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
                  Enquiries
                </p>
                <h2 className="mt-0.5 font-semibold text-primary">Latest leads</h2>
              </div>
            </div>
            <ArrowLink href="/agent/leads">All leads</ArrowLink>
          </div>
          {data.recentLeads.length === 0 ? (
            <p className="mt-6 rounded-2xl border border-dashed border-line bg-surface/60 px-5 py-8 text-center text-sm text-muted">
              No enquiries yet. Leads appear here the moment a buyer contacts you about a
              live listing.
            </p>
          ) : (
            <ul className="mt-5 divide-y divide-line border-t border-line">
              {data.recentLeads.map((lead) => (
                <li
                  key={lead.id}
                  className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4"
                >
                  <Link
                    href={`/marketplace/${lead.propertyId}`}
                    className="font-medium text-primary underline decoration-line underline-offset-4 hover:decoration-accent"
                  >
                    {lead.propertyTitle}
                  </Link>
                  <StatusPill tone={lead.status === "NEW" ? "accent" : "neutral"}>
                    {humanise(lead.status)}
                  </StatusPill>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="relative isolate overflow-hidden rounded-3xl border border-accent/20 bg-pale/70 p-6 sm:p-7">
          <div
            aria-hidden
            className="absolute -top-16 -right-16 -z-10 h-48 w-48 rounded-full bg-intel/15 blur-3xl"
          />
          <div className="flex items-center gap-3">
            <IconChip>
              <ShieldIcon />
            </IconChip>
            <h2 className="font-semibold text-primary">Verified record</h2>
          </div>
          <p className="font-display mt-5 text-4xl font-semibold tracking-[-0.02em] text-primary tabular-nums">
            {data.verifiedDealCount}
          </p>
          <p className="mt-1 text-sm text-muted">
            completed {data.verifiedDealCount === 1 ? "deal" : "deals"} on PropLink
          </p>
          <p className="mt-4 text-sm leading-relaxed text-body">
            {data.verifiedDealCount === 0
              ? "No completed deals recorded yet. Deals completed on-platform are added to your public profile automatically."
              : "Recorded against your profile from deals completed on-platform."}
          </p>
          <div className="mt-5">
            <ArrowLink href="/agent/profile">Your public profile</ArrowLink>
          </div>
        </section>
      </div>

      {/* ------------------------------------------------------ shortcuts */}
      <section className="space-y-5">
        <InvestorSectionTitle title="Keep" tail="moving" />
        <div className="grid gap-4 md:grid-cols-3">
          <QuickLink
            href="/agent/marketplace"
            icon={<HomeIcon />}
            eyebrow="Private stock"
            title="Landlord listings"
            body="Approved landlord properties, visible only to verified agents. Send a proposal."
          />
          <QuickLink
            href="/agent/mandates"
            icon={<FileIcon />}
            eyebrow="Mandates"
            title="Your mandates"
            body="Properties a landlord has instructed you on, and what each one needs next."
          />
          <QuickLink
            href="/agent/projects"
            icon={<ChartIcon />}
            eyebrow="Investors"
            title="Investor projects"
            body="Projects you have published to verified investors and how funding is going."
          />
        </div>
      </section>

      {data.recentLeads.length === 0 &&
        data.liveListings === 0 &&
        data.draftListings === 0 && (
          <InvestorEmpty
            title="Start with your first listing"
            action={
              <PrimaryLink href="/agent/listings/new">Create a listing</PrimaryLink>
            }
          >
            Listings go to PropLink moderation before buyers see them. Drafts save as you
            go.
          </InvestorEmpty>
        )}

      {/* Phase 6 (ADR-060): one designated sponsored slot; nothing renders without a live ad. */}
      <AdSlot slot="AGENT_DASHBOARD" />
    </div>
  );
}

function humanise(value: string) {
  const text = value.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function Prompt({
  testId,
  title,
  text,
  href,
  cta,
}: {
  testId: string;
  title: string;
  text: string;
  href?: string;
  cta: string;
}) {
  return (
    <div
      role="status"
      data-testid={testId}
      className="flex flex-col gap-4 rounded-3xl border border-warning/30 bg-warning/5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
    >
      <div className="flex items-start gap-3">
        <IconChip tone="warning">
          <AlertIcon />
        </IconChip>
        <div>
          <p className="font-semibold text-primary">{title}</p>
          <p className="mt-1 text-sm leading-relaxed text-body">{text}</p>
        </div>
      </div>
      {href && (
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-primary transition-colors hover:border-accent hover:text-accent sm:self-auto"
        >
          {cta}
          <CheckIcon className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

function QuickLink({
  href,
  icon,
  eyebrow,
  title,
  body,
}: {
  href: string;
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-3xl border border-line bg-white p-6 transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="flex items-center justify-between">
        <IconChip>{icon}</IconChip>
        <ArrowIcon className="h-5 w-5 text-muted transition-all group-hover:translate-x-0.5 group-hover:text-accent" />
      </div>
      <p className="mt-5 text-xs font-semibold tracking-[0.14em] text-muted uppercase">
        {eyebrow}
      </p>
      <p className="mt-1 font-semibold text-primary">{title}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
    </Link>
  );
}
