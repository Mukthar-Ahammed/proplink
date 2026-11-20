import { SubscriptionBanner } from "@/components/billing/SubscriptionGate";
import { AdSlot } from "@/components/ads/AdSlot";
import Link from "next/link";
import { requirePageRole } from "@/lib/authz";
import { getAgentDashboard } from "@/services/agents/agentDashboard";
import { PortalAnnouncements } from "@/components/portal/Announcements";
import { Panel } from "@/components/portal/Detail";
import { listActiveAnnouncements } from "@/services/announcements/announcements";
import { getOwnCompanyCheck } from "@/services/agents/companyCheck";
import { getAgentAccessState } from "@/services/agents/agentMigration";
import {
  AlertIcon,
  ArrowIcon,
  ArrowLink,
  ChartIcon,
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
 * The agent portal's front door (ADR-016), laid out per ADR-080: what needs
 * the agent first, then the figures, then the work grouped by who it is for
 * (landlords, buyers, investors).
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
  const hasAttention = Boolean(migrationPrompt || companyPrompt || data.newLeads > 0);
  const brandNew =
    data.recentLeads.length === 0 && data.liveListings === 0 && data.draftListings === 0;

  return (
    <div className="space-y-10">
      <PortalAnnouncements items={announcements} />
      <SubscriptionBanner />

      {/* ------------------------------------------- needs your attention */}
      {hasAttention && (
        <section aria-labelledby="attention-heading">
          <h2 id="attention-heading" className="sr-only">
            Next steps
          </h2>
          <Panel
            title="Needs your attention"
            description="Things waiting on you, most important first."
            tone="attention"
          >
            <ul className="divide-y divide-warning/20">
              {migrationPrompt && (
                <AttentionItem
                  testId="migration-prompt"
                  title="Account confirmation"
                  text={migrationPrompt}
                  href={
                    access.kind === "needs_confirmation" ? "/agent/confirm" : undefined
                  }
                  cta="Confirm account"
                />
              )}
              {companyPrompt && (
                <AttentionItem
                  testId="company-check-prompt"
                  title="Company check"
                  text={companyPrompt}
                  href="/agent/company"
                  cta="Company check"
                />
              )}
              {data.newLeads > 0 && (
                <AttentionItem
                  testId="new-leads-prompt"
                  title={`${data.newLeads} new ${data.newLeads === 1 ? "enquiry" : "enquiries"}`}
                  text="Buyers have contacted you about a live listing and nobody has replied yet."
                  href="/agent/leads"
                  cta="Open leads"
                />
              )}
            </ul>
          </Panel>
        </section>
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

      {brandNew && (
        <InvestorEmpty
          title="Start with your first listing"
          action={<PrimaryLink href="/agent/listings/new">Create a listing</PrimaryLink>}
        >
          Listings go to PropLink moderation before buyers see them. Drafts save as you
          go.
        </InvestorEmpty>
      )}

      {/* ---------------------------------------------- leads + record */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel
          title="Latest leads"
          description="Buyer enquiries on your live listings."
          action={<ArrowLink href="/agent/leads">View all</ArrowLink>}
        >
          {data.recentLeads.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line bg-surface/60 px-5 py-8 text-center text-sm text-muted">
              No enquiries yet. Leads appear here the moment a buyer contacts you about a
              live listing.
            </p>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {data.recentLeads.map((lead) => (
                <li
                  key={lead.id}
                  className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3.5"
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
        </Panel>

        <section className="relative isolate overflow-hidden rounded-2xl border border-accent/20 bg-pale/70 p-5 sm:p-6">
          <div
            aria-hidden
            className="absolute -top-16 -right-16 -z-10 h-48 w-48 rounded-full bg-intel/15 blur-3xl"
          />
          <div className="flex items-center gap-3">
            <IconChip>
              <ShieldIcon />
            </IconChip>
            <h3 className="font-semibold text-primary">Verified record</h3>
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

      {/* ------------------------------------------------ work by audience */}
      <section className="space-y-5">
        <InvestorSectionTitle
          title="Your"
          tail="work"
          description="Everything you do on PropLink, grouped by who it is for."
        />
        <div className="grid gap-6 md:grid-cols-2">
          <WorkPanel
            icon={<HomeIcon />}
            title="Landlords"
            description="Private landlord stock: find a property, propose, then manage the mandate."
            links={[
              {
                href: "/agent/marketplace",
                label: "Landlord listings",
                hint: "Approved properties, visible only to verified agents",
              },
              {
                href: "/agent/mandates",
                label: "Your mandates",
                hint: "Properties you are instructed on, and what each needs next",
              },
            ]}
          />
          <WorkPanel
            icon={<UserIcon />}
            title="Buyers"
            description="Public listings, the enquiries they bring in and the offers made."
            links={[
              {
                href: "/agent/listings",
                label: "Your listings",
                hint: `${data.liveListings} live · ${data.draftListings} draft`,
              },
              { href: "/agent/leads", label: "Leads", hint: "Buyer enquiries" },
              { href: "/agent/offers", label: "Offers", hint: "Offers on your listings" },
            ]}
          />
          <WorkPanel
            icon={<ChartIcon />}
            title="Investors"
            description="Projects you open to verified investors, and how funding is going."
            links={[
              {
                href: "/agent/projects",
                label: "Investor projects",
                hint: "Funding, Lead Investor and works",
              },
            ]}
          />
          <WorkPanel
            icon={<FileIcon />}
            title="Your business"
            description="How PropLink and your clients see you, and your subscription."
            links={[
              {
                href: "/agent/profile",
                label: "Public profile",
                hint: "Your agency page and verified record",
              },
              {
                href: "/agent/company",
                label: "Company check",
                hint: "Your Companies House record",
              },
              { href: "/account/billing", label: "Billing", hint: "Your subscription" },
            ]}
          />
        </div>
      </section>

      {/* Phase 6 (ADR-060): one designated sponsored slot; nothing renders without a live ad. */}
      <AdSlot slot="AGENT_DASHBOARD" />
    </div>
  );
}

function humanise(value: string) {
  const text = value.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function AttentionItem({
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
    <li
      role="status"
      data-testid={testId}
      className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
        <div>
          <p className="font-semibold text-primary">{title}</p>
          <p className="mt-0.5 text-sm leading-relaxed text-body">{text}</p>
        </div>
      </div>
      {href && (
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-strong sm:self-auto"
        >
          {cta}
          <ArrowIcon className="h-4 w-4" />
        </Link>
      )}
    </li>
  );
}

function WorkPanel({
  icon,
  title,
  description,
  links,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  links: { href: string; label: string; hint?: string }[];
}) {
  return (
    <section className="flex flex-col rounded-2xl border border-line bg-white p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <IconChip>{icon}</IconChip>
        <h3 className="font-semibold text-primary">{title}</h3>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted">{description}</p>
      <ul className="mt-4 divide-y divide-line border-t border-line">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="group flex items-center justify-between gap-3 py-3"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-primary group-hover:text-accent">
                  {link.label}
                </span>
                {link.hint ? (
                  <span className="block text-xs text-muted">{link.hint}</span>
                ) : null}
              </span>
              <ArrowIcon className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
