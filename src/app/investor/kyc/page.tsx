import Link from "next/link";
import { requirePageRole } from "@/lib/authz";
import { PortalSection } from "@/components/portal/PortalShell";
import { getOrCreateKycDraft, getKycStatusSummary } from "@/services/kyc/kycService";
import { KycSubmissionForm } from "@/components/investor/KycSubmissionForm";
import type { KycCaller } from "@/services/kyc/kycService";
import { KycStatus, KycSubmissionStatus } from "@/generated/prisma/enums";
import { getProviderApplicantState } from "@/services/kyc/providerVerification";
import { VerifyButton } from "@/app/verify/VerifyButton";

export const dynamic = "force-dynamic";

const STATUS_CONFIG = {
  [KycStatus.NOT_STARTED]: {
    badge: "bg-warning/15 text-warning border-warning/30",
    title: "Identity Verification Required",
    description:
      "Your investor account requires identity verification (KYC) before you can participate in financial transactions. Please complete the form below to begin.",
    showForm: true,
  },
  [KycStatus.PENDING]: {
    badge: "bg-warning/15 text-warning border-warning/30",
    title: "Verification Under Review",
    description:
      "Your identity documents are currently under review by the PropLink compliance team. This typically takes 1–3 business days. You will be notified of the outcome.",
    showForm: false,
  },
  [KycStatus.APPROVED]: {
    badge: "bg-success/15 text-success border-success/30",
    title: "Identity Verified ✓",
    description:
      "Your identity verification is complete and approved. You are eligible for investor features subject to your workspace capabilities.",
    showForm: false,
  },
  [KycStatus.REJECTED]: {
    badge: "bg-danger/15 text-danger border-danger/30",
    title: "Verification Needs Attention",
    description:
      "Your most recent identity verification submission was not approved. Please review the notes below and resubmit with the required documents.",
    showForm: true,
  },
} as const;

const SUBMISSION_STATUS_LABEL: Record<KycSubmissionStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Under Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

const SUBMISSION_STATUS_TONE: Record<KycSubmissionStatus, string> = {
  DRAFT: "bg-surface text-muted border-line",
  SUBMITTED: "bg-warning/10 text-warning border-warning/30",
  APPROVED: "bg-success/15 text-success border-success/30",
  REJECTED: "bg-danger/10 text-danger border-danger/30",
};

export default async function InvestorKycPage() {
  const { user } = await requirePageRole("INVESTOR");

  const caller: KycCaller = {
    userId: user.id,
    role: user.role,
    kycStatus: user.kycStatus,
    active: true,
  };

  const [statusResult, draftResult, providerState] = await Promise.all([
    getKycStatusSummary(caller),
    // Only fetch/create draft when the investor can submit
    user.kycStatus === KycStatus.NOT_STARTED || user.kycStatus === KycStatus.REJECTED
      ? getOrCreateKycDraft(caller)
      : Promise.resolve(null),
    getProviderApplicantState(user.authUserId),
  ]);
  // Provider verification is the primary route (ADR-026); the manual
  // submission below stays for exceptions reviewed in the Admin KYC studio.
  const canStartProvider =
    user.kycStatus === KycStatus.NOT_STARTED ||
    user.kycStatus === KycStatus.REJECTED ||
    (user.kycStatus === KycStatus.PENDING && providerState.sameProvider);

  const config = STATUS_CONFIG[user.kycStatus] ?? STATUS_CONFIG[KycStatus.NOT_STARTED];
  const latestSubmission = statusResult.ok ? statusResult.data.latestSubmission : null;
  const draft = draftResult && draftResult.ok ? draftResult.data : null;

  return (
    <div className="space-y-8">
      {/* Status header card */}
      <div className="rounded-2xl border border-line bg-white p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-6">
          <div>
            <h2 className="text-xl font-bold text-primary">{config.title}</h2>
            <p className="mt-1 text-sm text-muted">
              Authoritative identity verification status
            </p>
          </div>
          <span
            className={`rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-wider ${config.badge}`}
          >
            {user.kycStatus}
          </span>
        </div>

        <div className="mt-6 space-y-4">
          <p className="text-sm leading-relaxed text-secondary">{config.description}</p>

          {/* Rejection notes */}
          {user.kycStatus === KycStatus.REJECTED && latestSubmission?.reviewNotes && (
            <div className="rounded-xl border border-danger/20 bg-danger/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-danger">
                Compliance Notes
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-secondary">
                {latestSubmission.reviewNotes}
              </p>
            </div>
          )}
        </div>
      </div>

      {canStartProvider && (
        <PortalSection title="Verify with our identity partner">
          <div className="space-y-3 rounded-2xl border border-line bg-white p-6">
            <p className="text-sm leading-relaxed text-secondary">
              {user.kycStatus === KycStatus.PENDING
                ? "Your verification is in progress. Continue where you left off; we update your status as soon as our partner has a result."
                : "The quickest route: verify your identity online with PropLink's regulated verification partner. It usually takes a few minutes. PropLink stores only the result, not your documents."}
            </p>
            <VerifyButton
              label={
                user.kycStatus === KycStatus.PENDING
                  ? "Continue verification"
                  : "Verify my identity"
              }
            />
          </div>
        </PortalSection>
      )}

      {/* Submission history */}
      {latestSubmission && (
        <PortalSection title="Application Status">
          <div className="rounded-2xl border border-line bg-white overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-line">
              <div>
                <p className="text-sm font-semibold text-primary">KYC Application</p>
                <p className="text-xs text-muted mt-0.5">
                  {latestSubmission.documentCount} document
                  {latestSubmission.documentCount !== 1 ? "s" : ""} attached
                  {latestSubmission.submittedAt &&
                    ` · Submitted ${new Date(
                      latestSubmission.submittedAt,
                    ).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}`}
                </p>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${SUBMISSION_STATUS_TONE[latestSubmission.status]}`}
              >
                {SUBMISSION_STATUS_LABEL[latestSubmission.status]}
              </span>
            </div>

            {latestSubmission.status === KycSubmissionStatus.SUBMITTED && (
              <div className="px-6 py-4 text-sm text-muted">
                Your application is in the review queue. The PropLink compliance team will
                contact you if additional information is needed.
              </div>
            )}
          </div>
        </PortalSection>
      )}

      {/* KYC submission form — shown only when the investor can submit/resubmit */}
      {config.showForm && draft && (
        <PortalSection
          title={
            user.kycStatus === KycStatus.REJECTED
              ? "Resubmit Your Application"
              : "Submit Identity Verification"
          }
        >
          <KycSubmissionForm
            submissionId={draft.submissionId}
            initialDocumentCount={draft.documentCount}
          />
        </PortalSection>
      )}

      {/* What to expect */}
      {user.kycStatus === KycStatus.NOT_STARTED && (
        <PortalSection title="What to Expect">
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                step: "1",
                title: "Upload Documents",
                body: "Upload one or more identity documents. Accepted: passport, driver's licence, national ID, or proof of address.",
              },
              {
                step: "2",
                title: "Compliance Review",
                body: "The PropLink compliance team reviews your submission in 1–3 business days. You'll be notified of the outcome.",
              },
              {
                step: "3",
                title: "Access Unlocked",
                body: "Once approved, financial features appropriate to your investor workspace will be unlocked.",
              },
            ].map((item) => (
              <div
                key={item.step}
                className="rounded-2xl border border-line bg-white p-5"
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
                  {item.step}
                </span>
                <h4 className="mt-3 font-semibold text-primary">{item.title}</h4>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{item.body}</p>
              </div>
            ))}
          </div>
        </PortalSection>
      )}

      {/* Regulatory notice */}
      <PortalSection title="Security & Compliance Boundary">
        <div className="rounded-xl border border-line bg-white p-6 text-sm leading-relaxed text-muted">
          <p>
            PropLink operates under UK financial and anti-money laundering (AML)
            regulatory boundaries. Investor identity verification protects all syndicate
            participants and ensures compliance prior to any financial commitment.
            Documents are stored in a private, encrypted storage vault and are only
            accessible to PropLink compliance personnel.
          </p>
          <div className="mt-4 flex gap-4">
            <Link
              href="/investor"
              className="text-sm font-semibold text-primary underline decoration-line underline-offset-4 hover:decoration-accent"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </PortalSection>
    </div>
  );
}
