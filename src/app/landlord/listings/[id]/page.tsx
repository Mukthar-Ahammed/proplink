import Link from "next/link";
import { notFound } from "next/navigation";

import { getServerEnv } from "@/env";
import { KycStatus, LandlordListingStatus } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { db } from "@/lib/db";
import {
  AlertIcon,
  ArrowIcon,
  CheckIcon,
  ClockIcon,
  FileIcon,
  HomeIcon,
  IconChip,
  InvestorSectionTitle,
  PenIcon,
  StatusPill,
} from "@/components/investor/InvestorUi";
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
      const actor = { profileId: user.authUserId, role: user.role };
      const [link, preview] = await Promise.all([
        createDownloadLink(actor, file.fileId),
        // Photos get a second, inline link for the thumbnail. The pipeline only
        // honours "inline" for files it verified as images; anything else stays
        // an attachment, so a bad file never renders.
        file.kind === "PHOTO"
          ? createDownloadLink(actor, file.fileId, { inline: true })
          : Promise.resolve(null),
      ]);
      return {
        ...file,
        name: names.get(file.fileId) ?? "File",
        url: link.ok ? link.url : null,
        previewUrl: preview?.ok ? preview.url : null,
      };
    }),
  );
  const awaitingConfirmation =
    listing.status === LandlordListingStatus.AWAITING_LANDLORD_CONFIRMATION;

  const details: [string, string | null][] = [
    [
      "Address",
      [listing.addressLine1, listing.city, listing.postcode].filter(Boolean).join(", "),
    ],
    [
      "Property or land",
      listing.propertyKind === "LAND" ? "Development land" : "Property",
    ],
    ["Type", listing.propertyType],
    [
      "Land area",
      listing.landAreaSqm ? `${listing.landAreaSqm.toLocaleString("en-GB")} m²` : null,
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
  ];
  const canDelete =
    listing.status === LandlordListingStatus.DRAFT &&
    listing.createdBy === user.authUserId &&
    !listing.submittedAt;
  const canWithdraw = WITHDRAWABLE.includes(listing.status);

  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <Link
          href="/landlord/listings"
          className="group inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:text-accent-strong"
        >
          <ArrowIcon className="h-4 w-4 rotate-180 transition-transform group-hover:-translate-x-0.5" />
          My properties
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <IconChip>
            <HomeIcon />
          </IconChip>
          <h2 className="font-display text-2xl leading-tight font-semibold tracking-[-0.02em] text-primary sm:text-[1.75rem]">
            {listing.title}
          </h2>
          <span data-testid="listing-status">
            <StatusPill tone={STATUS_TONE[listing.status]}>
              {STATUS_LABEL[listing.status]}
            </StatusPill>
          </span>
        </div>
      </div>

      {awaitingConfirmation && (
        <Notice
          tone="warning"
          icon={<PenIcon />}
          title="PropLink prepared this listing for you"
        >
          Check every detail, add your ownership documents, then confirm to send it for
          review.
        </Notice>
      )}
      {listing.status === LandlordListingStatus.REJECTED && listing.rejectionReason && (
        <Notice tone="danger" icon={<AlertIcon />} title="PropLink asked for changes">
          {listing.rejectionReason}
        </Notice>
      )}
      {listing.status === LandlordListingStatus.SUBMITTED && (
        <Notice tone="accent" icon={<ClockIcon />} title="In PropLink review">
          Submitted {formatDate(listing.submittedAt)}. PropLink usually reviews listings
          within 30–60 minutes; we&apos;ll notify you.
        </Notice>
      )}
      {listing.status === LandlordListingStatus.APPROVED && (
        <Notice tone="success" icon={<CheckIcon />} title="Approved">
          Verified agents can now see this listing and send you proposals. It stays
          private: never public, never in search.{" "}
          <Link
            href={`/landlord/listings/${listing.id}/proposals`}
            className="font-semibold text-accent underline underline-offset-4 hover:text-accent-strong"
          >
            Compare proposals
          </Link>
        </Notice>
      )}

      <section className="space-y-5">
        <InvestorSectionTitle title="Property" tail="details" />
        {editable ? (
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
        ) : (
          <dl className="grid gap-x-8 gap-y-5 rounded-3xl border border-line bg-white p-6 text-sm shadow-sm sm:grid-cols-2 sm:p-7">
            {details.map(([label, value]) => (
              <div key={label} className="space-y-1">
                <dt className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
                  {label}
                </dt>
                <dd className="whitespace-pre-line text-body">{value || "—"}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="space-y-5">
        <InvestorSectionTitle
          title="Photos and"
          tail="documents"
          description="Every file is scanned for malware and kept private."
        />
        {files.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line bg-surface/60 px-5 py-6 text-center text-sm text-muted">
            Nothing attached yet.
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-white shadow-sm">
            {files.map((file) => (
              <li
                key={file.fileId}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm"
              >
                <span className="flex min-w-0 items-center gap-3">
                  {file.previewUrl ? (
                    <a
                      href={file.previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open photo ${file.name}`}
                      className="shrink-0 overflow-hidden rounded-xl border border-line bg-surface transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from the private upload pipeline; next/image would cache it. */}
                      <img
                        src={file.previewUrl}
                        alt=""
                        data-testid="listing-photo-preview"
                        className="h-16 w-24 object-cover"
                        width={96}
                        height={64}
                      />
                    </a>
                  ) : (
                    <IconChip>
                      <FileIcon />
                    </IconChip>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-primary">
                      {file.name}
                    </span>
                    <span className="text-xs text-muted">{KIND_LABEL[file.kind]}</span>
                  </span>
                </span>
                <span className="flex items-center gap-4">
                  {file.url && (
                    <a
                      href={file.url}
                      className="text-xs font-semibold text-accent hover:text-accent-strong"
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
                        className="text-xs font-semibold text-danger hover:underline"
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
      </section>

      {editable && (
        <section className="space-y-5">
          <InvestorSectionTitle
            title={awaitingConfirmation ? "Confirm and" : "Submit for"}
            tail={awaitingConfirmation ? "submit" : "review"}
          />
          <div className="rounded-3xl border border-accent/20 bg-pale/70 p-6 sm:p-7">
            {missing.length > 0 ? (
              <div className="mb-5 text-sm">
                <p className="font-semibold text-primary">
                  Still needed before you can submit:
                </p>
                <ul className="mt-3 space-y-2 text-body" data-testid="missing-list">
                  {missing.map((item) => (
                    <li key={item} className="flex items-start gap-2.5">
                      <span
                        aria-hidden
                        className="mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-accent/50"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mb-5 flex items-start gap-2.5 text-sm text-body">
                <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                Everything&apos;s in place. PropLink will review it, usually within 30–60
                minutes, before verified agents can see it.
              </p>
            )}
            {user.kycStatus !== KycStatus.APPROVED && (
              <p className="mb-5 flex items-start gap-2.5 text-sm text-warning">
                <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
                You&apos;ll need to finish your identity check (see Overview) before
                submitting.
              </p>
            )}
            <SubmitListing
              id={listing.id}
              label={awaitingConfirmation ? "Confirm and submit" : "Submit for review"}
            />
          </div>
        </section>
      )}

      {(canWithdraw || canDelete) && (
        <div className="flex flex-wrap gap-4 border-t border-line pt-8">
          {canWithdraw && (
            <ConfirmAction id={listing.id} title={listing.title} action="withdraw" />
          )}
          {canDelete && (
            <ConfirmAction id={listing.id} title={listing.title} action="delete" />
          )}
        </div>
      )}
    </div>
  );
}

const NOTICE_TONE = {
  accent: "border-accent/25 bg-pale/70",
  success: "border-success/30 bg-success/5",
  warning: "border-warning/30 bg-warning/5",
  danger: "border-danger/30 bg-danger/5",
} as const;

function Notice({
  tone,
  icon,
  title,
  children,
}: {
  tone: keyof typeof NOTICE_TONE;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      className={`flex items-start gap-3 rounded-3xl border p-5 sm:p-6 ${NOTICE_TONE[tone]}`}
    >
      <IconChip tone={tone}>{icon}</IconChip>
      <div>
        <p className="font-semibold text-primary">{title}</p>
        <p className="mt-1 text-sm leading-relaxed whitespace-pre-line text-body">
          {children}
        </p>
      </div>
    </div>
  );
}
