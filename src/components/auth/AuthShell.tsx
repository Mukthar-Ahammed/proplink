/**
 * Full-page shell for every `(auth)` route (ADR-071): a single centred card on
 * the landing hero's gradient-mesh + hairline-grid ground (`auth-ground`,
 * `auth-grid` in globals.css). No photo panel, so the form is the whole task
 * on every screen size. Spacing is kept tight so the longest form (sign-up)
 * fits a laptop viewport without scrolling. The global chrome is suppressed on
 * these routes (`<ChromeGate>`), and no wordmark sits above the card.
 */
export function AuthShell({
  title,
  subtitle,
  wide = false,
  children,
}: {
  /** Page heading. Rendered as the `<h1>` — E2E specs match on it. */
  title: string;
  subtitle: string;
  /** A wider card for forms that lay fields out side by side (sign-up). */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main className="auth-ground relative isolate flex min-h-dvh flex-col items-center px-4 py-5 sm:py-6 [@media(max-height:820px)]:py-2.5">
      <div aria-hidden className="auth-grid pointer-events-none absolute inset-0 -z-10" />

      <div className="flex w-full flex-1 items-center justify-center py-5 [@media(max-height:820px)]:py-2.5">
        <div
          className={`w-full rounded-[1.75rem] border border-line bg-background/95 p-6 shadow-[0_24px_60px_-28px_rgb(20_26_24/0.3)] backdrop-blur-sm sm:px-9 sm:py-8 [@media(max-height:820px)]:sm:py-5 ${
            wide ? "max-w-xl" : "max-w-md"
          }`}
        >
          <div className="text-center">
            <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-primary sm:text-3xl">
              {title}
            </h1>
            <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
          </div>
          <div className="mt-6 [@media(max-height:820px)]:mt-4">{children}</div>
        </div>
      </div>

      {/* The EOI position is a compliance statement, and these routes have
          no footer, so it is carried here on every screen size. */}
      <p className="max-w-md text-center text-xs leading-relaxed text-muted">
        Syndicate participation is currently expression-of-interest only — no funds are
        collected on-platform.
      </p>
    </main>
  );
}

/** Shared field styling, so the auth forms cannot drift apart. */
export const AUTH_INPUT =
  "mt-1.5 w-full rounded-xl border border-line bg-white px-4 py-2.5 text-sm text-primary transition-colors placeholder:text-muted/70 focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/20";

export const AUTH_LABEL = "block text-sm font-medium text-primary";

export const AUTH_BUTTON =
  "w-full rounded-full bg-accent py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-50";
