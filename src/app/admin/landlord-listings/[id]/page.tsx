import { notFound } from "next/navigation";

import { StatusBadge } from "@/components/admin/StatusBadge";
import {
  DetailColumns,
  DetailHeader,
  DetailTabs,
  FactList,
  KeyFacts,
  Panel,
  TabBody,
  pickTab,
  type DetailTab,
} from "@/components/portal/Detail";
import { Badge } from "@/components/ui/badge";
import { KycStatus, LandlordListingStatus, Role } from "@/generated/prisma/enums";
import { requireAdminPagePermission } from "@/lib/authz";
import { db } from "@/lib/db";
import { getListingForReview, slaFor } from "@/services/landlord/reviewQueue";
import { createDownloadLink } from "@/services/uploads/pipeline";

import { DecisionControls, HoldControls } from "./ReviewControls";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Admin — Review Landlord listing | PropLink",
  robots: { index: false },
};

const KIND_LABEL: Record<string, string> = {
  OWNERSHIP_DOCUMENT: "Ownership document",
  PHOTO: "Photo",
  DOCUMENT: "Other document",
};
const OUTCOME_LABEL: Record<string, string> = {
  REFURBISHMENT: "Refurbishment",
  DEVELOPMENT_JV: "Development joint venture",
};

function when(value: Date | null): string {
  return value ? value.toISOString().slice(0, 16).replace("T", " ") : "—";
}

/**
 * One Landlord listing under review (Phase 2 Task 3, ADR-037), in tabs
 * (ADR-080): Review & details · Files · History.
 */
export default async function ReviewLandlordListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await requireAdminPagePermission("LISTING_MODERATION");
  const me = session.user.authUserId;
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const listing = await getListingForReview(id);
  if (!listing) notFound();

  const waiting = listing.status === LandlordListingStatus.SUBMITTED;
  const admins = waiting
    ? await db.profile.findMany({
        where: { role: Role.ADMIN, active: true, id: { not: me } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 50,
      })
    : [];
  const files = await Promise.all(
    listing.files.map(async (file) => {
      const link = await createDownloadLink(
        { profileId: me, role: Role.ADMIN },
        file.fileId,
        { inline: file.kind === "PHOTO" },
      );
      return { ...file, url: link.ok ? link.url : null };
    }),
  );
  const sla = listing.submittedAt ? slaFor(listing.submittedAt) : null;
  const heldBy = !listing.claimedBy
    ? "nobody"
    : listing.claimedBy === me
      ? "me"
      : "other";
  const kycApproved =
    listing.owner.kycStatus === KycStatus.APPROVED && listing.owner.active;
  const statusTone =
    listing.status === LandlordListingStatus.APPROVED
      ? "success"
      : listing.status === LandlordListingStatus.REJECTED
        ? "danger"
        : "warning";
  const path = `/admin/landlord-listings/${listing.id}`;
  const photos = files.filter((file) => file.kind === "PHOTO").length;
  const hasOwnership = files.some((file) => file.kind === "OWNERSHIP_DOCUMENT");

  const tabs: DetailTab[] = [
    { key: "review", label: waiting ? "Review" : "Details", attention: waiting },
    { key: "files", label: "Files", count: files.length },
  ];
  if (listing.reviews.length > 0) {
    tabs.push({
      key: "history",
      label: "Earlier decisions",
      count: listing.reviews.length,
    });
  }
  const tab = pickTab(query.tab, tabs);

  return (
    <div>
      <h1 className="sr-only">Review Landlord listing</h1>
      <DetailHeader
        back={{ href: "/admin/landlord-listings", label: "Back to queue" }}
        eyebrow="Landlord listing"
        title={listing.title}
        badges={
          <>
            <Badge tone={statusTone}>{listing.status.replace(/_/g, " ")}</Badge>
            {sla?.state === "overdue" && waiting ? (
              <Badge tone="danger">Over the 60-minute limit</Badge>
            ) : null}
            {kycApproved ? null : <Badge tone="warning">Landlord not verified</Badge>}
            {hasOwnership ? null : <Badge tone="warning">No ownership document</Badge>}
          </>
        }
        subtitle={[listing.city, listing.postcode].filter(Boolean).join(", ")}
      />

      <KeyFacts
        items={[
          { label: "Submitted (UTC)", value: when(listing.submittedAt) },
          {
            label: "Waiting",
            value: waiting && sla ? `${sla.minutes} min` : "—",
            hint: waiting ? "Limit: 60 minutes" : undefined,
          },
          {
            label: "Held by",
            value:
              heldBy === "me"
                ? "You"
                : heldBy === "other"
                  ? (listing.claimer?.name ?? "Another Admin")
                  : "Nobody",
          },
          { label: "Files", value: files.length, hint: `${photos} photo(s)` },
        ]}
      />

      <DetailTabs basePath={path} tabs={tabs} current={tab} label="Listing sections" />

      {tab === "review" && (
        <TabBody>
          <DetailColumns
            main={
              <>
                {waiting && (
                  <Panel
                    title="Your decision"
                    tone="attention"
                    description={
                      heldBy === "other"
                        ? `Held by ${listing.claimer?.name ?? "another Admin"} since ${when(listing.claimedAt)} UTC. Only they can decide while they hold it.`
                        : "Claim it so nobody else reviews it at the same time, then approve or send it back."
                    }
                  >
                    <div className="space-y-4">
                      <HoldControls
                        id={listing.id}
                        heldBy={heldBy}
                        admins={admins.map((admin) => ({
                          id: admin.id,
                          name: admin.name ?? "Admin",
                        }))}
                      />
                      {heldBy !== "other" && (
                        <DecisionControls id={listing.id} kycApproved={kycApproved} />
                      )}
                    </div>
                  </Panel>
                )}
                <Panel title="The property">
                  <FactList
                    items={[
                      {
                        label: "Address",
                        value: [listing.addressLine1, listing.city, listing.postcode]
                          .filter(Boolean)
                          .join(", "),
                      },
                      {
                        label: "Kind",
                        value: [
                          listing.propertyKind === "LAND" ? "Land" : "Property",
                          listing.propertyType,
                        ]
                          .filter(Boolean)
                          .join(" · "),
                      },
                      {
                        label: "Land area",
                        value: listing.landAreaSqm ? `${listing.landAreaSqm} m²` : null,
                      },
                      {
                        label: "Desired outcome",
                        value: listing.desiredOutcome
                          ? OUTCOME_LABEL[listing.desiredOutcome]
                          : null,
                      },
                      { label: "Description", value: listing.description, wide: true },
                      { label: "Known defects", value: listing.defects },
                      { label: "Work required", value: listing.requiredWork },
                    ]}
                  />
                </Panel>
              </>
            }
            side={
              <Panel title="Landlord" tone={kycApproved ? "default" : "attention"}>
                <FactList
                  columns={2}
                  items={[
                    {
                      label: "Name",
                      value: listing.owner.name ?? "Landlord",
                      wide: true,
                    },
                    {
                      label: "Identity check",
                      value: <StatusBadge status={listing.owner.kycStatus} />,
                      wide: true,
                    },
                    {
                      label: "Created by",
                      value:
                        listing.creator.id === listing.owner.id
                          ? "The Landlord"
                          : `Admin on the Landlord's behalf (${listing.creator.name ?? "Admin"}); Landlord confirmed`,
                      wide: true,
                    },
                  ]}
                />
                {!listing.owner.active && (
                  <p className="mt-3 text-sm text-danger">
                    This Landlord&apos;s account is suspended.
                  </p>
                )}
              </Panel>
            }
          />
        </TabBody>
      )}

      {tab === "files" && (
        <TabBody>
          <Panel
            title="Files"
            description="Photos, the ownership document and anything else the Landlord attached."
          >
            {files.length === 0 ? (
              <p className="text-sm text-muted">No files attached.</p>
            ) : (
              <ul className="divide-y divide-line">
                {files.map((file) => (
                  <li
                    key={file.fileId}
                    className="flex flex-wrap items-center gap-3 py-2 text-sm"
                  >
                    <StatusBadge
                      status={file.kind}
                      label={KIND_LABEL[file.kind]}
                      tone="neutral"
                    />
                    {file.url ? (
                      <a
                        href={file.url}
                        className="text-accent underline underline-offset-2"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {file.upload?.originalName ?? "Open file"}
                      </a>
                    ) : (
                      <span className="text-muted">
                        {file.upload?.originalName ?? "File"} (unavailable)
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </TabBody>
      )}

      {tab === "history" && (
        <TabBody>
          <Panel title="Earlier decisions">
            <ul className="space-y-3 text-sm">
              {listing.reviews.map((review) => (
                <li
                  key={review.id}
                  className="border-t border-line pt-3 first:border-0 first:pt-0"
                >
                  <StatusBadge status={review.decision} /> {when(review.decidedAt)} UTC by{" "}
                  {review.reviewer.name ?? "Admin"}
                  {review.reason && <p className="mt-1 text-muted">{review.reason}</p>}
                </li>
              ))}
            </ul>
          </Panel>
        </TabBody>
      )}
    </div>
  );
}
