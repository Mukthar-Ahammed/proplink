import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatPenceGBP } from "@/services/metrics/globalMetrics";
import type { InvestorPledgeRow } from "@/services/syndicates/investorDashboard";

/**
 * Building blocks for the investor and landlord portals' content area (ADR-071 look): light
 * rounded cards on hairlines, the site's sans + italic-serif heading pairing,
 * teal icon chips and an accent → intel progress bar. Presentational only —
 * every figure comes from the page's own service call and nothing here writes.
 */

/** Portal section heading: semibold sans with an optional italic-serif tail. */
export function InvestorSectionTitle({
  title,
  tail,
  description,
  action,
}: {
  title: string;
  tail?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="font-display text-2xl leading-tight font-semibold tracking-[-0.02em] text-primary sm:text-[1.75rem]">
          {title}
          {tail ? (
            <span className="font-serif font-normal tracking-normal italic"> {tail}</span>
          ) : null}
        </h2>
        {description ? <p className="mt-1.5 text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** A text link with a trailing arrow, used as a section action. */
export function ArrowLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:text-accent-strong"
    >
      {children}
      <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/** Round teal chip holding an icon. */
export function IconChip({
  children,
  tone = "accent",
}: {
  children: React.ReactNode;
  tone?: "accent" | "success" | "warning" | "danger";
}) {
  const tones = {
    accent: "bg-pale text-accent",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    danger: "bg-danger/10 text-danger",
  } as const;
  return (
    <span
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Small status pill. */
export function StatusPill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
}) {
  const tones = {
    neutral: "border-line bg-surface text-secondary",
    accent: "border-accent/25 bg-pale text-accent",
    success: "border-success/25 bg-success/10 text-success",
    warning: "border-warning/25 bg-warning/10 text-warning",
    danger: "border-danger/25 bg-danger/10 text-danger",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Figures in one card, split by hairlines. */
export function StatStrip({
  items,
}: {
  items: { value: string | number; label: string; hint?: string }[];
}) {
  return (
    <dl
      className={cn(
        "grid overflow-hidden rounded-3xl border border-line bg-white shadow-sm sm:grid-cols-2",
        items.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4",
      )}
    >
      {items.map((item, index) => (
        <div
          key={item.label}
          className={cn(
            "p-6",
            index > 0 && "border-t border-line sm:border-t-0",
            index % 2 === 1 && "sm:border-l",
            index >= 2 && "sm:border-t lg:border-t-0",
            index > 0 && "lg:border-l",
          )}
        >
          <dt className="text-sm font-medium text-muted">{item.label}</dt>
          <dd className="font-display mt-2 text-3xl font-semibold tracking-[-0.02em] text-primary tabular-nums">
            {item.value}
          </dd>
          {item.hint ? <dd className="mt-1 text-xs text-muted">{item.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

const PLEDGE_STATUS: Record<
  string,
  { label: string; tone: "accent" | "success" | "neutral" }
> = {
  PLEDGED: { label: "Interest registered", tone: "accent" },
  CONFIRMED: { label: "Confirmed", tone: "success" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral" },
};

/** One expression of interest with its project's funding progress. */
export function PledgeCard({ pledge }: { pledge: InvestorPledgeRow }) {
  const status = PLEDGE_STATUS[pledge.status] ?? {
    label: pledge.status,
    tone: "neutral" as const,
  };
  return (
    <li className="rounded-2xl border border-line bg-white p-5 transition-shadow hover:shadow-md sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-primary">{pledge.project.name}</p>
          <p className="mt-0.5 truncate text-sm text-muted">
            {pledge.project.propertyTitle}
          </p>
        </div>
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4">
        <div>
          <p className="text-xs text-muted">Your interest</p>
          <p className="mt-0.5 font-semibold text-primary tabular-nums">
            {formatPenceGBP(pledge.amountGBP)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">Indicative share</p>
          <p className="mt-0.5 font-semibold text-primary tabular-nums">
            {pledge.equityPct}%
          </p>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between text-xs text-muted">
          <span>Project funding</span>
          <span className="tabular-nums">
            {pledge.project.fundedPct}% of{" "}
            {formatPenceGBP(pledge.project.capitalTargetGBP)}
          </span>
        </div>
        <span
          aria-hidden
          className="mt-2 block h-2 overflow-hidden rounded-full bg-surface ring-1 ring-line ring-inset"
        >
          <span
            className="block h-full rounded-full bg-gradient-to-r from-accent to-intel"
            style={{ width: `${pledge.project.fundedPct}%` }}
          />
        </span>
      </div>
    </li>
  );
}

/** Empty state with an icon and a way forward. */
export function InvestorEmpty({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed border-line bg-surface/60 px-6 py-12 text-center">
      <IconChip>
        <ChartIcon className="h-5 w-5" />
      </IconChip>
      <p className="mt-4 font-semibold text-primary">{title}</p>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted">{children}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Pill button styled like the site's primary CTA. */
export function PrimaryLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
    >
      {children}
      <ArrowIcon className="h-4 w-4" />
    </Link>
  );
}

/* ------------------------------------------------------------------ icons */

type IconProps = { className?: string };

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-5 w-5"}
    >
      {children}
    </svg>
  );
}

export const ArrowIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);
export const ShieldIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6L12 3Z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);
export const IdIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <circle cx="9" cy="11" r="2" />
    <path d="M6 16c.6-1.4 1.7-2 3-2s2.4.6 3 2M14.5 10h4M14.5 13.5h3" />
  </Svg>
);
export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Svg>
);
export const UserIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20c1.2-3.3 3.8-5 7-5s5.8 1.7 7 5" />
  </Svg>
);
export const ChartIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h16M7 16v-4M12 16V8M17 16v-7" />
  </Svg>
);
export const ScaleIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v16M8 20h8M5 8h14M5 8l-2.5 6a3 3 0 0 0 5 0L5 8Zm14 0-2.5 6a3 3 0 0 0 5 0L19 8Z" />
  </Svg>
);
export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l2.5 2" />
  </Svg>
);
export const AlertIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4 2.8 19.5h18.4L12 4Z" />
    <path d="M12 10v4M12 17h.01" />
  </Svg>
);
export const HomeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 11 12 4l8 7" />
    <path d="M6 9.5V20h12V9.5M10 20v-5h4v5" />
  </Svg>
);
export const FileIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </Svg>
);
export const UploadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </Svg>
);
export const PenIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
    <path d="m13.5 6.5 4 4" />
  </Svg>
);
export const EyeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </Svg>
);
