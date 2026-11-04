import Link from "next/link";
import { requirePageRole } from "@/lib/authz";
import { getDashboardKpis, getAttentionItems } from "@/services/admin/dashboardService";
import type { AttentionItem } from "@/services/admin/dashboardService";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export const metadata = { title: "Admin — Operations Dashboard | PropLink" };

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  tone,
  href,
  cta,
  description,
}: {
  label: string;
  value: number;
  tone: "urgent" | "warning" | "neutral" | "positive";
  href: string;
  cta: string;
  description: string;
}) {
  const toneStyles: Record<typeof tone, { card: string; badge: string; dot: string }> = {
    urgent: {
      card: "border-danger/30 bg-danger/5",
      badge: "bg-danger text-white",
      dot: "bg-danger",
    },
    warning: {
      card: "border-warning/30 bg-warning/5",
      badge: "bg-warning text-white",
      dot: "bg-warning",
    },
    neutral: {
      card: "border-line bg-white",
      badge: "bg-secondary text-white",
      dot: "bg-secondary",
    },
    positive: {
      card: "border-success/30 bg-success/5",
      badge: "bg-success text-white",
      dot: "bg-success",
    },
  };

  const s = toneStyles[tone];

  return (
    <div className={`rounded-xl border p-5 flex flex-col gap-3 shadow-xs transition-shadow hover:shadow-sm ${s.card}`}>
      <div className="flex items-start justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
        {(tone === "urgent" || tone === "warning") && value > 0 && (
          <span className="relative flex h-2.5 w-2.5 mt-0.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${s.dot}`} />
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${s.dot}`} />
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className={`inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-2xl font-black tabular-nums leading-none ${s.badge}`}>
          {value}
        </span>
        <p className="text-[11px] text-muted leading-snug text-right max-w-[120px]">{description}</p>
      </div>
      <Link
        href={href}
        className="mt-auto inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline underline-offset-2 transition-colors"
      >
        {cta}
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
        </svg>
      </Link>
    </div>
  );
}

// ─── Attention Item Row ────────────────────────────────────────────────────────

const KIND_META: Record<
  AttentionItem["kind"],
  { label: string; icon: string; className: string }
> = {
  KYC_SUBMITTED: {
    label: "KYC",
    icon: "🪪",
    className: "bg-warning/10 text-warning border-warning/30",
  },
  LISTING_PENDING: {
    label: "Listing",
    icon: "🏠",
    className: "bg-brand/10 text-brand border-brand/30",
  },
  RESALE_SUBMITTED: {
    label: "Resale",
    icon: "🔄",
    className: "bg-accent/10 text-accent border-accent/30",
  },
};

function AttentionRow({ item, index }: { item: AttentionItem; index: number }) {
  const meta = KIND_META[item.kind];
  const age = formatAge(item.at);

  return (
    <Link
      href={item.href}
      className="group flex items-center gap-4 rounded-lg px-4 py-3 hover:bg-surface transition-colors border-b border-line last:border-0"
    >
      {/* Index */}
      <span className="w-5 shrink-0 text-center text-xs font-bold text-muted/60 tabular-nums">
        {index + 1}
      </span>

      {/* Kind pill */}
      <span
        className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${meta.className}`}
      >
        <span role="img" aria-label={meta.label}>{meta.icon}</span>
        {meta.label}
      </span>

      {/* Description */}
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-semibold text-primary group-hover:text-accent transition-colors">
          {item.title}
        </p>
        <p className="truncate text-xs text-muted">{item.subtitle}</p>
      </div>

      {/* Age */}
      <span className="shrink-0 text-[11px] font-medium text-muted/70 tabular-nums">{age}</span>

      {/* Arrow */}
      <svg
        className="shrink-0 h-4 w-4 text-muted/40 group-hover:text-accent transition-colors"
        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
      </svg>
    </Link>
  );
}

function formatAge(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(delta / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── Quick-Nav Card ───────────────────────────────────────────────────────────

function QuickNavCard({
  href,
  label,
  icon,
  description,
  status,
}: {
  href: string;
  label: string;
  icon: string;
  description: string;
  status?: "active" | "placeholder" | "soon";
}) {
  const disabled = status === "soon";

  if (disabled) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-line/50 bg-white/50 p-4 opacity-50 cursor-not-allowed select-none">
        <span className="text-xl" role="img" aria-label={label}>{icon}</span>
        <div>
          <p className="text-xs font-semibold text-primary">{label}</p>
          <p className="text-[11px] text-muted">{description}</p>
        </div>
        <span className="ml-auto shrink-0 rounded bg-surface px-1.5 py-0.5 text-[9px] font-bold uppercase text-muted tracking-wider">
          Soon
        </span>
      </div>
    );
  }

  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-lg border border-line bg-white p-4 hover:border-accent/40 hover:bg-surface transition-all shadow-xs"
    >
      <span className="text-xl" role="img" aria-label={label}>{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-primary group-hover:text-accent transition-colors">{label}</p>
        <p className="text-[11px] text-muted leading-snug">{description}</p>
      </div>
      <svg
        className="mt-0.5 shrink-0 h-3.5 w-3.5 text-muted/40 group-hover:text-accent transition-colors"
        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
      </svg>
    </Link>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted mb-3">
      {children}
    </h2>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function AdminDashboardPage() {
  await requirePageRole("ADMIN");

  let kpis: Awaited<ReturnType<typeof getDashboardKpis>>;
  let attentionItems: Awaited<ReturnType<typeof getAttentionItems>>;

  try {
    [kpis, attentionItems] = await Promise.all([
      getDashboardKpis(),
      getAttentionItems(),
    ]);
  } catch {
    return (
      <div className="space-y-8">
        <AdminPageHeader
          title="Operations Dashboard"
          description="Live view of all queues requiring Admin attention across PropLink."
        />
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-8 text-center">
          <p className="text-sm font-semibold text-danger">Dashboard data unavailable</p>
          <p className="mt-1 text-xs text-muted">
            Could not load queue metrics. The database may be temporarily unreachable. Retry shortly or navigate directly to a queue.
          </p>
        </div>
      </div>
    );
  }

  const totalPending = kpis.pendingKyc + kpis.pendingModeration + kpis.pendingResales;

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <AdminPageHeader
        title="Operations Dashboard"
        description="Live view of all queues requiring Admin attention across PropLink."
        badge={
          totalPending > 0
            ? { label: `${totalPending} pending`, tone: "danger" }
            : { label: "All clear", tone: "success" }
        }
      />

      {/* ── Section 1: Review Queues ─────────────────────────────────── */}
      <section aria-label="Review queue KPI cards">
        <SectionHeading>Requires Attention</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-3">
          <KpiCard
            label="KYC Queue"
            value={kpis.pendingKyc}
            tone={kpis.pendingKyc > 0 ? "urgent" : "positive"}
            href="/admin/kyc"
            cta="Review KYC submissions"
            description="Investor identity verifications awaiting decision"
          />
          <KpiCard
            label="Listing Moderation"
            value={kpis.pendingModeration}
            tone={kpis.pendingModeration > 0 ? "warning" : "positive"}
            href="/admin/moderation"
            cta="Review listings"
            description="Agent listings pending approval or rejection"
          />
          <KpiCard
            label="Resale Approvals"
            value={kpis.pendingResales}
            tone={kpis.pendingResales > 0 ? "warning" : "positive"}
            href="/admin/resales"
            cta="Review resale approvals"
            description="Investor flipper resales pending marketplace approval"
          />
        </div>
      </section>

      {/* ── Section 2: Marketplace Snapshot ─────────────────────────── */}
      <section aria-label="Marketplace snapshot">
        <SectionHeading>Marketplace Snapshot</SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          <KpiCard
            label="Registered Users"
            value={kpis.totalUsers}
            tone="neutral"
            href="/admin/users"
            cta="Open users directory"
            description="All active and inactive accounts across all roles"
          />
          <KpiCard
            label="Live Listings"
            value={kpis.liveListings}
            tone="neutral"
            href="/admin/moderation"
            cta="Open moderation queue"
            description="Properties with status LIVE (excludes UNDER_OFFER)"
          />
        </div>
      </section>

      {/* ── Section 3: Requires Attention Stream ─────────────────────── */}
      <section aria-label="Requires attention items">
        <div className="flex items-center justify-between mb-3">
          <SectionHeading>
            Priority Queue
            {attentionItems.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center rounded-full bg-danger px-1.5 py-0.5 text-[9px] font-black text-white leading-none">
                {attentionItems.length}
              </span>
            )}
          </SectionHeading>
        </div>

        <div className="rounded-xl border border-line bg-white shadow-xs overflow-hidden">
          {attentionItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <div className="text-4xl" role="img" aria-label="All clear">✅</div>
              <p className="text-sm font-semibold text-primary">All queues are clear</p>
              <p className="text-xs text-muted max-w-xs">
                No pending KYC submissions, listing reviews, or resale approvals at this time.
              </p>
            </div>
          ) : (
            <div>
              {attentionItems.map((item, i) => (
                <AttentionRow key={item.id} item={item} index={i} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Section 4: Quick Navigation ──────────────────────────────── */}
      <section aria-label="Quick navigation">
        <SectionHeading>Where Next</SectionHeading>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <QuickNavCard
            href="/admin/kyc"
            label="KYC Queue"
            icon="🪪"
            description="Approve or reject investor identity verifications"
            status="active"
          />
          <QuickNavCard
            href="/admin/moderation"
            label="Listing Moderation"
            icon="🏠"
            description="Approve or reject agent property submissions"
            status="active"
          />
          <QuickNavCard
            href="/admin/resales"
            label="Flipper Resales"
            icon="🔄"
            description="Approve investor resale listings onto the marketplace"
            status="active"
          />
          <QuickNavCard
            href="/admin/users"
            label="Users Directory"
            icon="👥"
            description="Search, inspect and manage all registered accounts"
            status="active"
          />
          <QuickNavCard
            href="/admin/fees"
            label="Fee Settings"
            icon="💷"
            description="Platform fee configuration (placeholder)"
            status="placeholder"
          />
          <QuickNavCard
            href="/admin/audit"
            label="Audit Logs"
            icon="📋"
            description="Full event trail of all Admin actions"
            status="soon"
          />
        </div>
      </section>
    </div>
  );
}
