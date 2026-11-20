import { SubmitButton } from "@/components/ui/submit-button";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getServerEnv } from "@/env";
import { KycStatus, LandlordListingStatus } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { db } from "@/lib/db";
import {
  AlertIcon,
  CheckIcon,
  ClockIcon,
  FileIcon,
  IconChip,
  PenIcon,
} from "@/components/investor/InvestorUi";
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

/** `StatusPill` tones mapped onto the shared `Badge` tones. */
const BADGE_TONE = {
  neutral: "default",
  accent: "intel",
  success: "success",
  warning: "warning",
  danger: "danger",
} as const;

const PRIMARY_LINK =
  "inline-flex items-center rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-strong";

/**
 * One of the Landlord's own listings (Phase 2 Task 1, ADR-034), split into
 * tabs (ADR-080): Overview · Property details · Photos & documents. Loaded by
 * owner and ID; anyone else gets "not found".
 */
export default async function LandlordListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { user } = await requirePageRole("LANDLORD");
  const [{ id }, query] = await Promise.all([params, searchParams]);
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
  const rejected = listing.status === LandlordListingStatus.REJECTED;
  const approved = listing.status === LandlordListingStatus.APPROVED;
  const path = `/landlord/listings/${listing.id}`;
  const proposalsHref = `${path}/proposals`;

  const address = [listing.addressLine1, listing.city, listing.postcode]
    .filter(Boolean)
    .join(", ");
  const kindLabel = listing.propertyKind
    ? listing.propertyKind === "LAND"
      ? "Development land"
      : "Property"
    : null;
  const outcomeLabel = listing.desiredOutcome
    ? listing.desiredOutcome === "DEVELOPMENT_JV"
      ? "Development joint venture"
      : "Refurbishment"
    : null;
  const details = [
    { label: "Address", value: address },
    { label: "Property or land", value: kindLabel },
    { label: "Type", value: listing.propertyType },
    {
      label: "Land area",
      value: listing.landAreaSqm
        ? `${listing.landAreaSqm.toLocaleString("en-GB")} m²`
        : null,
    },
    { label: "Desired outcome", value: outcomeLabel },
    { label: "Description", value: listing.description, wide: true },
    { label: "Known defects", value: listing.defects },
    { label: "Work required", value: listing.requiredWork },
  ];
  const canDelete =
    listing.status === LandlordListingStatus.DRAFT &&
    listing.createdBy === user.authUserId &&
    !listing.submittedAt;
  const canWithdraw = WITHDRAWABLE.includes(listing.status);
  const photoCount = files.filter((file) => file.kind === "PHOTO").length;

  const tabs: DetailTab[] = [
    {
      key: "overview",
      label: "Overview",
      attention: awaitingConfirmation || rejected,
    },
    { key: "details", label: "Property details" },
    { key: "files", label: "Photos & documents", count: files.length },
  ];
  const tab = pickTab(query.tab, tabs);

  return (
    <div>
      <DetailHeader
        back={{ href: "/landlord/listings", label: "My properties" }}
        eyebrow={kindLabel ?? "Your property"}
        title={listing.title}
        badges={
          <Badge
            tone={BADGE_TONE[STATUS_TONE[listing.status]]}
            data-testid="listing-status"
          >
            {STATUS_LABEL[listing.status]}
          </Badge>
        }
        subtitle={address || undefined}
        actions={
          approved ? (
            <Link href={proposalsHref} className={PRIMARY_LINK}>
              Compare proposals
            </Link>
          ) : editable && tab !== "overview" ? (
            <Link href={path} scroll={false} className={PRIMARY_LINK}>
              {awaitingConfirmation ? "Confirm and submit" : "Submit for review"}
            </Link>
          ) : null
        }
      />

      <KeyFacts
        items={[
          { label: "Status", value: STATUS_LABEL[listing.status] },
          { label: "Desired outcome", value: outcomeLabel ?? "Not set" },
          { label: "Type", value: listing.propertyType ?? kindLabel ?? "Not set" },
          {
            label: "Photos & documents",
            value: files.length,
            hint: `${photoCount} photo${photoCount === 1 ? "" : "s"}`,
          },
          {
            label: "Submitted",
            value: listing.submittedAt ? formatDate(listing.submittedAt) : "Not yet",
          },
        ]}
      />

      <DetailTabs basePath={path} tabs={tabs} current={tab} label="Property sections" />

      {tab === "overview" && (
        <TabBody>
          {awaitingConfirmation && (
            <Notice
              tone="warning"
              icon={<PenIcon />}
              title="PropLink prepared this listing for you"
            >
              Check every detail, add your ownership documents, then confirm to send it
              for review.
            </Notice>
          )}
          {rejected && listing.rejectionReason && (
            <Notice tone="danger" icon={<AlertIcon />} title="PropLink asked for changes">
              {listing.rejectionReason}
            </Notice>
          )}
          {listing.status === LandlordListingStatus.SUBMITTED && (
            <Notice tone="accent" icon={<ClockIcon />} title="In PropLink review">
              Submitted {formatDate(listing.submittedAt)}. PropLink usually reviews
              listings within 30–60 minutes; we&apos;ll notify you.
            </Notice>
          )}
          {approved && (
            <Notice tone="success" icon={<CheckIcon />} title="Approved">
              Verified agents can now see this listing and send you proposals. It stays
              private: never public, never in search.{" "}
              <Link
                href={proposalsHref}
                className="font-semibold text-accent underline underline-offset-4 hover:text-accent-strong"
              >
                Compare proposals
              </Link>
            </Notice>
          )}

          <DetailColumns
            main={
              <>
                {editable && (
                  <Panel
                    title={
                      awaitingConfirmation ? "Confirm and submit" : "Submit for review"
                    }
                    description="PropLink checks every listing before verified agents can see it."
                    tone={missing.length > 0 ? "attention" : "default"}
                  >
                    {missing.length > 0 ? (
                      <div className="mb-5 text-sm">
                        <p className="font-semibold text-primary">
                          Still needed before you can submit:
                        </p>
                        <ul
                          className="mt-3 space-y-2 text-body"
                          data-testid="missing-list"
                        >
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
                        <p className="mt-4 text-muted">
                          Fill these in on the{" "}
                          <Link
                            href={`${path}?tab=details`}
                            scroll={false}
                            className="font-semibold text-accent underline"
                          >
                            Property details
                          </Link>{" "}
                          and{" "}
                          <Link
                            href={`${path}?tab=files`}
                            scroll={false}
                            className="font-semibold text-accent underline"
                          >
                            Photos &amp; documents
                          </Link>{" "}
                          tabs.
                        </p>
                      </div>
                    ) : (
                      <p className="mb-5 flex items-start gap-2.5 text-sm text-body">
                        <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                        Everything&apos;s in place. PropLink will review it, usually
                        within 30–60 minutes, before verified agents can see it.
                      </p>
                    )}
                    {user.kycStatus !== KycStatus.APPROVED && (
                      <p className="mb-5 flex items-start gap-2.5 text-sm text-warning">
                        <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
                        You&apos;ll need to finish your identity check on your{" "}
                        <Link href="/landlord" className="font-semibold underline">
                          dashboard
                        </Link>{" "}
                        before submitting.
                      </p>
                    )}
                    <SubmitListing
                      id={listing.id}
                      label={
                        awaitingConfirmation ? "Confirm and submit" : "Submit for review"
                      }
                    />
                  </Panel>
                )}
                <Panel
                  title="At a glance"
                  action={
                    <Link
                      href={`${path}?tab=details`}
                      scroll={false}
                      className="text-sm font-semibold text-accent hover:text-accent-strong"
                    >
                      {editable ? "Edit details" : "All details"}
                    </Link>
                  }
                >
                  <FactList items={details.slice(0, 5)} />
                </Panel>
              </>
            }
            side={
              <>
                <Panel
                  title="Agent proposals"
                  description={
                    approved
                      ? "Compare agents side by side and choose one for an exclusive mandate."
                      : "Agents can send proposals once PropLink approves your listing."
                  }
                >
                  {approved ? (
                    <Link href={proposalsHref} className={PRIMARY_LINK}>
                      Compare proposals
                    </Link>
                  ) : null}
                </Panel>
                {(canWithdraw || canDelete) && (
                  <Panel title="Manage this listing" tone="muted">
                    <div className="flex flex-wrap gap-4">
                      {canWithdraw && (
                        <ConfirmAction
                          id={listing.id}
                          title={listing.title}
                          action="withdraw"
                        />
                      )}
                      {canDelete && (
                        <ConfirmAction
                          id={listing.id}
                          title={listing.title}
                          action="delete"
                        />
                      )}
                    </div>
                  </Panel>
                )}
              </>
            }
          />
        </TabBody>
      )}

      {tab === "details" && (
        <TabBody>
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
            <Panel
              title="Property details"
              description="These can't be changed while PropLink or agents are working with the listing."
            >
              <FactList items={details} />
            </Panel>
          )}
        </TabBody>
      )}

      {tab === "files" && (
        <TabBody>
          <Panel
            title="Photos and documents"
            description="Every file is scanned for malware and kept private."
          >
            {files.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line bg-surface/60 px-5 py-6 text-center text-sm text-muted">
                Nothing attached yet.
              </p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
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
                        <span className="text-xs text-muted">
                          {KIND_LABEL[file.kind]}
                        </span>
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
                          <SubmitButton
                            type="submit"
                            className="text-xs font-semibold text-danger hover:underline"
                          >
                            Remove
                          </SubmitButton>
                        </form>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {editable && (
            <Panel title="Add files">
              <FileUploader listingId={listing.id} />
            </Panel>
          )}
        </TabBody>
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
      className={`flex items-start gap-3 rounded-2xl border p-5 sm:p-6 ${NOTICE_TONE[tone]}`}
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
