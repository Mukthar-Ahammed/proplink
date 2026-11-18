import Link from "next/link";
import { notFound } from "next/navigation";

import { ContractUploader } from "@/components/mandates/ContractUploader";
import { PortalSection } from "@/components/portal/PortalShell";
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
const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : "—");

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm whitespace-pre-line text-body">{value || "—"}</dd>
    </div>
  );
}

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
  const { listing } = mandate;

  return (
    <>
      <PortalSection
        title={listing.title}
        action={
          <Link
            href="/agent/mandates"
            className="text-sm font-semibold text-primary underline"
          >
            All mandates
          </Link>
        }
      >
        <p className="text-sm font-semibold text-primary" data-testid="mandate-status">
          {mandate.status === MandateStatus.OFFERED
            ? "The landlord chose you for an exclusive mandate."
            : active
              ? `Active since ${day(mandate.acceptedAt)}; contract ends ${day(mandate.endsAt)}.`
              : `This mandate is ${mandate.status.toLowerCase()}. You no longer have access to the listing's documents.`}
        </p>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
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
        <div className="mt-6 space-y-4">
          {mandate.status === MandateStatus.OFFERED && (
            <RespondToOffer mandateId={mandate.id} />
          )}
          {active && <TerminateMandate mandateId={mandate.id} />}
        </div>
      </PortalSection>

      {active && "addressLine1" in listing && (
        <PortalSection title="Property and landlord">
          <dl className="grid gap-4 sm:grid-cols-2">
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
          <h3 className="mt-6 text-sm font-semibold text-primary">
            Documents and photos
          </h3>
          {mandate.documents.length === 0 ? (
            <p className="text-sm text-muted">None attached.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {mandate.documents.map((document, index) => (
                <li key={`${document.kind}-${index}`}>
                  {document.url ? (
                    <a
                      href={document.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                    >
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
          <h3 className="mt-6 text-sm font-semibold text-primary">Contract</h3>
          {mandate.contractUrl && (
            <a href={mandate.contractUrl} className="text-sm text-primary underline">
              Signed contract
            </a>
          )}
          <div className="mt-2">
            <ContractUploader
              mandateId={mandate.id}
              attach={attachAgentContractAction}
              hasContract={Boolean(mandate.contractUrl)}
            />
          </div>
        </PortalSection>
      )}

      {active && mandate.disclosure && mandate.investorPreview && (
        <PortalSection title="What investors will see">
          <p className="text-sm text-muted">
            When you publish this property to investors (coming with the Investor Portal),
            only the details you tick are shown.
          </p>
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <DisclosureForm
              mandateId={mandate.id}
              fields={DISCLOSURE_FIELDS.map((field) => ({
                key: field.key,
                label: field.label,
                personal: field.personal,
                checked: mandate.disclosure![field.key],
              }))}
            />
            <dl
              className="grid gap-3 rounded-lg border border-line bg-white p-4"
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
        </PortalSection>
      )}
    </>
  );
}
