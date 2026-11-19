import Link from "next/link";
import { Eyebrow } from "@/components/marketing/SectionHeading";

/**
 * "Why PropLink" comparison block on the landing page: what PropLink does on
 * the left, the open-market alternative on the right. Every PropLink point is a
 * safeguard already stated elsewhere on the site; each "usual route" row is
 * simply its absence — no claims about named competitors.
 */
const PROPLINK_POINTS = [
  "Landlord listings reviewed by our team before anyone sees them",
  "Private listings never appear in public search",
  "Shared only with verified Agents",
  "Landlords compare Agent proposals side by side and choose one exclusive Agent",
  "Defects disclosed up front",
  "EPC rating shown on every listing",
  "Identity-verified investors and Landlords",
  "Investment funds handled by a Solicitor, outside the app",
];

const USUAL_POINTS = [
  "Listings go live without review",
  "Property details public from day one",
  "Open to anyone who asks",
  "Agent chosen without comparing proposals",
  "Defects found after the offer",
  "EPC rating left for buyers to chase",
  "No identity checks on who you deal with",
  "No clear separation of investment money",
];

/**
 * `portal` is the signed-in viewer's own portal (null when signed out). Signed
 * in, the main button opens it instead of offering "Create an account": an
 * account holds one role (ADR-016, OD-23), so sign-up is for visitors only.
 */
export function WhyPropLink({
  portal = null,
}: {
  portal?: { href: string; label: string } | null;
}) {
  return (
    <section aria-labelledby="why-proplink-title" className="pb-24 sm:pb-32">
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center text-center">
          <Eyebrow className="gap-2">
            <ShieldIcon />
            Why PropLink
          </Eyebrow>
          <h2
            id="why-proplink-title"
            className="font-display mt-5 max-w-3xl text-[clamp(2rem,4.5vw,3.5rem)] leading-[1.05] font-semibold tracking-[-0.03em] text-primary"
          >
            Built for{" "}
            <span className="font-serif font-normal tracking-normal italic">trust</span>
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
            Distressed property is a chain of people who need to trust each other.
            PropLink keeps every step private, verified and recorded.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {/* PropLink */}
          <div className="flex flex-col rounded-3xl border border-accent/30 bg-white shadow-sm ring-4 ring-accent/10">
            <div className="p-7">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-primary">PropLink</h3>
                <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-white">
                  Private by default
                </span>
              </div>
              <p className="mt-2 text-sm text-muted">
                The safeguards that apply to every property and every account.
              </p>
            </div>
            <hr className="border-line" />
            <ul className="flex flex-1 flex-col gap-3.5 p-7">
              {PROPLINK_POINTS.map((point) => (
                <li key={point} className="flex items-start gap-3 text-sm text-body">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-white">
                    <CheckIcon />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
            <div className="border-t border-line p-7">
              <Link
                href={portal ? portal.href : "/register"}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-accent px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              >
                {portal ? `Open ${portal.label}` : "Create an account"}
                <ArrowIcon />
              </Link>
            </div>
          </div>

          {/* The usual route */}
          <div className="flex flex-col rounded-3xl border border-line bg-surface">
            <div className="p-7">
              <h3 className="text-lg font-semibold text-secondary">The usual route</h3>
              <p className="mt-2 text-sm text-muted">
                What selling or investing in distressed property looks like without those
                safeguards.
              </p>
            </div>
            <hr className="border-line" />
            <ul className="flex flex-1 flex-col gap-3.5 p-7">
              {USUAL_POINTS.map((point) => (
                <li key={point} className="flex items-start gap-3 text-sm text-muted">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-muted ring-1 ring-line">
                    <CrossIcon />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
            <div className="border-t border-line p-7">
              <Link
                href="/marketplace"
                className="flex w-full items-center justify-center gap-2 rounded-full border border-line bg-white px-6 py-3.5 text-sm font-semibold text-primary transition-colors hover:border-accent hover:text-accent"
              >
                Browse listings
                <ArrowIcon />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const ICON = {
  "aria-hidden": true,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function CheckIcon() {
  return (
    <svg {...ICON} strokeWidth={2.4} className="h-3 w-3">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg {...ICON} strokeWidth={2.4} className="h-3 w-3">
      <path d="M7 7l10 10M17 7 7 17" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg {...ICON} strokeWidth={1.8} className="h-4 w-4">
      <path d="M5 12h14m0 0-5-5m5 5-5 5" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg {...ICON} strokeWidth={1.8} className="h-3.5 w-3.5 text-accent">
      <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
