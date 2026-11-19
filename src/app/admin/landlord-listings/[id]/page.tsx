import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm whitespace-pre-line text-body">{value || "—"}</dd>
    </div>
  );
}

/** One Landlord listing under review (Phase 2 Task 3, ADR-037). */
export default async function ReviewLandlordListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdminPagePermission("LISTING_MODERATION");
  const me = session.user.authUserId;
  const { id } = await params;
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

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={listing.title}
        description={[listing.city, listing.postcode].filter(Boolean).join(", ")}
        badge={{
          label: listing.status.replace(/_/g, " "),
          tone:
            listing.status === LandlordListingStatus.APPROVED
              ? "success"
              : listing.status === LandlordListingStatus.REJECTED
                ? "danger"
                : "warning",
        }}
        action={
          <Link
            href="/admin/landlord-listings"
            className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-primary"
          >
            Back to queue
          </Link>
        }
      />

      {waiting && (
        <Card>
          <CardTitle>Review</CardTitle>
          <CardBody className="space-y-4">
            <p className="text-sm text-body">
              Submitted {when(listing.submittedAt)} UTC
              {sla && ` · waiting ${sla.minutes} min`}
              {sla?.state === "overdue" && (
                <span className="ml-2 font-semibold text-danger">
                  over the 60-minute limit
                </span>
              )}
              {" · "}
              {heldBy === "me"
                ? "held by you"
                : heldBy === "other"
                  ? `held by ${listing.claimer?.name ?? "another Admin"} since ${when(listing.claimedAt)}`
                  : "unclaimed"}
            </p>
            <HoldControls
              id={listing.id}
              heldBy={heldBy}
              admins={admins.map((admin) => ({
                id: admin.id,
                name: admin.name ?? "Admin",
              }))}
            />
            {heldBy !== "other" && (
              <DecisionControls
                id={listing.id}
                kycApproved={
                  listing.owner.kycStatus === KycStatus.APPROVED && listing.owner.active
                }
              />
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardTitle>Listing</CardTitle>
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Row
              label="Address"
              value={[listing.addressLine1, listing.city, listing.postcode]
                .filter(Boolean)
                .join(", ")}
            />
            <Row
              label="Kind"
              value={[
                listing.propertyKind === "LAND" ? "Land" : "Property",
                listing.propertyType,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
            <Row
              label="Land area"
              value={listing.landAreaSqm ? `${listing.landAreaSqm} m²` : null}
            />
            <Row
              label="Desired outcome"
              value={
                listing.desiredOutcome ? OUTCOME_LABEL[listing.desiredOutcome] : null
              }
            />
            <div className="sm:col-span-2">
              <Row label="Description" value={listing.description} />
            </div>
            <Row label="Known defects" value={listing.defects} />
            <Row label="Work required" value={listing.requiredWork} />
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardTitle>Landlord</CardTitle>
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Row label="Name" value={listing.owner.name ?? "Landlord"} />
            <Row
              label="Identity check"
              value={<StatusBadge status={listing.owner.kycStatus} />}
            />
            <Row
              label="Created by"
              value={
                listing.creator.id === listing.owner.id
                  ? "The Landlord"
                  : `Admin on the Landlord's behalf (${listing.creator.name ?? "Admin"}); Landlord confirmed`
              }
            />
          </dl>
          {!listing.owner.active && (
            <p className="mt-3 text-sm text-danger">
              This Landlord&apos;s account is suspended.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardTitle>Files</CardTitle>
        <CardBody>
          {files.length === 0 ? (
            <p className="text-sm text-muted">No files attached.</p>
          ) : (
            <ul className="space-y-2">
              {files.map((file) => (
                <li
                  key={file.fileId}
                  className="flex flex-wrap items-center gap-3 text-sm"
                >
                  <StatusBadge
                    status={file.kind}
                    label={KIND_LABEL[file.kind]}
                    tone="neutral"
                  />
                  {file.url ? (
                    <a
                      href={file.url}
                      className="text-primary underline underline-offset-2"
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
        </CardBody>
      </Card>

      {listing.reviews.length > 0 && (
        <Card>
          <CardTitle>Earlier decisions</CardTitle>
          <CardBody>
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
          </CardBody>
        </Card>
      )}
    </div>
  );
}
