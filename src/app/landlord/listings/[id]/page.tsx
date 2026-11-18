import Link from "next/link";
import { notFound } from "next/navigation";

import { getServerEnv } from "@/env";
import { KycStatus, LandlordListingStatus } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { db } from "@/lib/db";
import { PortalSection } from "@/components/portal/PortalShell";
import {
  EDITABLE,
  getOwnListing,
  missingForSubmission,
  WITHDRAWABLE,
} from "@/services/landlord/listings";
import { createDownloadLink } from "@/services/uploads/pipeline";

import { detachFileAction } from "../actions";
import { formatDate, STATUS_LABEL, STATUS_TONE } from "../status";
import {
  ConfirmAction,
  FileUploader,
  ListingFieldsForm,
  SubmitListing,
} from "./ListingEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Property — PropLink UK", robots: { index: false } };

const KIND_LABEL: Record<string, string> = {
  OWNERSHIP_DOCUMENT: "Ownership document",
  PHOTO: "Photo",
  DOCUMENT: "Document",
};

/**
 * One of the Landlord's own listings (Phase 2 Task 1, ADR-034). Loaded by
 * owner and ID; anyone else gets "not found".
 */
export default async function LandlordListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await requirePageRole("LANDLORD");
  const { id } = await params;
  const listing = await getOwnListing(user.authUserId, id);
  if (!listing) notFound();

  const editable = EDITABLE.includes(listing.status);
  const missing = missingForSubmission(listing, listing.files);
  const fileRows = await db.uploadedFile.findMany({
    where: { id: { in: listing.files.map((f) => f.fileId) } },
    select: { id: true, originalName: true },
  });
  const names = new Map(fileRows.map((f) => [f.id, f.originalName]));
  const files = await Promise.all(
    listing.files.map(async (file) => {
      const link = await createDownloadLink(
        { profileId: user.authUserId, role: user.role },
        file.fileId,
      );
      return {
        ...file,
        name: names.get(file.fileId) ?? "File",
        url: link.ok ? link.url : null,
      };
    }),
  );
  const awaitingConfirmation =
    listing.status === LandlordListingStatus.AWAITING_LANDLORD_CONFIRMATION;

  return (
    <>
      <p className="mb-4 text-sm">
        <Link href="/landlord/listings" className="text-accent underline">
          ← My properties
        </Link>
      </p>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold text-primary">{listing.title}</h2>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_TONE[listing.status]}`}
          data-testid="listing-status"
        >
          {STATUS_LABEL[listing.status]}
        </span>
      </div>

      {awaitingConfirmation && (
        <p
          role="status"
          className="mb-6 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm"
        >
          PropLink prepared this listing for you. Check every detail, add your ownership
          documents, then confirm to send it for review.
        </p>
      )}
      {listing.status === LandlordListingStatus.REJECTED && listing.rejectionReason && (
        <div
          role="status"
          className="mb-6 rounded-lg border border-danger/40 bg-danger/5 p-4 text-sm"
        >
          <p className="font-semibold text-danger">PropLink asked for changes</p>
          <p className="mt-1 text-body">{listing.rejectionReason}</p>
        </div>
      )}
      {listing.status === LandlordListingStatus.SUBMITTED && (
        <p
          role="status"
          className="mb-6 rounded-lg border border-line bg-white p-4 text-sm text-muted"
        >
          Submitted {formatDate(listing.submittedAt)}. PropLink usually reviews listings
          within 30–60 minutes; we&apos;ll notify you.
        </p>
      )}
      {listing.status === LandlordListingStatus.APPROVED && (
        <p
          role="status"
          className="mb-6 rounded-lg border border-success/40 bg-success/5 p-4 text-sm"
        >
          Approved. Verified agents can now see this listing and send you proposals. It
          stays private: never public, never in search.{" "}
          <Link
            href={`/landlord/listings/${listing.id}/proposals`}
            className="font-semibold text-primary underline"
          >
            Compare proposals
          </Link>
        </p>
      )}

      {editable ? (
        <PortalSection title="Details">
          <ListingFieldsForm
            aiAssistant={getServerEnv().AI_PROVIDER !== "disabled"}
            initial={{
              id: listing.id,
              title: listing.title,
              addressLine1: listing.addressLine1 ?? "",
              city: listing.city ?? "",
              postcode: listing.postcode ?? "",
              propertyKind: listing.propertyKind ?? "",
              propertyType: listing.propertyType ?? "",
              description: listing.description ?? "",
              defects: listing.defects ?? "",
              requiredWork: listing.requiredWork ?? "",
              landAreaSqm: listing.landAreaSqm ? String(listing.landAreaSqm) : "",
              desiredOutcome: listing.desiredOutcome ?? "",
            }}
          />
        </PortalSection>
      ) : (
        <PortalSection title="Details">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            {[
              [
                "Address",
                [listing.addressLine1, listing.city, listing.postcode]
                  .filter(Boolean)
                  .join(", "),
              ],
              [
                "Property or land",
                listing.propertyKind === "LAND" ? "Development land" : "Property",
              ],
              ["Type", listing.propertyType],
              [
                "Land area",
                listing.landAreaSqm
                  ? `${listing.landAreaSqm.toLocaleString("en-GB")} m²`
                  : null,
              ],
              [
                "Desired outcome",
                listing.desiredOutcome === "DEVELOPMENT_JV"
                  ? "Development joint venture"
                  : "Refurbishment",
              ],
              ["Description", listing.description],
              ["Known defects", listing.defects],
              ["Work required", listing.requiredWork],
            ].map(([label, value]) => (
              <div key={label} className="space-y-1">
                <dt className="text-xs tracking-wide text-muted uppercase">{label}</dt>
                <dd className="whitespace-pre-line text-body">{value || "—"}</dd>
              </div>
            ))}
          </dl>
        </PortalSection>
      )}

      <PortalSection title="Photos and documents">
        {files.length === 0 ? (
          <p className="mb-4 text-sm text-muted">Nothing attached yet.</p>
        ) : (
          <ul className="mb-4 divide-y divide-line rounded-lg border border-line bg-white">
            {files.map((file) => (
              <li
                key={file.fileId}
                className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
              >
                <span>
                  <span className="block font-medium text-primary">{file.name}</span>
                  <span className="text-xs text-muted">{KIND_LABEL[file.kind]}</span>
                </span>
                <span className="flex items-center gap-4">
                  {file.url && (
                    <a
                      href={file.url}
                      className="text-xs font-semibold text-accent underline"
                    >
                      Download
                    </a>
                  )}
                  {editable && (
                    <form action={detachFileAction}>
                      <input type="hidden" name="listingId" value={listing.id} />
                      <input type="hidden" name="fileId" value={file.fileId} />
                      <button
                        type="submit"
                        className="text-xs font-semibold text-danger underline"
                      >
                        Remove
                      </button>
                    </form>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {editable && <FileUploader listingId={listing.id} />}
      </PortalSection>

      {editable && (
        <PortalSection
          title={awaitingConfirmation ? "Confirm and submit" : "Submit for review"}
        >
          {missing.length > 0 ? (
            <div className="mb-4 text-sm">
              <p className="font-medium text-primary">
                Still needed before you can submit:
              </p>
              <ul
                className="mt-2 list-disc space-y-1 pl-5 text-muted"
                data-testid="missing-list"
              >
                {missing.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mb-4 text-sm text-muted">
              Everything&apos;s in place. PropLink will review it, usually within 30–60
              minutes, before verified agents can see it.
            </p>
          )}
          {user.kycStatus !== KycStatus.APPROVED && (
            <p className="mb-4 text-sm text-warning">
              You&apos;ll need to finish your identity check (see Overview) before
              submitting.
            </p>
          )}
          <SubmitListing
            id={listing.id}
            label={awaitingConfirmation ? "Confirm and submit" : "Submit for review"}
          />
        </PortalSection>
      )}

      <div className="mt-10 flex flex-wrap gap-4">
        {WITHDRAWABLE.includes(listing.status) && (
          <ConfirmAction id={listing.id} title={listing.title} action="withdraw" />
        )}
        {listing.status === LandlordListingStatus.DRAFT &&
          listing.createdBy === user.authUserId &&
          !listing.submittedAt && (
            <ConfirmAction id={listing.id} title={listing.title} action="delete" />
          )}
      </div>
    </>
  );
}
