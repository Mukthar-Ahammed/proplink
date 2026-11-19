import { SubmitButton } from "@/components/ui/submit-button";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { logoutAction } from "@/app/(auth)/actions";
import { KycPill } from "@/components/layout/KycPill";
import { Logo } from "@/components/layout/Logo";
import { PORTAL_HOME, PORTAL_LABEL } from "@/lib/portalHome";

/**
 * Global chrome (ADR-071): a floating white pill — logo left, a short row of
 * public links centred, account controls right — inset from the viewport edges
 * and sticky, so content scrolls past around it. On the landing page
 * The header itself takes no layout space (negative bottom margin); a tinted
 * spacer reserves its height on ordinary pages. On the landing page
 * `<ChromeGate>` flags `data-overlay="true"`, the spacer is dropped and the
 * hero's colour runs up behind the pill (the hero adds matching top padding).
 *
 * The public links point only at pages that exist. Signed in, the bar carries a
 * single link to the portal that role owns and no other (ADR-016), so roles
 * never see each other's navigation. Portal pages are navigated from the
 * portal's own sub-nav (`<PortalShell>`).
 *
 * Below `md` the links fold into a `<details>` disclosure: no client JS, and it
 * is keyboard- and screen-reader-operable out of the box.
 */
const PUBLIC_LINKS = [
  { href: "/marketplace", label: "Properties" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#who-its-for", label: "Who it's for" },
];

const LINK =
  "rounded-full px-4 py-2 text-[15px] font-medium text-primary transition-colors hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const PRIMARY_PILL =
  "inline-flex h-10 items-center rounded-full bg-accent px-5 text-[15px] font-semibold text-white shadow-md shadow-accent/25 transition-colors hover:bg-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 sm:h-12 sm:px-6";

export async function SiteHeader() {
  const session = await auth();
  const user = session?.user;

  return (
    <>
      {/* Takes no layout space on any page, so while scrolling only the pill is
        visible over the content. */}
      <header className="sticky top-0 z-40 -mb-[68px] px-3 pt-3 sm:-mb-[80px] sm:px-6 sm:pt-4">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 rounded-full border border-white/80 bg-white/90 pr-2 pl-5 shadow-lg shadow-primary/[0.06] backdrop-blur-md sm:h-16 sm:pl-7 group-data-[overlay=true]/chrome:border-white/60 group-data-[overlay=true]/chrome:bg-white/55 group-data-[overlay=true]/chrome:shadow-accent/[0.08] group-data-[overlay=true]/chrome:backdrop-blur-xl">
          <Link
            href="/"
            aria-label="PropLink UK — home"
            className="rounded-full text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Logo />
          </Link>

          {!user && (
            <nav aria-label="Main" className="hidden items-center gap-2 md:flex">
              {PUBLIC_LINKS.map((link) => (
                <Link key={link.href} href={link.href} className={LINK}>
                  {link.label}
                </Link>
              ))}
            </nav>
          )}

          <div className="flex items-center gap-2 sm:gap-3">
            {user ? (
              <>
                {/* The one signed-in link: the portal this role owns (ADR-016). */}
                <Link
                  href={PORTAL_HOME[user.role]}
                  className="rounded-full bg-pale px-3 py-2 text-sm font-semibold whitespace-nowrap text-accent transition-colors hover:bg-accent hover:text-white sm:px-4"
                >
                  {PORTAL_LABEL[user.role]}
                </Link>
                {/* Investors only: KYC gates syndicate pledges and nothing else. */}
                {user.role === "INVESTOR" && (
                  <span className="hidden sm:inline-flex">
                    <KycPill status={user.kycStatus} />
                  </span>
                )}
                <span className="hidden items-center gap-2 lg:flex">
                  <span
                    aria-hidden
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-xs font-semibold text-primary ring-1 ring-line"
                  >
                    {(user.name ?? user.email ?? "?").trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="max-w-[10rem] truncate text-sm text-muted">
                    {user.name}
                  </span>
                </span>
                <form action={logoutAction}>
                  <SubmitButton
                    type="submit"
                    className="rounded-full bg-primary px-3 py-2 text-sm font-medium whitespace-nowrap text-white transition-colors hover:bg-accent sm:px-4"
                  >
                    Sign out
                  </SubmitButton>
                </form>
              </>
            ) : (
              <>
                <Link href="/login" className={`${LINK} hidden sm:inline-flex`}>
                  Log in
                </Link>
                <Link href="/register" className={PRIMARY_PILL}>
                  Get started
                </Link>

                <details className="group/menu relative md:hidden">
                  <summary
                    aria-label="Menu"
                    className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full bg-surface text-primary [&::-webkit-details-marker]:hidden"
                  >
                    <svg
                      aria-hidden
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      className="h-5 w-5"
                    >
                      <path
                        className="group-open/menu:hidden"
                        d="M4 7h16M4 12h16M4 17h16"
                      />
                      <path
                        className="hidden group-open/menu:block"
                        d="M6 6l12 12M18 6 6 18"
                      />
                    </svg>
                  </summary>
                  <nav
                    aria-label="Mobile"
                    className="absolute right-0 mt-4 flex w-64 flex-col gap-1 rounded-3xl border border-line bg-white p-2 shadow-xl"
                  >
                    {PUBLIC_LINKS.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        className="rounded-xl px-4 py-3 text-sm font-medium text-primary hover:bg-surface"
                      >
                        {link.label}
                      </Link>
                    ))}
                    <div className="my-1 h-px bg-line" />
                    <Link
                      href="/login"
                      className="rounded-xl px-4 py-3 text-sm font-medium text-primary hover:bg-surface"
                    >
                      Log in
                    </Link>
                  </nav>
                </details>
              </>
            )}
          </div>
        </div>
      </header>
      {/* Reserves the header's height on ordinary pages (page background shows
        through, so the pill floats on it). The landing hero supplies its own colour and
        padding, so the spacer is dropped there. */}
      <div
        aria-hidden
        className="h-[68px] sm:h-[80px] group-data-[overlay=true]/chrome:hidden"
      />
    </>
  );
}
