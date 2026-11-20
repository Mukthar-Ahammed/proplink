import Link from "next/link";

import { cn } from "@/lib/cn";

/**
 * Building blocks for every portal **detail page** (ADR-080): a project, a
 * listing, a mandate. They replace the old "one long column of `<h2>`s" with
 *
 *   DetailHeader  — what this is, its status and the one or two main actions
 *   KeyFacts      — the four to six numbers people come to the page for
 *   DetailTabs    — the rest, split into named areas (Overview, Funding, …)
 *   Panel         — a titled card that groups related content inside a tab
 *
 * Tabs are plain links (`?tab=key`), rendered on the server: only the chosen
 * tab's data is shown, the URL can be shared or bookmarked, Back works, and a
 * server action that revalidates the page keeps the user on the same tab.
 */

export interface DetailTab {
  key: string;
  label: string;
  /** A small count after the label, e.g. number of proposals. */
  count?: number;
  /** Something here needs the viewer: shows a dot and is announced. */
  attention?: boolean;
}

/** The tab to show: `?tab=` when it names a visible tab, else the first. */
export function pickTab(
  requested: string | string[] | undefined,
  tabs: readonly DetailTab[],
): string {
  const value = Array.isArray(requested) ? requested[0] : requested;
  return tabs.some((tab) => tab.key === value) ? value! : (tabs[0]?.key ?? "");
}

export function DetailHeader({
  back,
  eyebrow,
  title,
  badges,
  subtitle,
  actions,
}: {
  back?: { href: string; label: string };
  eyebrow?: string;
  title: string;
  badges?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mt-2">
      {back ? (
        <Link
          href={back.href}
          className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-accent"
        >
          <span aria-hidden>←</span> {back.label}
        </Link>
      ) : null}
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-primary sm:text-3xl">
            {title}
          </h2>
          {badges ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">{badges}</div>
          ) : null}
          {subtitle ? (
            <div className="mt-3 max-w-3xl text-sm text-muted">{subtitle}</div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-3">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}

export interface KeyFact {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  /**
   * A full-width row under the tiles (e.g. a chart). `content` replaces the
   * value/hint; `label` names it for screen readers.
   */
  wide?: { content: React.ReactNode };
}

/** The headline numbers, as a strip of tiles (plus optional full-width rows). */
export function KeyFacts({ items, className }: { items: KeyFact[]; className?: string }) {
  const narrow = items.filter((item) => !item.wide).length;
  return (
    <dl
      className={cn(
        "mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line",
        // Four tiles split 2 + 2 rather than 3 + 1, so no row is left half empty.
        narrow === 4 ? "sm:grid-cols-2" : "sm:grid-cols-3",
        narrow >= 4 && "lg:grid-cols-4",
        narrow >= 5 && "xl:grid-cols-5",
        className,
      )}
    >
      {items.map((item) =>
        item.wide ? (
          <div key={item.label} className="col-span-full bg-white px-5 py-5">
            <dt className="sr-only">{item.label}</dt>
            <dd>{item.wide.content}</dd>
          </div>
        ) : (
          <div key={item.label} className="bg-white px-5 py-4">
            <dt className="text-xs font-medium text-muted">{item.label}</dt>
            <dd className="mt-1 text-lg font-semibold tracking-tight text-primary">
              {item.value ?? "—"}
            </dd>
            {item.hint ? (
              <dd className="mt-0.5 text-xs text-muted">{item.hint}</dd>
            ) : null}
          </div>
        ),
      )}
    </dl>
  );
}

/** The tab bar. Each tab is a link to `basePath?tab=key`. */
export function DetailTabs({
  basePath,
  tabs,
  current,
  label = "Sections",
}: {
  basePath: string;
  tabs: readonly DetailTab[];
  current: string;
  label?: string;
}) {
  return (
    <nav
      aria-label={label}
      className="mt-8 flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab, index) => {
        const active = tab.key === current;
        return (
          <Link
            key={tab.key}
            href={index === 0 ? basePath : `${basePath}?tab=${tab.key}`}
            scroll={false}
            aria-current={active ? "page" : undefined}
            data-testid={`tab-${tab.key}`}
            className={cn(
              "-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors",
              active
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:border-line hover:text-primary",
            )}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-semibold",
                  active ? "bg-pale text-accent" : "bg-surface text-muted",
                )}
              >
                {tab.count}
              </span>
            ) : null}
            {tab.attention ? (
              <>
                <span aria-hidden className="h-2 w-2 rounded-full bg-warning" />
                <span className="sr-only">(needs your attention)</span>
              </>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** The chosen tab's content area. */
export function TabBody({ children }: { children: React.ReactNode }) {
  return <div className="mt-6 space-y-6">{children}</div>;
}

/** A titled card grouping related content. */
export function Panel({
  title,
  description,
  action,
  tone = "default",
  className,
  children,
  testId,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** `attention` frames something waiting on the viewer. */
  tone?: "default" | "attention" | "muted";
  className?: string;
  children?: React.ReactNode;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className={cn(
        "rounded-2xl border p-5 sm:p-6",
        tone === "attention" && "border-warning/40 bg-warning/5",
        tone === "muted" && "border-line bg-surface",
        tone === "default" && "border-line bg-white",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-primary">{title}</h3>
          {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        </div>
        {action}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

/** Label/value pairs inside a panel. */
export function FactList({
  items,
  columns = 2,
  testId,
}: {
  items: { label: string; value: React.ReactNode; wide?: boolean }[];
  columns?: 2 | 3;
  testId?: string;
}) {
  return (
    <dl
      data-testid={testId}
      className={cn(
        "grid gap-x-6 gap-y-4",
        columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
      )}
    >
      {items.map((item) => (
        // The wrapping div must be a direct child of <dl> (axe: definition-list).
        <div key={item.label} className={item.wide ? "sm:col-span-full" : undefined}>
          <dt className="text-xs font-medium tracking-wide text-muted uppercase">
            {item.label}
          </dt>
          <dd className="mt-0.5 text-sm whitespace-pre-line text-body">
            {item.value || "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Two columns on wide screens: main content and a narrower side rail. */
export function DetailColumns({
  main,
  side,
}: {
  main: React.ReactNode;
  side: React.ReactNode;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">{main}</div>
      <aside className="space-y-6">{side}</aside>
    </div>
  );
}
