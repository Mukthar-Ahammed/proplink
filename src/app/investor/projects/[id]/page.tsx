import Link from "next/link";
import { notFound } from "next/navigation";

import { PortalSection } from "@/components/portal/PortalShell";
import { ActionButton } from "@/components/projects/ActionButton";
import { ProjectSummary } from "@/components/projects/ProjectSummary";
import {
  InvestorProjectStatus,
  LeadNominationStatus,
  Role,
} from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { getInvestorProject } from "@/services/projects/portal";

import { interestAction, nominationResponseAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Investor — Project", robots: { index: false } };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm whitespace-pre-line text-body">{value || "—"}</dd>
    </div>
  );
}

/**
 * One project in the Investor Portal (Phase 4). Property details are only
 * what the Agent disclosed; documents need KYC approval.
 */
export default async function InvestorProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePageRole(Role.INVESTOR);
  const { id } = await params;
  const project = await getInvestorProject(
    {
      profileId: session.user.authUserId,
      legacyUserId: session.user.id,
      role: session.user.role,
    },
    id,
  );
  if (!project) notFound();
  const raising =
    project.status === InvestorProjectStatus.PUBLISHED ||
    project.status === InvestorProjectStatus.OPEN_FOR_INVESTMENT;

  return (
    <>
      <PortalSection
        title={project.title}
        action={
          <Link
            href="/investor/projects"
            className="text-sm font-semibold text-primary underline"
          >
            All projects
          </Link>
        }
      >
        <ProjectSummary project={project} showExpected={project.showExpected} />
      </PortalSection>

      <PortalSection title="Lead Investor">
        {project.lead ? (
          <p className="text-sm text-body" data-testid="lead-stats">
            {project.lead.isMe
              ? "You are this project's Lead Investor."
              : project.lead.name
                ? `${project.lead.name}${project.lead.verified ? " (verified)" : ""}`
                : `A ${project.lead.verified ? "verified " : ""}investor (private profile)`}{" "}
            · {project.lead.led} project{project.lead.led === 1 ? "" : "s"} led ·{" "}
            {project.lead.completed} completed
          </p>
        ) : (
          <p className="text-sm text-muted">
            The Lead Investor is not confirmed yet. Co-investor pledges open once PropLink
            confirms the Lead.
          </p>
        )}
        {project.nomination && (
          <div
            className="mt-4 rounded-lg border border-line bg-white p-4"
            data-testid="nomination"
          >
            {project.nomination.status === LeadNominationStatus.NOMINATED ? (
              <>
                <p className="text-sm text-body">
                  The agent nominated you as Lead Investor. As Lead you hold executive
                  authority over budget and scope decisions, recorded by the Solicitor.
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <ActionButton
                    action={nominationResponseAction}
                    hidden={{
                      intent: "accept",
                      nominationId: project.nomination.id,
                      projectId: project.id,
                    }}
                    label="Accept nomination"
                  />
                  <ActionButton
                    action={nominationResponseAction}
                    hidden={{
                      intent: "decline",
                      nominationId: project.nomination.id,
                      projectId: project.id,
                    }}
                    label="Decline"
                    tone="secondary"
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-body">
                You accepted the Lead nomination; PropLink is reviewing it.
              </p>
            )}
          </div>
        )}
        {raising && (
          <div className="mt-4">
            {project.interested ? (
              <ActionButton
                action={interestAction}
                hidden={{ intent: "withdraw", projectId: project.id }}
                label="Withdraw interest"
                tone="secondary"
              />
            ) : (
              <ActionButton
                action={interestAction}
                hidden={{ intent: "interest", projectId: project.id }}
                label="I'm interested"
              />
            )}
          </div>
        )}
      </PortalSection>

      <PortalSection title="The property">
        <dl className="grid gap-4 sm:grid-cols-2" data-testid="investor-property">
          <Row label="Location" value={project.property.location} />
          <Row
            label="Landlord"
            value={project.property.landlordName ?? "Not disclosed"}
          />
          <Row
            label="Type"
            value={project.property.propertyType ?? project.property.propertyKind}
          />
          <Row
            label="Land area"
            value={
              project.property.landAreaSqm ? `${project.property.landAreaSqm} m²` : null
            }
          />
          <div className="sm:col-span-2">
            <Row
              label="Description"
              value={project.property.description ?? "Not disclosed"}
            />
          </div>
          <Row
            label="Known defects"
            value={project.property.defects ?? "Not disclosed"}
          />
          <Row
            label="Work required"
            value={project.property.requiredWork ?? "Not disclosed"}
          />
        </dl>
        {project.photos.length > 0 && (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {project.photos.map((url, index) => (
              <li key={url}>
                {/* eslint-disable-next-line @next/next/no-img-element -- signed private URL */}
                <img
                  src={url}
                  alt={`Property photo ${index + 1}`}
                  className="aspect-square w-full rounded-lg object-cover"
                />
              </li>
            ))}
          </ul>
        )}
        <h3 className="mt-5 text-sm font-semibold text-primary">Documents</h3>
        {project.kycApproved ? (
          project.documents.length === 0 ? (
            <p className="text-sm text-muted">No documents shared.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm" data-testid="project-documents">
              {project.documents.map((url, index) => (
                <li key={url}>
                  <a
                    href={url}
                    className="text-primary underline"
                    rel="noopener noreferrer"
                  >
                    Document {index + 1}
                  </a>
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="text-sm text-muted" data-testid="documents-locked">
            Documents are available once your identity verification (KYC) is approved.{" "}
            <Link href="/investor/kyc" className="text-primary underline">
              Verify now
            </Link>
          </p>
        )}
      </PortalSection>
    </>
  );
}
