import Link from "next/link";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { KeyFacts, Panel } from "@/components/portal/Detail";
import { requirePageRole } from "@/lib/authz";
import { mayOpenAdminPath } from "@/lib/authz/adminRoutes";
import { adminPermissionsOf } from "@/services/admin/permissions";
import { getAttentionItems, getDashboardKpis } from "@/services/admin/dashboardService";
import type { AttentionItem } from "@/services/admin/dashboardService";

export const metadata = { title: "Admin — Operations Dashboard | PropLink" };

/**
 * The Admin overview (ADR-080): what needs a decision first, then the
 * headline figures, then every Admin area grouped by the job it serves.
 * Links the Admin lacks the permission for are hidden; each page still
 * checks on the server (ADR-058).
 */

const KIND_LABEL: Record<AttentionItem["kind"], string> = {
  KYC_SUBMITTED: "KYC",
  LISTING_PENDING: "Listing",
  RESALE_SUBMITTED: "Resale",
};

type Area = { href: string; label: string; description: string };

const AREAS: { title: string; description: string; links: Area[] }[] = [
  {
    title: "People",
    description: "Accounts, agents and who can do what in Admin.",
    links: [
      { href: "/admin/users", label: "Users", description: "Every account, any role" },
      {
        href: "/admin/agents",
        label: "Agents",
        description: "Agent profiles and status",
      },
      {
        href: "/admin/agents/agencies",
        label: "Agencies",
        description: "Agency profiles",
      },
      {
        href: "/admin/agents/invites",
        label: "Agent invites",
        description: "Invite agents to join",
      },
      {
        href: "/admin/agents/companies",
        label: "Company checks",
        description: "Companies House checks",
      },
      {
        href: "/admin/agents/migration",
        label: "Existing agents",
        description: "Move agents onto PropLink",
      },
      {
        href: "/admin/badges",
        label: "Verified badges",
        description: "Grant or remove badges",
      },
      {
        href: "/admin/roles",
        label: "Admin roles",
        description: "Admin permissions",
      },
    ],
  },
  {
    title: "Listings & projects",
    description: "Properties coming in and the projects built on them.",
    links: [
      {
        href: "/admin/landlord-listings",
        label: "Landlord listings",
        description: "Private listings from landlords",
      },
      {
        href: "/admin/moderation",
        label: "Listing moderation",
        description: "Approve agent listings",
      },
      {
        href: "/admin/resales",
        label: "Flipper resales",
        description: "Resales onto the marketplace",
      },
      {
        href: "/admin/projects",
        label: "Investor projects",
        description: "Leads, pledges, progress",
      },
      {
        href: "/admin/chats",
        label: "Chats",
        description: "Authorise and review chats",
      },
    ],
  },
  {
    title: "Money",
    description: "Subscriptions only: no investment money moves through PropLink.",
    links: [
      {
        href: "/admin/billing",
        label: "Subscriptions",
        description: "Plans and prices",
      },
      {
        href: "/admin/fees",
        label: "Fee rules",
        description: "What PropLink charges for",
      },
    ],
  },
  {
    title: "Trust & safety",
    description: "Identity checks, reviews, complaints and data requests.",
    links: [
      {
        href: "/admin/kyc",
        label: "KYC checks",
        description: "Investor identity checks",
      },
      { href: "/admin/reviews", label: "Reviews", description: "Moderate reviews" },
      { href: "/admin/cases", label: "Cases", description: "Complaints and disputes" },
      {
        href: "/admin/privacy",
        label: "Data requests",
        description: "Access and erasure requests",
      },
    ],
  },
  {
    title: "Platform",
    description: "Messages to users, advertising, settings and system health.",
    links: [
      {
        href: "/admin/announcements",
        label: "Announcements",
        description: "Notices in the portals",
      },
      { href: "/admin/ads", label: "Advertising", description: "Sponsored placements" },
      { href: "/admin/system", label: "KPIs", description: "Platform figures" },
      {
        href: "/admin/system/integrations",
        label: "Integrations",
        description: "Providers and keys",
      },
      {
        href: "/admin/system/security",
        label: "Security events",
        description: "Sign-ins and alerts",
      },
      {
        href: "/admin/settings/uploads",
        label: "Upload limits",
        description: "File sizes and types",
      },
      {
        href: "/admin/settings/track-record",
        label: "Track record",
        description: "Public track record",
      },
    ],
  },
];

function formatAge(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function QueueTile({
  label,
  count,
  description,
  href,
}: {
  label: string;
  count: number;
  description: string;
  href: string;
}) {
  const waiting = count > 0;
  return (
    <Link
      href={href}
      className={`group flex flex-col rounded-xl border p-4 transition-colors ${
        waiting
          ? "border-warning/40 bg-white hover:border-warning"
          : "border-line bg-white hover:border-accent/40"
      }`}
    >
      <span className="text-sm font-medium text-muted">{label}</span>
      <span
        className={`mt-1 text-3xl font-semibold tabular-nums ${waiting ? "text-warning" : "text-success"}`}
      >
        {count}
      </span>
      <span className="mt-1 text-xs text-muted">{description}</span>
      <span className="mt-3 text-xs font-semibold text-accent group-hover:underline">
        {waiting ? "Review now →" : "Open queue →"}
      </span>
    </Link>
  );
}

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ denied?: string }>;
}) {
  // Any Admin may open the overview; each area checks its own permission (ADR-058).
  const session = await requirePageRole("ADMIN");
  const denied = (await searchParams)?.denied;
  const deniedNotice =
    denied && /^[A-Z_]{3,40}$/.test(denied) ? (
      <p
        role="alert"
        data-testid="permission-denied"
        className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
      >
        Your Admin account does not have the {denied.replaceAll("_", " ").toLowerCase()}{" "}
        permission. Ask a super-admin.
      </p>
    ) : null;

  let kpis: Awaited<ReturnType<typeof getDashboardKpis>>;
  let attentionItems: Awaited<ReturnType<typeof getAttentionItems>>;
  let permissions: string[];

  try {
    [kpis, attentionItems, permissions] = await Promise.all([
      getDashboardKpis(),
      getAttentionItems(),
      adminPermissionsOf(session.user.authUserId).then((set) => [...set]),
    ]);
  } catch {
    return (
      <div className="space-y-8">
        <AdminPageHeader
          title="Operations Dashboard"
          description="Live view of all queues requiring Admin attention across PropLink."
        />
        {deniedNotice}
        <Panel title="Dashboard data unavailable" tone="attention">
          <p className="text-sm text-muted">
            Could not load queue metrics. The database may be temporarily unreachable.
            Retry shortly or open a queue from the menu.
          </p>
        </Panel>
      </div>
    );
  }

  const may = (href: string) => mayOpenAdminPath(permissions, href);
  const totalPending = kpis.pendingKyc + kpis.pendingModeration + kpis.pendingResales;
  const queues = [
    {
      label: "KYC checks",
      count: kpis.pendingKyc,
      description: "Investor identity checks awaiting a decision",
      href: "/admin/kyc",
    },
    {
      label: "Listing moderation",
      count: kpis.pendingModeration,
      description: "Agent listings waiting for approval",
      href: "/admin/moderation",
    },
    {
      label: "Flipper resales",
      count: kpis.pendingResales,
      description: "Resales waiting to go on the marketplace",
      href: "/admin/resales",
    },
  ].filter((queue) => may(queue.href));
  const areas = AREAS.map((area) => ({
    ...area,
    links: area.links.filter((link) => may(link.href)),
  })).filter((area) => area.links.length > 0);

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Operations Dashboard"
        description="What needs a decision, the headline figures, and every Admin area in one place."
        badge={
          totalPending > 0
            ? { label: `${totalPending} pending`, tone: "danger" }
            : { label: "All clear", tone: "success" }
        }
      />
      {deniedNotice}

      <section aria-labelledby="attention-heading" className="space-y-4">
        <h2 id="attention-heading" className="text-lg font-semibold text-primary">
          {totalPending > 0 ? "Needs your attention" : "Review queues"}
        </h2>
        {queues.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-3">
            {queues.map((queue) => (
              <QueueTile key={queue.href} {...queue} />
            ))}
          </div>
        )}
        <Panel
          title="Oldest items first"
          description={
            attentionItems.length > 0
              ? `${attentionItems.length} item${attentionItems.length === 1 ? "" : "s"} waiting. Open one to decide.`
              : undefined
          }
          tone={attentionItems.length > 0 ? "attention" : "default"}
        >
          {attentionItems.length === 0 ? (
            <p className="text-sm text-muted">
              All queues are clear: no KYC checks, listing reviews or resale approvals
              waiting.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {attentionItems.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="group flex items-center gap-4 py-3 transition-colors"
                  >
                    <span className="w-16 shrink-0 rounded-full bg-white px-2 py-0.5 text-center text-xs font-semibold text-secondary ring-1 ring-line">
                      {KIND_LABEL[item.kind]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-primary group-hover:text-accent">
                        {item.title}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {item.subtitle}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted tabular-nums">
                      {formatAge(item.at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <section aria-labelledby="figures-heading">
        <h2 id="figures-heading" className="text-lg font-semibold text-primary">
          Marketplace at a glance
        </h2>
        <KeyFacts
          className="mt-4"
          items={[
            {
              label: "Registered users",
              value: kpis.totalUsers.toLocaleString("en-GB"),
              hint: "All roles, active and inactive",
            },
            {
              label: "Live listings",
              value: kpis.liveListings.toLocaleString("en-GB"),
              hint: "On the public marketplace",
            },
            {
              label: "Waiting for a decision",
              value: totalPending.toLocaleString("en-GB"),
              hint: "KYC, moderation and resales",
            },
          ]}
        />
      </section>

      <section aria-labelledby="areas-heading">
        <h2 id="areas-heading" className="text-lg font-semibold text-primary">
          Admin areas
        </h2>
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          {areas.map((area) => (
            <Panel key={area.title} title={area.title} description={area.description}>
              <ul className="grid gap-2 sm:grid-cols-2">
                {area.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="group block rounded-lg border border-line px-3 py-2.5 transition-colors hover:border-accent/40 hover:bg-surface"
                    >
                      <span className="block text-sm font-semibold text-primary group-hover:text-accent">
                        {link.label} →
                      </span>
                      <span className="block text-xs text-muted">{link.description}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      </section>
    </div>
  );
}
