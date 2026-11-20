import Link from "next/link";
import { notFound } from "next/navigation";

import { ContractUploader } from "@/components/mandates/ContractUploader";
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
import { PersonName } from "@/components/profiles/PersonName";
import { Badge } from "@/components/ui/badge";
import { MandateStatus, Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { DISCLOSURE_FIELDS } from "@/services/landlord/disclosure";
import { getMandateForAgent } from "@/services/landlord/mandates";
import { formatFee, formatPence } from "@/services/landlord/marketplace";

import { attachAgentContractAction } from "../actions";
import { RespondToOffer, TerminateMandate } from "./AgentMandateControls";
import { DisclosureForm } from "./DisclosureForm";

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

const PRIMARY_LINK =
  "inline-flex items-center rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-strong";

/**
 * One mandate for the Agent (Phase 2 Task 6, ADR-039), split into tabs
 * (ADR-080): Overview · Property & documents · Investor view. The Landlord's
 * name, the full listing and its documents are shown only while it is ACTIVE.
 */
export default async function AgentMandatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await requirePageRole(Role.AGENT);
  const [{ id }, query] = await Promise.all([params, searchParams]);
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
  const path = `/agent/mandates/${mandate.id}`;
  const fullListing = active && "addressLine1" in listing ? listing : null;
  const canPublish = active && mandate.disclosure && mandate.investorPreview;

  const tabs: DetailTab[] = [{ key: "overview", label: "Overview", attention: offered }];
  if (fullListing) {
    tabs.push({
      key: "property",
      label: "Property & documents",
      count: mandate.documents.length,
      attention: !mandate.contractUrl,
    });
  }
  if (canPublish) tabs.push({ key: "investors", label: "What investors see" });
  const tab = pickTab(query.tab, tabs);

  return (
    <>
      <DetailHeader
        back={{ href: "/agent/mandates", label: "All mandates" }}
        eyebrow="Mandate"
        title={listing.title}
        badges={
          <Badge tone={active ? "success" : offered ? "warning" : "default"}>
            {STATUS[mandate.status]}
          </Badge>
        }
        actions={
          canPublish ? (
            <Link
              href={`/agent/projects/new?mandate=${mandate.id}`}
              className={PRIMARY_LINK}
            >
              Publish to investors
            </Link>
          ) : null
        }
      />

      <KeyFacts
        items={[
          { label: "Valuation", value: formatPence(mandate.valuationGBP) },
          { label: "Your fee", value: formatFee(mandate) },
          { label: "Contract period", value: `${mandate.contractMonths} months` },
          {
            label: active ? "Contract ends" : "Accepted",
            value: active ? day(mandate.endsAt) : day(mandate.acceptedAt),
          },
        ]}
      />

      <DetailTabs basePath={path} tabs={tabs} current={tab} label="Mandate sections" />

      {tab === "overview" && (
        <TabBody>
          <DetailColumns
            main={
              <Panel title="Agreed terms">
                <FactList
                  items={[
                    { label: "Valuation", value: formatPence(mandate.valuationGBP) },
                    { label: "Your fee", value: formatFee(mandate) },
                    {
                      label: "Contract period",
                      value: `${mandate.contractMonths} months`,
                    },
                    { label: "Renewal", value: mandate.renewalTerms },
                    { label: "Agreed terms", value: mandate.terms, wide: true },
                    ...(mandate.terminationReason
                      ? [
                          {
                            label: "Termination reason",
                            value: mandate.terminationReason,
                            wide: true,
                          },
                        ]
                      : []),
                  ]}
                />
              </Panel>
            }
            side={
              <Panel
                title={offered ? "Your answer" : "Status"}
                tone={offered ? "attention" : active ? "default" : "muted"}
              >
                <p
                  className="text-sm font-semibold text-primary"
                  data-testid="mandate-status"
                >
                  {offered
                    ? "The landlord chose you for an exclusive mandate."
                    : active
                      ? `Active since ${day(mandate.acceptedAt)}; contract ends ${day(mandate.endsAt)}.`
                      : `This mandate is ${mandate.status.toLowerCase()}. You no longer have access to the listing's documents.`}
                </p>
                {fullListing ? (
                  <p className="mt-2 text-sm text-body">
                    Landlord:{" "}
                    <PersonName
                      name={fullListing.landlordName ?? "—"}
                      verified={fullListing.landlordVerified}
                    />
                  </p>
                ) : null}
                {(offered || active) && (
                  <div className="mt-4 space-y-4 border-t border-line pt-4">
                    {offered && <RespondToOffer mandateId={mandate.id} />}
                    {active && <TerminateMandate mandateId={mandate.id} />}
                  </div>
                )}
              </Panel>
            }
          />
        </TabBody>
      )}

      {tab === "property" && fullListing && (
        <TabBody>
          <Panel title="Property and landlord">
            <FactList
              items={[
                { label: "Landlord", value: fullListing.landlordName },
                {
                  label: "Address",
                  value: [
                    fullListing.addressLine1,
                    fullListing.city,
                    fullListing.postcode,
                  ]
                    .filter(Boolean)
                    .join(", "),
                },
                { label: "Description", value: fullListing.description, wide: true },
                { label: "Known defects", value: fullListing.defects },
                { label: "Work required", value: fullListing.requiredWork },
              ]}
            />
          </Panel>
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Documents and photos">
              {mandate.documents.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-line bg-surface px-5 py-6 text-center text-sm text-muted">
                  None attached.
                </p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {mandate.documents.map((document, index) => (
                    <li key={`${document.kind}-${index}`} className="py-3">
                      {document.url ? (
                        <a
                          href={document.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-accent hover:text-accent-strong"
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
            </Panel>
            <Panel
              title="Contract"
              description={
                mandate.contractUrl ? undefined : "Upload the signed mandate contract."
              }
              tone={mandate.contractUrl ? "default" : "attention"}
            >
              <div className="space-y-3 text-sm">
                {mandate.contractUrl && (
                  <a
                    href={mandate.contractUrl}
                    className="font-semibold text-accent hover:text-accent-strong"
                  >
                    Signed contract
                  </a>
                )}
                <ContractUploader
                  mandateId={mandate.id}
                  attach={attachAgentContractAction}
                  hasContract={Boolean(mandate.contractUrl)}
                />
              </div>
            </Panel>
          </div>
        </TabBody>
      )}

      {tab === "investors" && canPublish && (
        <TabBody>
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel
              title="Choose what to disclose"
              description="When you publish this property to investors, only the details you tick are shown."
            >
              <DisclosureForm
                mandateId={mandate.id}
                fields={DISCLOSURE_FIELDS.map((field) => ({
                  key: field.key,
                  label: field.label,
                  personal: field.personal,
                  checked: mandate.disclosure![field.key],
                }))}
              />
            </Panel>
            <Panel title="The investor view" tone="muted">
              <FactList
                columns={2}
                testId="investor-preview"
                items={[
                  {
                    label: "Landlord",
                    value: mandate.investorPreview!.landlordName ?? "Hidden",
                  },
                  {
                    label: "Location",
                    value: [
                      mandate.investorPreview!.addressLine1,
                      mandate.investorPreview!.city,
                      mandate.investorPreview!.postcode ??
                        mandate.investorPreview!.postcodeDistrict,
                    ]
                      .filter(Boolean)
                      .join(", "),
                  },
                  {
                    label: "Description",
                    value: mandate.investorPreview!.description ?? "Hidden",
                    wide: true,
                  },
                  {
                    label: "Known defects",
                    value: mandate.investorPreview!.defects ?? "Hidden",
                  },
                  {
                    label: "Work required",
                    value: mandate.investorPreview!.requiredWork ?? "Hidden",
                  },
                  {
                    label: "Photos and documents",
                    value: `${mandate.investorPreview!.photoFileIds.length} photos, ${mandate.investorPreview!.documentFileIds.length} documents`,
                    wide: true,
                  },
                ]}
              />
              <Link
                href={`/agent/projects/new?mandate=${mandate.id}`}
                className={`mt-5 ${PRIMARY_LINK}`}
              >
                Publish to investors
              </Link>
            </Panel>
          </div>
        </TabBody>
      )}
    </>
  );
}
