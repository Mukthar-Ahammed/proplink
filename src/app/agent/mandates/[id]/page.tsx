import Link from "next/link";
import { notFound } from "next/navigation";

import { ContractUploader } from "@/components/mandates/ContractUploader";
import {
  AlertIcon,
  ArrowIcon,
  CheckIcon,
  ClockIcon,
  EyeIcon,
  FileIcon,
  IconChip,
  InvestorSectionTitle,
  PrimaryLink,
  StatusPill,
} from "@/components/investor/InvestorUi";
import { MandateStatus, Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { getMandateForAgent } from "@/services/landlord/mandates";
import { formatFee, formatPence } from "@/services/landlord/marketplace";

import { attachAgentContractAction } from "../actions";
import { RespondToOffer, TerminateMandate } from "./AgentMandateControls";
import { DisclosureForm } from "./DisclosureForm";
import { DISCLOSURE_FIELDS } from "@/services/landlord/disclosure";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent — Mandate", robots: { index: false } };

const KIND: Record<string, string> = {
  OWNERSHIP_DOCUMENT: "Ownership document",
  PHOTO: "Photo",
  DOCUMENT: "Document",
};
const STATUS: Record<string, string> = {
  OFFERED: "Offered to you",
  ACTIVE: "Active",
  DECLINED: "You declined",
  WITHDRAWN: "Offer withdrawn",
  TERMINATED: "Terminated",
  CLOSED: "Closed",
};
const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : "—");

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
        {label}
      </dt>
      <dd className="text-sm whitespace-pre-line text-body">{value || "—"}</dd>
    </div>
  );
}

const CARD = "rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-7";
const EYEBROW = "text-xs font-semibold tracking-[0.14em] text-muted uppercase";

/**
 * One mandate for the Agent (Phase 2 Task 6, ADR-039). The Landlord's name,
 * the full listing and its documents are shown only while it is ACTIVE.
 */
export default async function AgentMandatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePageRole(Role.AGENT);
  const { id } = await params;
  const mandate = await getMandateForAgent(
    {
      profileId: session.user.authUserId,
      legacyUserId: session.user.id,
      role: session.user.role,
    },
    id,
  );
  if (!mandate) notFound();
  const active = mandate.status === MandateStatus.ACTIVE;
  const offered = mandate.status === MandateStatus.OFFERED;
  const { listing } = mandate;
  const tone = active ? "success" : offered ? "warning" : "neutral";

  return (
    <div className="space-y-12">
      <section className="space-y-5">
        <div className="space-y-4">
          <Link
            href="/agent/mandates"
            className="group inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:text-accent-strong"
          >
            <ArrowIcon className="h-4 w-4 rotate-180 transition-transform group-hover:-translate-x-0.5" />
            All mandates
          </Link>
          <InvestorSectionTitle
            title={listing.title}
            action={<StatusPill tone={tone}>{STATUS[mandate.status]}</StatusPill>}
          />
        </div>

        <div className={`${CARD} space-y-5`}>
          <div className="flex items-start gap-3">
            <IconChip tone={active ? "success" : offered ? "warning" : "danger"}>
              {active ? <CheckIcon /> : offered ? <ClockIcon /> : <AlertIcon />}
            </IconChip>
            <p
              className="pt-2 text-sm font-semibold text-primary"
              data-testid="mandate-status"
            >
              {offered
                ? "The landlord chose you for an exclusive mandate."
                : active
                  ? `Active since ${day(mandate.acceptedAt)}; contract ends ${day(mandate.endsAt)}.`
                  : `This mandate is ${mandate.status.toLowerCase()}. You no longer have access to the listing's documents.`}
            </p>
          </div>
          <dl className="grid gap-x-8 gap-y-5 border-t border-line pt-5 sm:grid-cols-2">
            <Row label="Valuation" value={formatPence(mandate.valuationGBP)} />
            <Row label="Your fee" value={formatFee(mandate)} />
            <Row label="Contract period" value={`${mandate.contractMonths} months`} />
            <Row label="Renewal" value={mandate.renewalTerms} />
            <div className="sm:col-span-2">
              <Row label="Agreed terms" value={mandate.terms} />
            </div>
            {mandate.terminationReason && (
              <div className="sm:col-span-2">
                <Row label="Termination reason" value={mandate.terminationReason} />
              </div>
            )}
          </dl>
          {(offered || active) && (
            <div className="space-y-4 border-t border-line pt-5">
              {offered && <RespondToOffer mandateId={mandate.id} />}
              {active && <TerminateMandate mandateId={mandate.id} />}
            </div>
          )}
        </div>
      </section>

      {active && "addressLine1" in listing && (
        <section className="space-y-5">
          <InvestorSectionTitle title="Property and" tail="landlord" />
          <dl className={`${CARD} grid gap-x-8 gap-y-5 sm:grid-cols-2`}>
            <Row label="Landlord" value={listing.landlordName} />
            <Row
              label="Address"
              value={[listing.addressLine1, listing.city, listing.postcode]
                .filter(Boolean)
                .join(", ")}
            />
            <div className="sm:col-span-2">
              <Row label="Description" value={listing.description} />
            </div>
            <Row label="Known defects" value={listing.defects} />
            <Row label="Work required" value={listing.requiredWork} />
          </dl>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className={CARD}>
              <div className="flex items-center gap-3">
                <IconChip>
                  <FileIcon />
                </IconChip>
                <div>
                  <p className={EYEBROW}>Files</p>
                  <h3 className="mt-0.5 font-semibold text-primary">
                    Documents and photos
                  </h3>
                </div>
              </div>
              {mandate.documents.length === 0 ? (
                <p className="mt-5 rounded-2xl border border-dashed border-line bg-surface/60 px-5 py-6 text-center text-sm text-muted">
                  None attached.
                </p>
              ) : (
                <ul className="mt-5 divide-y divide-line border-t border-line text-sm">
                  {mandate.documents.map((document, index) => (
                    <li key={`${document.kind}-${index}`} className="py-3">
                      {document.url ? (
                        <a
                          href={document.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 font-semibold text-accent hover:text-accent-strong"
                        >
                          <FileIcon className="h-4 w-4" />
                          {KIND[document.kind]} {index + 1}
                        </a>
                      ) : (
                        <span className="text-muted">
                          {KIND[document.kind]} (unavailable)
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className={CARD}>
              <div className="flex items-center gap-3">
                <IconChip>
                  <FileIcon />
                </IconChip>
                <div>
                  <p className={EYEBROW}>Agreement</p>
                  <h3 className="mt-0.5 font-semibold text-primary">Contract</h3>
                </div>
              </div>
              <div className="mt-5 space-y-3 border-t border-line pt-4 text-sm">
                {mandate.contractUrl && (
                  <a
                    href={mandate.contractUrl}
                    className="inline-flex items-center gap-1.5 font-semibold text-accent hover:text-accent-strong"
                  >
                    <FileIcon className="h-4 w-4" />
                    Signed contract
                  </a>
                )}
                <ContractUploader
                  mandateId={mandate.id}
                  attach={attachAgentContractAction}
                  hasContract={Boolean(mandate.contractUrl)}
                />
              </div>
            </div>
          </div>
        </section>
      )}

      {active && mandate.disclosure && mandate.investorPreview && (
        <section className="space-y-5">
          <InvestorSectionTitle
            title="What investors"
            tail="will see"
            description="When you publish this property to investors, only the details you tick are shown."
            action={
              <PrimaryLink href={`/agent/projects/new?mandate=${mandate.id}`}>
                Publish to investors
              </PrimaryLink>
            }
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={CARD}>
              <DisclosureForm
                mandateId={mandate.id}
                fields={DISCLOSURE_FIELDS.map((field) => ({
                  key: field.key,
                  label: field.label,
                  personal: field.personal,
                  checked: mandate.disclosure![field.key],
                }))}
              />
            </div>
            <div className="rounded-3xl border border-accent/20 bg-pale/60 p-6 sm:p-7">
              <div className="flex items-center gap-3">
                <IconChip>
                  <EyeIcon />
                </IconChip>
                <div>
                  <p className={EYEBROW}>Preview</p>
                  <h3 className="mt-0.5 font-semibold text-primary">The investor view</h3>
                </div>
              </div>
              <dl
                className="mt-5 grid gap-4 border-t border-accent/20 pt-5"
                data-testid="investor-preview"
              >
                <Row
                  label="Landlord"
                  value={mandate.investorPreview.landlordName ?? "Hidden"}
                />
                <Row
                  label="Location"
                  value={[
                    mandate.investorPreview.addressLine1,
                    mandate.investorPreview.city,
                    mandate.investorPreview.postcode ??
                      mandate.investorPreview.postcodeDistrict,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                />
                <Row
                  label="Description"
                  value={mandate.investorPreview.description ?? "Hidden"}
                />
                <Row
                  label="Known defects"
                  value={mandate.investorPreview.defects ?? "Hidden"}
                />
                <Row
                  label="Work required"
                  value={mandate.investorPreview.requiredWork ?? "Hidden"}
                />
                <Row
                  label="Photos and documents"
                  value={`${mandate.investorPreview.photoFileIds.length} photos, ${mandate.investorPreview.documentFileIds.length} documents`}
                />
              </dl>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
