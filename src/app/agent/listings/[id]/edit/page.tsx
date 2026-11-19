import { requirePageRole } from "@/lib/authz";
import { getOwnedListing } from "@/services/listings/listingService";
import { ListingServiceError } from "@/services/listings/errors";
import { ListingWizard } from "@/components/listings/ListingWizard";
import {
  penceToPoundsInput,
  type WizardFormState,
} from "@/components/listings/wizardTypes";
import {
  ArrowLink,
  InvestorEmpty,
  InvestorSectionTitle,
  PrimaryLink,
} from "@/components/investor/InvestorUi";

export const metadata = { title: "Agent — Edit listing" };

type OwnedListing = Awaited<ReturnType<typeof getOwnedListing>>;

function toWizardState(listing: OwnedListing): WizardFormState {
  if (!listing.agentProfileId) {
    throw new ListingServiceError("Agent listing not found", "NOT_FOUND");
  }
  return {
    id: listing.id,
    agentProfileId: listing.agentProfileId,
    title: listing.title,
    description: listing.description,
    addressLine1: listing.addressLine1,
    city: listing.city,
    region: listing.region,
    postcode: listing.postcode,
    propertyType: listing.propertyType,
    bedrooms: listing.bedrooms,
    askingPricePounds: penceToPoundsInput(listing.askingPriceGBP),
    targetRoiPct: listing.targetRoiPct == null ? "" : String(listing.targetRoiPct),
    distressTags: listing.distressTags.map((t) => t.tag),
    pricingSafeguardAck: listing.pricingSafeguardAckAt != null,
    epcRating: listing.epcRating ?? "",
    epcCertUrl: listing.epcCertUrl,
    floorPlanUrl: listing.floorPlanUrl,
    images: listing.images.map((img) => ({ url: img.url, sortOrder: img.sortOrder })),
  };
}

function NoticeCard({ title, body }: { title: string; body: string }) {
  return (
    <InvestorEmpty
      title={title}
      action={<PrimaryLink href="/agent/listings">Back to your listings</PrimaryLink>}
    >
      {body}
    </InvestorEmpty>
  );
}

export default async function EditListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requirePageRole("AGENT");

  let listing: OwnedListing;
  try {
    listing = await getOwnedListing({ userId: session.user.id, propertyId: id });
  } catch (err) {
    const message =
      err instanceof ListingServiceError
        ? err.message
        : "Something went wrong loading this listing.";
    return <NoticeCard title="Can't open this listing" body={message} />;
  }

  if (listing.status !== "DRAFT") {
    return (
      <NoticeCard
        title="This listing is no longer editable here"
        body={`"${listing.title}" is ${listing.status.replace("_", " ").toLowerCase()}. Only draft listings can be edited from this form.`}
      />
    );
  }

  if (!listing.agentProfile) {
    return (
      <NoticeCard
        title="Can't open this listing"
        body="This listing is not assigned to your Agent profile."
      />
    );
  }

  return (
    <section className="space-y-8">
      <InvestorSectionTitle
        title="Edit"
        tail="draft"
        description={listing.title}
        action={<ArrowLink href="/agent/listings">Your listings</ArrowLink>}
      />
      <ListingWizard
        agentProfiles={[
          { id: listing.agentProfile.id, agencyName: listing.agentProfile.agencyName },
        ]}
        initial={toWizardState(listing)}
      />
    </section>
  );
}
