import Image from "next/image";
import { PortalNav } from "@/components/portal/PortalNav";
import { cn } from "@/lib/cn";

/**
 * The frame every role portal wears (ADR-016).
 *
 * A light masthead (ADR-071): pill eyebrow, a headline whose tail is set in
 * the italic serif, and a tabbed sub-nav on its lower edge — then the working
 * content below on white at ordinary density.
 *
 * **The sub-nav is the portal's whole navigation.** The global header carries
 * none (ADR-009), so a portal that does not list its own pages here has
 * unreachable pages.
 *
 * Every route passed in must already be role-gated by `src/middleware.ts` —
 * this renders links, it does not authorise anything.
 *
 * It lives in each portal's **layout**, not its pages: the masthead carries the
 * portal's single `<h1>` and every page below contributes `<h2>`s. Putting it in
 * a page as well as a layout is how `/agent` ended up with two `<h1>`s.
 *
 * **Banner variant.** With `banner`, the masthead runs up behind the floating
 * header pill (the route must be an overlay route in `<ChromeGate>`) and lays
 * the photo under the landing hero's mesh (`banner-ground`, `hero-grid`), so
 * the portal opens on the same surface as the home page.
 */

export interface PortalNavItem {
  href: string;
  label: string;
  /** A subscription feature: the tab carries a gold crown. */
  premium?: boolean;
  /**
   * The viewer has no active subscription: clicking opens the subscription
   * popup (`OPEN_SUBSCRIPTION_EVENT`) instead of navigating. The target page
   * and every server action still enforce the rule themselves.
   */
  locked?: boolean;
}

export function PortalShell({
  eyebrow,
  title,
  titleTail,
  standfirst,
  nav,
  aside,
  banner,
  children,
}: {
  eyebrow: string;
  /** Rendered semibold. */
  title: string;
  /** Rendered light, completing the heading — the page's weight pairing. */
  titleTail?: string;
  standfirst?: string;
  nav: PortalNavItem[];
  /** Portal-specific control on the band, e.g. the agent profile switcher. */
  aside?: React.ReactNode;
  /** Photo behind the masthead; its subject should sit on the right. */
  banner?: { src: string };
  children: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 flex-col bg-background">
      <section
        className={cn(
          "border-b",
          banner
            ? "relative isolate overflow-hidden border-transparent"
            : "border-line bg-surface",
        )}
      >
        {banner ? (
          <>
            <Image
              src={banner.src}
              alt=""
              fill
              priority
              sizes="100vw"
              className="-z-30 object-cover object-[78%_center]"
            />
            <div aria-hidden className="banner-ground absolute inset-0 -z-20" />
            <div aria-hidden className="hero-grid absolute inset-0 -z-10" />
          </>
        ) : null}
        <div
          className={cn(
            "mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8",
            banner ? "pt-[6.5rem] sm:pt-32" : "pt-10 sm:pt-12",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="inline-flex items-center rounded-full border border-line bg-white/80 px-4 backdrop-blur-sm py-1.5 text-[11px] font-semibold tracking-[0.18em] text-secondary uppercase">
              {eyebrow}
            </p>
            {aside}
          </div>
          <div
            className={cn(
              "mt-5 flex flex-wrap gap-x-10 gap-y-4",
              banner ? "flex-col" : "items-end justify-between",
            )}
          >
            <h1 className="font-display max-w-2xl text-[clamp(1.875rem,3.5vw,2.75rem)] leading-[1.08] font-semibold tracking-[-0.03em] text-primary">
              {title}
              {titleTail ? (
                <span className="font-serif font-normal tracking-normal italic">
                  {" "}
                  {titleTail}
                </span>
              ) : null}
            </h1>
            {standfirst ? (
              <p
                className={cn(
                  "max-w-sm text-sm leading-relaxed",
                  banner ? "text-body" : "text-muted",
                )}
              >
                {standfirst}
              </p>
            ) : null}
          </div>

          {/* Sub-nav on the masthead's lower edge, so the masthead and the
              content it governs read as one object. */}
          <PortalNav items={nav} />
        </div>
      </section>

      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {children}
      </div>
    </main>
  );
}

/** A dashboard figure: one number over a small-caps label, on a hairline. */
export function StatCard({
  value,
  label,
  hint,
}: {
  value: string | number;
  label: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-white p-6 transition-shadow hover:shadow-md">
      <p className="text-4xl font-light tracking-tight text-primary">{value}</p>
      <p className="mt-2 text-sm font-medium text-muted">{label}</p>
      {hint ? <p className="mt-1.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** Section heading inside a portal's content area. */
export function PortalSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold text-primary">{title}</h2>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** The honest empty state — every one of these portals starts empty. */
export function PortalEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-line bg-surface px-6 py-12 text-center text-sm text-muted">
      {children}
    </p>
  );
}
