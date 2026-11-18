import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CategoryTiles, type CategoryTile } from "@/components/marketing/CategoryTiles";
import { HeroStage } from "@/components/marketing/HeroStage";
import { HeroStats } from "@/components/marketing/HeroStats";
import { PlatformEcosystem } from "@/components/marketing/PlatformEcosystem";
import { RenderObject } from "@/components/marketing/RenderObject";
import heroImage from "@/assets/heroimage.jpeg";
import { searchService } from "@/services/search";
import type { DistressTag } from "@/generated/prisma/enums";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/** Category tiles: label + the distress tags their marketplace search filters on. */
const CATEGORIES: { label: string; tags: DistressTag[]; image: string }[] = [
  {
    label: "Probate sales",
    tags: ["PROBATE"],
    image: "/marketing/categories/probate.jpg",
  },
  {
    label: "Fire & flood damage",
    tags: ["FIRE_DAMAGE", "WATER_DAMAGE"],
    image: "/marketing/categories/fire-flood.jpg",
  },
  {
    label: "Structural defects",
    tags: ["SUBSIDENCE", "ROOF_REQUIRED"],
    image: "/marketing/categories/structural.jpg",
  },
  {
    label: "Refurbishment stock",
    tags: ["RENOVATION_NEEDED", "DAMP"],
    image: "/marketing/categories/refurb.jpg",
  },
];

/**
 * The hero's entrance (ADR-010). `<HeroStage>` flips `data-entered` one frame
 * after mount and everything wearing this rises into place, staggered by its
 * own `delay-*`.
 *
 * Transitions on utilities, not `@keyframes`: a hand-added rule in
 * `globals.css` goes stale under Turbopack's Tailwind cache (`plateWash.ts`),
 * and `motion-reduce:` then turns the whole thing off with no second code path.
 */
const RISE =
  "translate-y-4 opacity-0 transition-[opacity,transform] duration-700 ease-out group-data-[entered=true]/hero:translate-y-0 group-data-[entered=true]/hero:opacity-100 motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none";

/**
 * One masked line of the hero headline: an `overflow-hidden` block with its
 * words sitting a full line below, released when the stage says so.
 *
 * The mask is why the headline is split into explicit lines rather than left to
 * wrap — a mask can only reveal a line whose bounds it knows. The trade-off is
 * that the line breaks are now authored, which at these sizes they should be
 * anyway; the accessible name is unaffected because the spans carry no roles.
 */
function Line({ children, delay = "" }: { children: React.ReactNode; delay?: string }) {
  return (
    // `pb-[0.08em]` on the mask, matched by `-mb-[0.08em]`: descenders overrun
    // the line box, and a mask clipped to the box shears them off.
    <span className="-mb-[0.08em] block overflow-hidden pb-[0.08em]">
      <span
        className={`block translate-y-full transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-data-[entered=true]/hero:translate-y-0 motion-reduce:translate-y-0 motion-reduce:transition-none ${delay}`}
      >
        {children}{" "}
      </span>
    </span>
  );
}

const STEPS = [
  {
    title: "Agent lists",
    desc: "Invited Agents review approved private listings and agree an exclusive mandate.",
  },
  {
    title: "Investors assess",
    desc: "Lead and Co-Investors access authorised project information; funds move outside the app.",
  },
  {
    title: "Buyer purchases",
    desc: "Approved listings reach retail buyers for enquiries, viewings and offers.",
  },
  {
    title: "Solicitor coordinates",
    desc: "Project agreements and external fund-status updates stay within the project-scoped Solicitor workflow.",
  },
];

/**
 * Marketing landing page — editorial/luxury layout: a full-bleed photographic
 * hero, display headings that pair a semibold phrase with a light one (the
 * weight contrast that replaced the roman/italic device when the serif went —
 * ADR-012), oversized figures, and staggered mosaics.
 *
 * Server-rendered end to end. Every figure, count and card is live data, so the
 * shop window can never drift from the marketplace it advertises.
 *
 * The portal list is deliberately not links — `/investor`, `/intel` and
 * `/ecosystem` are later-sprint routes, and a landing page whose links 404 is
 * worse than one that describes what is coming. `SiteHeader` remains the single
 * place those routes are wired up.
 */
export default async function Home() {
  const categoryCounts = await Promise.all(
    CATEGORIES.map((c) => searchService.count({ distressTags: c.tags })),
  );

  const tiles: CategoryTile[] = CATEGORIES.map((category, i) => ({
    label: category.label,
    count: categoryCounts[i],
    href: `/marketplace?tags=${category.tags.join(",")}`,
    image: category.image,
  }));

  return (
    <main className="flex flex-1 flex-col bg-background">
      {/* ================================================================ 1/6 */}
      {/* Hero — Light editorial landing matching reference image layout */}
      <HeroStage>
        <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center px-6 pt-24 pb-8 text-center sm:pt-28 sm:pb-10 lg:pt-32 lg:pb-12">
          {/* Eyebrow label */}
          <p
            className={`${RISE} flex items-center gap-3 text-[11px] font-semibold tracking-[0.24em] text-white/80 uppercase delay-[100ms]`}
          >
            <span aria-hidden className="h-px w-6 bg-white/35" />
            UK distressed property platform
            <span aria-hidden className="h-px w-6 bg-white/35" />
          </p>

          {/* Main headline */}
          <h1 className="font-display mt-5 max-w-3xl text-center text-[clamp(2.5rem,5.5vw,4.5rem)] leading-[1.05] font-semibold tracking-[-0.035em] text-white sm:mt-6">
            <Line>Redefining distressed</Line>
            <Line delay="delay-[110ms]">property investment</Line>
          </h1>

          {/* Supporting copy */}
          <p
            className={`${RISE} mt-5 max-w-2xl text-center text-base leading-relaxed text-pale/85 delay-[300ms] sm:text-lg`}
          >
            Private listings, verified access, disclosed defects and EPC ratings in one
            controlled pipeline.
          </p>

          {/* Primary CTAs */}
          <div
            className={`${RISE} mt-8 flex flex-wrap items-center justify-center gap-3.5 delay-[450ms]`}
          >
            <Link
              href="/marketplace"
              className="rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-primary shadow-md transition-all hover:bg-accent hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e4a55]"
            >
              Browse listings
            </Link>
            <Link
              href="/register"
              className="rounded-full border border-white/30 px-8 py-3.5 text-sm font-semibold text-white transition-all hover:border-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e4a55]"
            >
              Get started
            </Link>
          </div>
        </div>
      </HeroStage>

      {/* ================================================================ 2/6 */}
      {/* Core loop — Floating UI app card overlapping bottom of hero banner */}
      <section className="relative isolate z-10 -mt-16 sm:-mt-24 lg:-mt-32 overflow-visible bg-background pb-20 sm:pb-28">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-t-none rounded-b-[28px] sm:rounded-b-[36px] bg-white border border-line shadow-2xl p-6 sm:p-10 lg:p-12 relative overflow-hidden">
            {/* Filter & Portal Bar */}
            <div className="flex flex-col gap-4 border-b border-line/80 pb-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold tracking-[0.2em] text-muted uppercase">
                  Deal Workflow
                </p>
                <h3 className="font-display mt-1 text-lg font-semibold text-primary sm:text-xl">
                  One platform,{" "}
                  <span className="font-light text-secondary">whole deal</span>
                </h3>
              </div>

              {/* Filter pills matching reference preview card */}
              <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-surface/80 p-2 border border-line/60">
                <span className="flex items-center gap-2 rounded-xl bg-white px-3 py-1.5 text-xs font-medium text-primary shadow-xs">
                  <span className="h-2 w-2 rounded-full bg-accent" />
                  UK Distressed Stock
                </span>
                <span className="hidden sm:flex items-center gap-1.5 rounded-xl bg-white/70 px-3 py-1.5 text-xs font-medium text-muted">
                  Private until approved
                </span>
                <span className="hidden md:flex items-center gap-1.5 rounded-xl bg-white/70 px-3 py-1.5 text-xs font-medium text-muted">
                  Probate & Renovation
                </span>
                <Link
                  href="/marketplace"
                  className="rounded-xl bg-primary px-4 py-1.5 text-xs font-semibold text-white hover:bg-accent transition-colors"
                >
                  Browse marketplace
                </Link>
              </div>
            </div>

            {/* Core Loop 4 Steps Grid */}
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, i) => (
                <div
                  key={step.title}
                  className="group relative flex flex-col rounded-2xl border border-line/80 bg-surface/40 p-5 transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:bg-white hover:shadow-md"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-pale text-xs font-bold text-primary">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-[10px] font-semibold tracking-wider text-muted uppercase">
                      STEP {i + 1}
                    </span>
                  </div>
                  <h4 className="font-display mt-4 font-semibold text-primary text-base group-hover:text-accent transition-colors">
                    {step.title}
                  </h4>
                  <p className="mt-2 text-xs leading-relaxed text-muted">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================ 3/6 */}
      {/* Categories — split block with generous top and bottom padding */}
      <section className="relative overflow-hidden bg-primary pt-24 pb-28 sm:pt-32 sm:pb-36 lg:pt-40 lg:pb-44">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 lg:grid-cols-2 lg:gap-16">
          <div className="relative aspect-4/3 w-full overflow-hidden rounded-3xl shadow-2xl border border-white/10">
            <Image
              src={heroImage}
              alt="A scaffolded Georgian terrace mid-restoration, in fog"
              fill
              sizes="(min-width: 1024px) 40vw, 90vw"
              placeholder="blur"
              className="object-cover object-[30%_center]"
            />
          </div>

          <div>
            <p className="text-[11px] font-semibold tracking-[0.22em] text-pale/60 uppercase">
              By distress type
            </p>
            <h2 className="font-display mt-5 text-[clamp(2.25rem,4.6vw,3.75rem)] leading-[0.98] font-semibold tracking-[-0.03em] text-white">
              Buy the <span className="font-light">defect</span> you understand
            </h2>
            <p className="mt-6 max-w-md text-base leading-relaxed text-pale/75">
              Public listings carry disclosed defects and EPC ratings. Private
              opportunities remain restricted to authorised participants.
            </p>
            <Link
              href="/marketplace"
              className="mt-8 inline-block rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-primary transition-colors hover:bg-accent hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
            >
              Browse distressed listings
            </Link>
          </div>
        </div>

        <div className="mx-auto mt-20 w-full max-w-6xl px-6 sm:mt-24 lg:mt-28">
          <CategoryTiles tiles={tiles} />
        </div>
      </section>

      {/* ================================================================ 4/6 */}
      {/* Statement — the reference's light block: centred oversized type with a
          caption, and here the live figures beneath it. */}
      <section className="bg-surface py-28 sm:py-36">
        <div className="mx-auto w-full max-w-5xl px-6">
          <p className="text-center text-[11px] tracking-[0.22em] text-muted uppercase">
            About PropLink
          </p>
          <h2 className="font-display mt-6 text-center text-[clamp(2.25rem,5vw,4.25rem)] leading-[1] font-semibold tracking-[-0.03em] text-primary">
            We handle <span className="font-light">every stage</span> of a distressed UK
            deal
          </h2>
          <p className="mx-auto mt-7 max-w-xl text-center text-base leading-relaxed text-muted">
            Discovery, authorised project access and retail enquiries — with funds handled
            outside the platform.
          </p>
          <HeroStats />
        </div>
      </section>

      {/* ================================================================ 5/6 */}
      {/* Platform — connected ecosystem redesign with shared platform centerpiece */}
      <PlatformEcosystem />

      {/* ================================================================ 6/6 */}
      {/* Closing CTA — back to the `brand` band, as the reference closes. */}
      <section className="relative isolate overflow-hidden bg-brand py-28 sm:py-36">
        <RenderObject
          variant="loop"
          className="pointer-events-none absolute -right-16 -bottom-12 -z-10 h-80 w-80 opacity-60 sm:h-[26rem] sm:w-[26rem]"
        />
        <div className="mx-auto w-full max-w-4xl px-6">
          <h2 className="font-display max-w-2xl text-[clamp(2.25rem,5vw,4.25rem)] leading-[0.98] font-semibold tracking-[-0.03em] text-white">
            Start with the listings,{" "}
            <span className="font-light">or set up your account</span>
          </h2>
          <div className="mt-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <Link
              href="/register"
              className="w-full rounded-full bg-white px-9 py-4 text-center text-sm font-semibold text-primary transition-colors hover:bg-accent hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand sm:w-auto"
            >
              Get started
            </Link>
            <Link
              href="/marketplace"
              className="w-full rounded-full border border-white/35 px-9 py-4 text-center text-sm font-semibold text-white transition-colors hover:border-white hover:bg-white/10 sm:w-auto"
            >
              Browse listings
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
