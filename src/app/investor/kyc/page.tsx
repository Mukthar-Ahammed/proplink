import { requirePageRole } from "@/lib/authz";
import {
  AlertIcon,
  ArrowLink,
  CheckIcon,
  ClockIcon,
  IconChip,
  IdIcon,
  InvestorSectionTitle,
  ShieldIcon,
} from "@/components/investor/InvestorUi";
import { getOrCreateKycDraft, getKycStatusSummary } from "@/services/kyc/kycService";
import { KycSubmissionForm } from "@/components/investor/KycSubmissionForm";
import type { KycCaller } from "@/services/kyc/kycService";
import { KycStatus, KycSubmissionStatus } from "@/generated/prisma/enums";
import { getProviderApplicantState } from "@/services/kyc/providerVerification";
import { VerifyButton } from "@/app/verify/VerifyButton";

export const dynamic = "force-dynamic";

const STATUS_ICON = {
  [KycStatus.NOT_STARTED]: { tone: "warning", icon: <IdIcon /> },
  [KycStatus.PENDING]: { tone: "warning", icon: <ClockIcon /> },
  [KycStatus.APPROVED]: { tone: "success", icon: <CheckIcon /> },
  [KycStatus.REJECTED]: { tone: "danger", icon: <AlertIcon /> },
} as const;

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
    title: "Identity Verified",
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

  const statusIcon = STATUS_ICON[user.kycStatus] ?? STATUS_ICON[KycStatus.NOT_STARTED];

  return (
    <div className="space-y-12">
      {/* Status header card */}
      <div className="relative isolate overflow-hidden rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-8">
        <div
          aria-hidden
          className="absolute -top-20 -right-20 -z-10 h-56 w-56 rounded-full bg-pale blur-3xl"
        />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <IconChip tone={statusIcon.tone}>{statusIcon.icon}</IconChip>
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
                Identity verification
              </p>
              <h2 className="font-display mt-0.5 text-2xl font-semibold tracking-[-0.02em] text-primary">
                {config.title}
              </h2>
            </div>
          </div>
          <span
            className={`rounded-full border px-4 py-1.5 text-xs font-semibold tracking-wider uppercase ${config.badge}`}
          >
            {user.kycStatus}
          </span>
        </div>

        <p className="mt-5 max-w-3xl text-sm leading-relaxed text-body">
          {config.description}
        </p>

        {/* Rejection notes */}
        {user.kycStatus === KycStatus.REJECTED && latestSubmission?.reviewNotes && (
          <div className="mt-5 rounded-2xl border border-danger/20 bg-danger/5 p-4">
            <p className="text-xs font-semibold tracking-wide text-danger uppercase">
              Compliance Notes
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-secondary">
              {latestSubmission.reviewNotes}
            </p>
          </div>
        )}
      </div>

      {canStartProvider && (
        <section className="space-y-5">
          <InvestorSectionTitle title="Verify with our" tail="identity partner" />
          <div className="flex flex-col gap-5 rounded-3xl border border-accent/20 bg-pale/70 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
            <div className="flex items-start gap-3">
              <IconChip>
                <ShieldIcon />
              </IconChip>
              <p className="max-w-2xl text-sm leading-relaxed text-body">
                {user.kycStatus === KycStatus.PENDING
                  ? "Your verification is in progress. Continue where you left off; we update your status as soon as our partner has a result."
                  : "The quickest route: verify your identity online with PropLink's regulated verification partner. It usually takes a few minutes. PropLink stores only the result, not your documents."}
              </p>
            </div>
            <div className="shrink-0">
              <VerifyButton
                label={
                  user.kycStatus === KycStatus.PENDING
                    ? "Continue verification"
                    : "Verify my identity"
                }
              />
            </div>
          </div>
        </section>
      )}

      {/* Submission history */}
      {latestSubmission && (
        <section className="space-y-5">
          <InvestorSectionTitle title="Application" tail="status" />
          <div className="overflow-hidden rounded-3xl border border-line bg-white">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-5">
              <div>
                <p className="text-sm font-semibold text-primary">KYC Application</p>
                <p className="mt-0.5 text-xs text-muted">
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
        </section>
      )}

      {/* KYC submission form — shown only when the investor can submit/resubmit */}
      {config.showForm && draft && (
        <section className="space-y-5">
          <InvestorSectionTitle
            title={user.kycStatus === KycStatus.REJECTED ? "Resubmit your" : "Or submit"}
            tail={user.kycStatus === KycStatus.REJECTED ? "application" : "documents"}
            description="Upload documents for the PropLink compliance team to review."
          />
          <div className="rounded-3xl border border-line bg-white p-6 sm:p-7">
            <KycSubmissionForm
              submissionId={draft.submissionId}
              initialDocumentCount={draft.documentCount}
            />
          </div>
        </section>
      )}

      {/* What to expect */}
      {user.kycStatus === KycStatus.NOT_STARTED && (
        <section className="space-y-5">
          <InvestorSectionTitle title="What to" tail="expect" />
          <ol className="grid gap-4 sm:grid-cols-3">
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
              <li key={item.step} className="rounded-3xl border border-line bg-white p-6">
                <span className="font-display inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
                  {item.step}
                </span>
                <h3 className="mt-4 font-semibold text-primary">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{item.body}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Regulatory notice */}
      <section className="rounded-3xl border border-line bg-surface/70 p-6 sm:p-7">
        <div className="flex items-start gap-3">
          <IconChip>
            <ShieldIcon />
          </IconChip>
          <div>
            <h2 className="font-semibold text-primary">Security & compliance boundary</h2>
            <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted">
              PropLink operates under UK financial and anti-money laundering (AML)
              regulatory boundaries. Investor identity verification protects all syndicate
              participants and ensures compliance prior to any financial commitment.
              Documents are stored in a private, encrypted storage vault and are only
              accessible to PropLink compliance personnel.
            </p>
            <div className="mt-4">
              <ArrowLink href="/investor">Back to dashboard</ArrowLink>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
