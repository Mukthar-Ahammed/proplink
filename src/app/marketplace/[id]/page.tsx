import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import type { Role } from "@/generated/prisma/enums";
import {
  getListingCoordinates,
  getListingForPublicView,
  isPubliclyVisibleStatus,
} from "@/services/listings/listingService";
import { getAgentProfilePublic } from "@/services/agents/agentProfileService";
import { VerifiedBadge } from "@/components/profiles/VerifiedBadge";
import { ReportPanel } from "@/components/cases/ReportPanel";
import { SITE_URL } from "@/lib/siteUrl";
import { listingStructuredData, serializeJsonLd } from "@/services/search/publicListings";
import { staticMapService } from "@/services/maps";
import { DISTRESS_TAG_OPTIONS, formatPenceGBP } from "@/components/listings/wizardTypes";
import { Badge, EpcBadge } from "@/components/ui/badge";
import {
  PropertyGallery,
  type GalleryImage,
} from "@/components/marketplace/PropertyGallery";
import { PropertyMap } from "@/components/marketplace/PropertyMap";
import { EnquiryForm } from "@/components/marketplace/EnquiryForm";
import { ViewTracker } from "@/components/marketplace/ViewTracker";
import { SaveButton } from "@/components/marketplace/SaveButton";
import { BuyerActions } from "@/components/buy/BuyerActions";
import { PriceHistory } from "@/components/buy/PriceHistory";
import { getComparables } from "@/services/intel/comparables";
import { postcodeDistrict } from "@/lib/postcode";
import { isListingSavedBy } from "@/services/listings/savedProperties";
import { isFinancialPromotionsReviewed } from "@/env";
import { canSeeExactLocation } from "@/services/listings/locationVisibility";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function getViewer(): Promise<{ userId: string; role: Role } | null> {
  const session = await auth();
  return session?.user ? { userId: session.user.id, role: session.user.role } : null;
}

function buildMetaDescription(listing: {
  propertyType: string;
  city: string;
  postcode: string;
  askingPriceGBP: number;
  description: string;
}): string {
  const price = formatPenceGBP(listing.askingPriceGBP);
  const excerpt =
    listing.description.length > 140
      ? `${listing.description.slice(0, 137)}...`
      : listing.description;
  // Metadata is public and crawled: postcode district only, never the full postcode.
  return `${price} — ${listing.propertyType} in ${listing.city}, ${postcodeDistrict(listing.postcode)}. ${excerpt}`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const viewer = await getViewer();
  const listing = await getListingForPublicView({ propertyId: id, viewer });
  if (!listing) return { title: "Listing not found" };

  const description = buildMetaDescription(listing);
  const canonicalPath = `/marketplace/${id}`;
  const firstImage = listing.images[0]?.url;

  return {
    title: listing.title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title: listing.title,
      description,
      url: canonicalPath,
      type: "website",
      ...(firstImage ? { images: [{ url: firstImage }] } : {}),
    },
    // A preview (owner/admin viewing a non-public listing) must never be indexed.
    ...(isPubliclyVisibleStatus(listing.status)
      ? {}
      : { robots: { index: false, follow: false } }),
  };
}

/**
 * Public property detail page (Task 2.5 brief) — SSR, `generateMetadata`
 * (title/description/OpenGraph/canonical). Visibility is enforced in
 * `getListingForPublicView` (LIVE/UNDER_OFFER/SOLD are public; a DRAFT/
 * PENDING_REVIEW listing is visible only to its owning agent or an admin
 * previewing it) — everyone else gets `null` here and the page 404s, never a
 * 403 (doesn't leak that the id exists).
 */
export default async function PropertyDetailPage({ params }: PageProps) {
  const { id } = await params;
  const session = await auth();
  const viewer = session?.user
    ? { userId: session.user.id, role: session.user.role }
    : null;

  const listing = await getListingForPublicView({ propertyId: id, viewer });
  if (!listing) notFound();

  // Exact address, full postcode and map pin need a signed-in (email-verified)
  // viewer; everyone else sees town, region and postcode district (ADR-022).
  const exactLocation = canSeeExactLocation(viewer);

  const [coordinates, agentProfile] = await Promise.all([
    exactLocation ? getListingCoordinates(id) : Promise.resolve(null),
    listing.agentProfileId
      ? getAgentProfilePublic(listing.agentProfileId)
      : Promise.resolve(null),
  ]);

  const images: GalleryImage[] = listing.images.map((img, i) => ({
    url: img.url,
    alt: `${listing.title} — photo ${i + 1} of ${listing.images.length}`,
  }));

  const addressLabel = `${listing.addressLine1}, ${listing.city}`;
  const tagLabels = listing.distressTags.map(
    (t) => DISTRESS_TAG_OPTIONS.find((o) => o.value === t.tag)?.label ?? t.tag,
  );

  const sessionUser = session?.user
    ? {
        name: session.user.name ?? session.user.email ?? "You",
        email: session.user.email ?? "",
      }
    : null;

  const isPublic = isPubliclyVisibleStatus(listing.status);
  const financialPromotionsReviewed = isFinancialPromotionsReviewed();
  const showRoi = financialPromotionsReviewed && listing.targetRoiPct != null;

  // Task 2.6: saving is a demand-side signal, so only BUYER/INVESTOR see the
  // toggle — the route enforces the same rule, this just avoids offering an
  // action that would 403.
  const canSave = isPublic && (viewer?.role === "BUYER" || viewer?.role === "INVESTOR");

  // Land Registry comparables for this listing's postcode district. Null until
  // the district has any — the ingest is H5.4 and the seeded rows are samples.
  const comparables = await getComparables(postcodeDistrict(listing.postcode));
  const alreadySaved = canSave
    ? await isListingSavedBy({ userId: viewer.userId, propertyId: listing.id })
    : false;

  const statusLabel =
    listing.status === "UNDER_OFFER"
      ? "Under offer"
      : listing.status === "SOLD"
        ? "Sold"
        : isPublic
          ? "For sale"
          : listing.status;

  return (
    // `<main>`, not a plain `<div>`: this page is indexed, and the Lighthouse
    // a11y audit flags a missing main landmark (`landmark-one-main`).
    // Layout follows ADR-071: a two-column body with the gallery and facts
    // on the left and a sticky action rail (price first) on the right.
    <main className="mx-auto w-full max-w-7xl px-4 pt-6 pb-16 sm:px-6 lg:px-8">
      {/* Structured data (Phase 5 Task 6, ADR-057): public fields only, for
          listings that are for sale. serializeJsonLd escapes "<", so listing
          text cannot close the script element. */}
      {isPublic && (listing.status === "LIVE" || listing.status === "UNDER_OFFER") && (
        <script
          type="application/ld+json"
          data-testid="listing-jsonld"
          // nosemgrep: react-dangerouslysetinnerhtml -- JSON-LD from public fields, serialised with < and line separators escaped (ADR-057); reviewed Phase 7.
          dangerouslySetInnerHTML={{
            __html: serializeJsonLd(
              listingStructuredData(
                {
                  id: listing.id,
                  title: listing.title,
                  city: listing.city,
                  region: listing.region,
                  postcode: listing.postcode,
                  askingPriceGBP: listing.askingPriceGBP,
                  status: listing.status,
                  bedrooms: listing.bedrooms,
                  imageUrl: listing.images[0]?.url ?? null,
                },
                SITE_URL,
              ),
            ),
          }}
        />
      )}
      {!isPublic && (
        <p
          role="status"
          className="mb-6 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm font-medium text-warning"
        >
          Preview — this listing is {listing.status} and not yet publicly visible.
        </p>
      )}

      <Link
        href="/marketplace"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-strong"
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
        Back to search
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-primary sm:text-3xl">
              {listing.title}
            </h1>
            <span className="rounded-full bg-pale px-3 py-1 text-xs font-semibold text-accent">
              {statusLabel}
            </span>
          </div>
          {exactLocation ? (
            <address className="mt-2 text-sm not-italic text-muted">
              {listing.addressLine1}, {listing.city}, {listing.region}, {listing.postcode}
            </address>
          ) : (
            <p className="mt-2 text-sm text-muted">
              {listing.city}, {listing.region}, {postcodeDistrict(listing.postcode)}
              <span className="ml-2 text-xs" data-testid="address-hidden">
                <Link
                  href={`/login?callbackUrl=${encodeURIComponent(`/marketplace/${listing.id}`)}`}
                  className="font-medium text-accent hover:underline"
                >
                  Sign in
                </Link>{" "}
                to see the full address and map.
              </span>
            </p>
          )}
        </div>
        {canSave && <SaveButton propertyId={listing.id} initialSaved={alreadySaved} />}
        {/* Signed out: prompt to sign in and come back to this listing (Phase 5 Task 2). */}
        {isPublic && !viewer && (
          <Link
            href={`/login?callbackUrl=${encodeURIComponent(`/marketplace/${listing.id}`)}`}
            data-testid="save-signin"
            className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-primary transition-colors hover:border-accent hover:text-accent"
          >
            ☆ Sign in to save
          </Link>
        )}
      </div>

      {/* Counted server-side and deduped per session — see analytics.ts. */}
      {isPublic && <ViewTracker propertyId={listing.id} />}

      {/* Gallery and facts share the left column and the action rail sits
          beside them from the top, so the photo is sized to the column (not the
          full page width) and the rail fills the space next to it. */}
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ------------------------------------------------------ facts */}
        <div className="min-w-0 space-y-8">
          <PropertyGallery images={images} />

          <dl
            className={`grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-line bg-line ${showRoi ? "sm:grid-cols-5 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1" : "sm:grid-cols-4"}`}
          >
            <Highlight label="Property type" value={listing.propertyType} />
            <Highlight label="Bedrooms" value={String(listing.bedrooms)} />
            <Highlight
              label="EPC rating"
              value={listing.epcRating ? `Band ${listing.epcRating}` : "Pending"}
            />
            <Highlight label="Region" value={listing.region} />
            {showRoi && (
              <div className="bg-white px-5 py-4">
                <dt className="text-xs text-muted">Target ROI</dt>
                <dd
                  data-testid="target-roi"
                  className="mt-1 text-sm font-semibold text-primary"
                >
                  {listing.targetRoiPct}%
                </dd>
              </div>
            )}
          </dl>

          <section>
            <h2 className="text-lg font-semibold text-primary">Description</h2>
            <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap text-body">
              {listing.description}
            </p>
          </section>

          {coordinates && (
            <section>
              <h2 className="text-lg font-semibold text-primary">Location</h2>
              <div className="mt-4">
                <PropertyMap
                  mapImageUrl={staticMapService.getMapImageUrl(coordinates)}
                  satelliteImageUrl={staticMapService.getSatelliteImageUrl(coordinates)}
                  streetViewImageUrl={staticMapService.getStreetViewImageUrl(coordinates)}
                  addressLabel={addressLabel}
                  coordinates={coordinates}
                />
              </div>
            </section>
          )}

          {comparables ? (
            <PriceHistory data={comparables} />
          ) : (
            <section className="flex items-center justify-between gap-4 rounded-3xl border border-line bg-surface px-6 py-5">
              <div>
                <h2 className="text-sm font-semibold text-primary">Price history</h2>
                <p className="mt-0.5 text-sm text-muted">
                  No comparable sales recorded for this postcode district yet.
                </p>
              </div>
            </section>
          )}
        </div>

        {/* ------------------------------------------------- action rail */}
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          {/* Price summary heads the rail, level with the gallery. */}
          <section
            aria-label="Price and key facts"
            className="rounded-3xl border border-line bg-white p-6"
          >
            <p className="flex items-center gap-2 text-sm font-medium text-muted">
              <span aria-hidden className="h-2 w-2 rounded-full bg-accent" />
              Asking price
            </p>
            <p
              data-testid="asking-price"
              className="mt-1 text-3xl font-semibold tracking-tight text-primary"
            >
              {formatPenceGBP(listing.askingPriceGBP)}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <EpcBadge rating={listing.epcRating} />
              <span className="rounded-full border border-line px-3 py-1 text-xs font-medium text-body">
                {listing.bedrooms} bed
              </span>
              <span className="rounded-full border border-line px-3 py-1 text-xs font-medium text-body">
                {listing.propertyType}
              </span>
            </div>
            {tagLabels.length > 0 && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="text-xs text-muted">Disclosed condition</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {tagLabels.map((label) => (
                    <Badge key={label} tone="warning">
                      {label}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Buyer-only write actions (ADR-017). The server decides who sees
              these and each route re-authorises, so rendering the panel is
              never what permits the action. */}
          {isPublic && viewer?.role === "BUYER" && (
            <BuyerActions
              propertyId={listing.id}
              askingPriceGBP={listing.askingPriceGBP}
            />
          )}

          {isPublic && (
            <section
              aria-label="Contact the agent"
              className="rounded-3xl border border-line bg-white p-6"
            >
              <h2 className="text-lg font-semibold text-primary">
                Interested in this property?
              </h2>
              <p className="mt-1 text-sm text-muted">Send the agent a message.</p>
              <div className="mt-4">
                <EnquiryForm propertyId={listing.id} sessionUser={sessionUser} />
              </div>
            </section>
          )}

          {agentProfile && (
            <section
              aria-label="Listing agent"
              className="rounded-3xl border border-line bg-white p-6"
            >
              <p className="text-lg font-semibold text-primary">Agent information</p>
              <div className="mt-4 flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-pale text-lg font-semibold text-accent"
                >
                  {agentProfile.agencyName.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-primary">
                    <Link
                      href={`/agents/${agentProfile.id}`}
                      className="hover:text-accent"
                    >
                      {agentProfile.agencyName}
                    </Link>
                    {agentProfile.verified && (
                      <VerifiedBadge className="ml-2 align-middle" />
                    )}
                  </p>
                  {agentProfile.ratingCount > 0 ? (
                    <p data-testid="agent-card-rating" className="text-sm text-body">
                      ★ {agentProfile.ratingAverage?.toFixed(1)}{" "}
                      <span className="text-muted">
                        ({agentProfile.ratingCount} review
                        {agentProfile.ratingCount === 1 ? "" : "s"})
                      </span>
                    </p>
                  ) : (
                    <p className="text-sm text-muted">No reviews yet</p>
                  )}
                </div>
              </div>
              <Link
                href={`/agents/${agentProfile.id}`}
                className="mt-5 flex w-full items-center justify-center rounded-full bg-pale py-3 text-sm font-semibold text-accent transition-colors hover:bg-accent hover:text-white"
              >
                View agency profile
              </Link>
            </section>
          )}
        </aside>
      </div>

      <div className="mt-12 space-y-6">
        <p
          className="rounded-2xl border border-line bg-surface p-4 text-xs leading-relaxed text-muted"
          data-testid="ag6-notice"
        >
          Conveyancing, legal agreements and contract responsibilities for this sale are
          handled by the listing agent. Where a property was refurbished through a PropLink
          investment project, the investment side is handled by that project&apos;s
          Solicitor. PropLink does not hold or move purchase money.
        </p>

        {/* Phase 6 Task 3 (ADR-059): signed-in members may report a listing. */}
        {isPublic && viewer && (
          <ReportPanel
            subjectType="LISTING"
            subjectId={listing.id}
            label="Report this listing"
          />
        )}
      </div>
    </main>
  );
}

function Highlight({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-5 py-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-primary">{value}</dd>
    </div>
  );
}
