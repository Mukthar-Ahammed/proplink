import Link from "next/link";
import { Logo } from "@/components/layout/Logo";
import { auth } from "@/lib/auth";
import { PORTAL_HOME, PORTAL_LABEL } from "@/lib/portalHome";

/**
 * Public footer (ADR-071): a quiet surface panel with the wordmark and mission,
 * link columns that point only at pages that exist, then the compliance
 * notices and credits on a hairline. Signed in, the Account column links to the
 * viewer's own portal instead of sign-up and log-in (ADR-016, OD-33), matching
 * the header.
 */
const COLUMNS = [
  {
    title: "Platform",
    links: [
      { href: "/marketplace", label: "Browse properties" },
      { href: "/#how-it-works", label: "How it works" },
      { href: "/#who-its-for", label: "Who it's for" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy policy" },
      { href: "/terms", label: "Terms of use" },
    ],
  },
];

const SIGNED_OUT_ACCOUNT_LINKS = [
  { href: "/register", label: "Create an account" },
  { href: "/login", label: "Log in" },
];

export async function SiteFooter() {
  const session = await auth();
  const role = session?.user?.role;
  const accountLinks = role
    ? [{ href: PORTAL_HOME[role], label: PORTAL_LABEL[role] }]
    : SIGNED_OUT_ACCOUNT_LINKS;
  // Account sits second, between Platform and Legal, as before.
  const columns = [
    COLUMNS[0],
    { title: "Account", links: accountLinks },
    ...COLUMNS.slice(1),
  ];

  return (
    <footer className="mt-auto border-t border-line bg-surface text-sm">
      <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="max-w-xs">
            <Link href="/" aria-label="PropLink UK — home" className="text-primary">
              <Logo />
            </Link>
            <p className="mt-4 leading-relaxed text-muted">
              The private pipeline for UK distressed property — from landlord to agent,
              investors and the finished home.
            </p>
          </div>

          {columns.map((column) => (
            <div key={column.title}>
              <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
                {column.title}
              </p>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-muted transition-colors hover:text-accent"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 space-y-3 border-t border-line pt-8 text-xs leading-relaxed text-muted">
          <p>
            Syndicate participation is currently expression-of-interest only — no funds
            are collected on-platform. AI valuations are statistical projections and do
            not substitute for RICS-qualified surveys.
          </p>
          {/* CC BY requires visible credit wherever the work is shown. Two of the
              landing page's category photographs carry that licence, so the
              credit is global. Provenance: `public/marketing/categories/LICENSES.md`. */}
          <p>
            Category photography by Karen Roe and Chris Samuel, licensed{" "}
            <a
              href="https://creativecommons.org/licenses/by/2.0/"
              rel="noopener noreferrer license"
              target="_blank"
              className="underline hover:text-primary"
            >
              CC BY 2.0
            </a>
            . Placeholder imagery, not PropLink listings.
          </p>
          <p>© {new Date().getFullYear()} PropLink UK</p>
        </div>
      </div>
    </footer>
  );
}
