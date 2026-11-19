import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CategoryTiles, type CategoryTile } from "@/components/marketing/CategoryTiles";
import { HeroStats } from "@/components/marketing/HeroStats";
import { HowItWorksBento } from "@/components/marketing/HowItWorksBento";
import { UkListingsMap } from "@/components/marketing/UkListingsMap";
import { Eyebrow, SectionHeading } from "@/components/marketing/SectionHeading";
import { WhyPropLink } from "@/components/marketing/WhyPropLink";
import heroImage from "@/assets/heroimage.jpeg";
import { searchService } from "@/services/search";
import { auth } from "@/lib/auth";
import { PORTAL_HOME, PORTAL_LABEL } from "@/lib/portalHome";
import type { DistressTag, Role } from "@/generated/prisma/enums";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/** Category tiles: label + the distress tags their marketplace search filters on. */
const CATEGORIES: { label: string; blurb: string; tags: DistressTag[]; image: string }[] =
  [
    {
      label: "Probate sales",
      blurb: "Estates sold on behalf of executors.",
      tags: ["PROBATE"],
      image: "/marketing/categories/probate.jpg",
    },
    {
      label: "Fire & flood damage",
      blurb: "Homes needing reinstatement after damage.",
      tags: ["FIRE_DAMAGE", "WATER_DAMAGE"],
      image: "/marketing/categories/fire-flood.jpg",
    },
    {
      label: "Structural defects",
      blurb: "Subsidence, roofs and structural repair.",
      tags: ["SUBSIDENCE", "ROOF_REQUIRED"],
      image: "/marketing/categories/structural.jpg",
    },
    {
      label: "Refurbishment stock",
      blurb: "Damp, dated or part-finished properties.",
      tags: ["RENOVATION_NEEDED", "DAMP"],
      image: "/marketing/categories/refurb.jpg",
    },
  ];

/** The pipeline from the business PDFs: Landlord → Agent → Investors → Buyer. */
const STEPS = [
  {
    title: "Landlord lists privately",
    desc: "Landlords submit their property privately. It is reviewed by our team and never shown in public search.",
  },
  {
    title: "Agent wins the mandate",
    desc: "Verified Agents send proposals. The Landlord compares them side by side and chooses one exclusive Agent.",
  },
  {
    title: "Investors fund the works",
    desc: "A Lead Investor and Co-Investors express interest. Agreements and funds are handled by the project Solicitor, outside the app.",
  },
  {
    title: "Buyer purchases the home",
    desc: "The finished property is listed for retail Buyers to save, enquire, view and make offers.",
  },
];

/**
 * Who it's for. `role` ties each card to the account role it describes, so a
 * signed-in viewer sees their own card point at their portal. Sign-up buttons
 * (`/register`) are for signed-out visitors only: an account holds exactly one
 * role (ADR-016), so a signed-in Buyer is never offered a sign-up flow they
 * cannot complete with that account (OD-23).
 */
const AUDIENCES: {
  role: Role;
  title: string;
  desc: string;
  cta?: { href: string; label: string };
  note?: string;
}[] = [
  {
    role: "LANDLORD",
    title: "Landlords",
    desc: "List a property or development land privately. Compare Agent offers and choose one; your personal details stay hidden by default. Identity check required, no subscription.",
    cta: { href: "/register", label: "List a property" },
  },
  {
    role: "AGENT",
    title: "Agents",
    desc: "Access Admin-approved private listings, win exclusive mandates, take projects to investors and re-list finished homes for buyers.",
    note: "Agents join by invitation.",
  },
  {
    role: "INVESTOR",
    title: "Investors",
    desc: "Lead or co-invest in refurbishment and land development projects after an identity check. Express interest in the app; agreements and funds are handled by the project Solicitor.",
    cta: { href: "/register", label: "Join as an investor" },
  },
  {
    role: "BUYER",
    title: "Buyers",
    desc: "Browse finished homes with EPC ratings, then enquire, book viewings and make offers. Email sign-up only, no subscription.",
    cta: { href: "/marketplace", label: "Search properties" },
  },
];

/** Shared entrance for hero content; off entirely under reduced motion. */
const RISE = "animate-rise motion-reduce:animate-none";

/**
 * Marketing landing page (ADR-071): a light hero with a dot-matrix UK map and
 * pulsing listing pins, then light
 * sections built from rounded cards, small pill eyebrows and headlines that put
 * one or two words in the italic serif.
 *
 * Server-rendered end to end. Every figure and count is live data. Signed-in
 * viewers see their portal in place of sign-up calls to action.
 */
export default async function Home() {
  const [categoryCounts, session] = await Promise.all([
    Promise.all(CATEGORIES.map((c) => searchService.count({ distressTags: c.tags }))),
    auth(),
  ]);
  // Signed-in viewers get their next step (their portal) instead of sign-up
  // prompts. Display only; every portal enforces its own authorisation.
  const viewerRole = session?.user?.role ?? null;
  const portal = viewerRole
    ? { href: PORTAL_HOME[viewerRole], label: PORTAL_LABEL[viewerRole] }
    : null;

  const tiles: CategoryTile[] = CATEGORIES.map((category, i) => ({
    label: category.label,
    blurb: category.blurb,
    count: categoryCounts[i],
    href: `/marketplace?tags=${category.tags.join(",")}`,
    image: category.image,
  }));

  return (
    <main className="flex flex-1 flex-col bg-background">
      {/* ------------------------------------------------------------ Hero */}
      <section data-testid="hero-stage" className="relative isolate overflow-x-clip">
        {/* Layered mesh gradient (`hero-ground`, globals.css) that starts at the
            very top, behind the translucent header pill, and fades to white,
            so header, hero and the next section read as one surface. */}
        <div aria-hidden className="hero-ground absolute inset-0 -z-20" />
        {/* Faint grid that fades out towards the bottom and edges. */}
        <div aria-hidden className="hero-grid absolute inset-0 -z-10" />

        <div className="mx-auto grid w-full max-w-7xl items-center gap-10 px-4 pt-[7.5rem] pb-20 sm:px-6 sm:pt-32 lg:grid-cols-[1.1fr_0.9fr] lg:gap-6 lg:px-8 lg:pt-36 lg:pb-24">
          {/* Copy */}
          <div className="flex flex-col items-start">
            <Eyebrow
              className={`${RISE} border-accent/15 bg-white/70 text-accent backdrop-blur-sm`}
            >
              UK distressed property platform
            </Eyebrow>
            <h1
              className={`${RISE} font-display mt-6 text-[clamp(2.5rem,5.2vw,4.5rem)] leading-[1.04] font-semibold tracking-[-0.035em] text-primary [animation-delay:80ms]`}
            >
              Redefining distressed{" "}
              <span className="font-serif font-normal tracking-normal text-accent italic">
                property investment
              </span>
            </h1>
            <p
              className={`${RISE} mt-6 max-w-lg text-base leading-relaxed text-secondary [animation-delay:160ms] sm:text-lg`}
            >
              Private listings, verified access, disclosed defects and EPC ratings. One
              controlled pipeline from landlord to finished home.
            </p>
            <div
              className={`${RISE} mt-9 flex flex-wrap items-center gap-3 [animation-delay:240ms]`}
            >
              <Link
                href="/marketplace"
                className="rounded-full bg-accent px-8 py-3.5 text-sm font-semibold text-white shadow-sm shadow-accent/30 transition-colors hover:bg-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              >
                Browse listings
              </Link>
              <Link
                href="#how-it-works"
                className="inline-flex items-center gap-2.5 rounded-full bg-white/70 py-2 pr-6 pl-2 text-sm font-semibold text-primary ring-1 ring-line backdrop-blur-sm transition-colors hover:bg-white hover:text-accent"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-pale text-accent">
                  <svg
                    aria-hidden
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="h-3 w-3"
                  >
                    <path d="M12 4v13.2l-5.6-5.6L5 13l7 7 7-7-1.4-1.4-5.6 5.6V4z" />
                  </svg>
                </span>
                How it works
              </Link>
            </div>
            <ul
              className={`${RISE} mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-secondary [animation-delay:320ms]`}
            >
              {["EPC on every listing", "Verified investors", "Private by default"].map(
                (point) => (
                  <li key={point} className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-accent ring-1 ring-accent/20">
                      <CheckIcon />
                    </span>
                    {point}
                  </li>
                ),
              )}
            </ul>

            {/* Live figures sit with the copy they support, left-aligned under
                the trust points, rather than floating centred below the grid. */}
            <div className={`${RISE} mt-10 w-full max-w-md [animation-delay:400ms]`}>
              <HeroStats />
            </div>
          </div>

          {/* Map */}
          <div
            className={`${RISE} relative mx-auto flex w-[min(78vw,22rem)] flex-col items-center [animation-delay:200ms] lg:w-auto`}
          >
            <div
              aria-hidden
              className="absolute inset-[12%] -z-10 rounded-full bg-white/70 blur-3xl"
            />
            <UkListingsMap className="h-auto w-full lg:h-[min(62svh,560px)] lg:w-auto" />
            {/* In flow beneath the map, so it never covers the coastline. */}
            <p className="mt-5 flex items-center gap-2 rounded-full border border-line bg-white/90 px-3 py-1.5 text-xs font-medium text-secondary shadow-sm backdrop-blur-sm">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
              </span>
              New listings across the UK
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- How it works */}
      <section id="how-it-works" className="scroll-mt-20 pt-14 pb-24 sm:pt-16 sm:pb-32">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <SectionHeading
            eyebrow="How it works"
            title="One private pipeline,"
            accent="start to finish"
            align="center"
          />
          <div className="mt-14">
            <HowItWorksBento steps={STEPS} roles={AUDIENCES.map((a) => a.title)} />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ Categories */}
      <section className="pb-24 sm:pb-32">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <SectionHeading
              eyebrow="By distress type"
              title="Browse the"
              accent="defect"
              titleTail="you understand"
            />
            <Link
              href="/marketplace"
              className="group inline-flex items-center gap-3 text-sm font-semibold text-primary"
            >
              View all properties
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-line transition-colors group-hover:border-accent group-hover:bg-accent group-hover:text-white">
                <ArrowIcon />
              </span>
            </Link>
          </div>
          <div className="mt-12">
            <CategoryTiles tiles={tiles} />
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- Why PropLink */}
      <WhyPropLink portal={portal} />

      {/* ----------------------------------------------------- Who it's for */}
      <section id="who-its-for" className="scroll-mt-20 bg-surface py-24 sm:py-32">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <SectionHeading
            eyebrow="Who it's for"
            title="One platform,"
            accent="four roles"
            align="center"
          />
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {AUDIENCES.map((audience) => {
              const isOwn = portal !== null && audience.role === viewerRole;
              // Sign-up links are for signed-out visitors only.
              const cta =
                audience.cta && !(portal && audience.cta.href === "/register")
                  ? audience.cta
                  : null;
              return (
                <div
                  key={audience.title}
                  className={`flex flex-col rounded-3xl border bg-white p-7 ${isOwn ? "border-accent/40 ring-4 ring-accent/10" : "border-line"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold text-primary">
                      {audience.title}
                    </h3>
                    {isOwn && (
                      <span className="rounded-full bg-pale px-2.5 py-0.5 text-xs font-semibold text-accent">
                        Your account
                      </span>
                    )}
                  </div>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-muted">
                    {audience.desc}
                  </p>
                  {isOwn && portal ? (
                    <Link
                      href={portal.href}
                      className="mt-8 inline-flex items-center justify-between rounded-full bg-accent px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-strong"
                    >
                      Open {portal.label}
                      <ArrowIcon />
                    </Link>
                  ) : cta ? (
                    <Link
                      href={cta.href}
                      className="mt-8 inline-flex items-center justify-between rounded-full border border-line px-5 py-3 text-sm font-semibold text-primary transition-colors hover:border-accent hover:text-accent"
                    >
                      {cta.label}
                      <ArrowIcon />
                    </Link>
                  ) : audience.note ? (
                    <p className="mt-8 rounded-full bg-surface px-5 py-3 text-center text-sm font-medium text-muted">
                      {audience.note}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- Closing CTA */}
      <section className="py-24 sm:py-32">
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="relative isolate overflow-hidden rounded-[2rem] bg-brand px-6 py-20 text-center sm:px-12 sm:py-28">
            {/* Restoration photo under a brand-ink gradient (`cta-ground`,
                globals.css): decorative, so empty alt; the overlay keeps the
                white headline and buttons well above AA on any part of it. */}
            <Image
              src={heroImage}
              alt=""
              fill
              sizes="(min-width: 1280px) 1216px, 100vw"
              placeholder="blur"
              className="-z-20 object-cover object-[60%_center]"
            />
            <div aria-hidden className="cta-ground absolute inset-0 -z-10" />
            <h2 className="font-display mx-auto max-w-2xl text-[clamp(2rem,4.5vw,3.5rem)] leading-[1.05] font-semibold tracking-[-0.03em] text-white">
              {portal ? (
                <>
                  Pick up where you{" "}
                  <span className="font-serif font-normal tracking-normal italic">
                    left off
                  </span>
                </>
              ) : (
                <>
                  Start with the listings, or{" "}
                  <span className="font-serif font-normal tracking-normal italic">
                    set up your account
                  </span>
                </>
              )}
            </h2>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href={portal ? portal.href : "/register"}
                className="w-full rounded-full bg-white px-9 py-4 text-sm font-semibold text-primary transition-colors hover:bg-pale sm:w-auto"
              >
                {portal ? `Open ${portal.label}` : "Get started"}
              </Link>
              <Link
                href="/marketplace"
                className="w-full rounded-full border border-white/30 px-9 py-4 text-sm font-semibold text-white transition-colors hover:border-white hover:bg-white/10 sm:w-auto"
              >
                Browse listings
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function ArrowIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M5 12h14m0 0-5-5m5 5-5 5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3 w-3"
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}
