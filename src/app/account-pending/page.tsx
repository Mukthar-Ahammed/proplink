import { requirePageRole } from "@/lib/authz";
import { KycStatus, Role } from "@/generated/prisma/enums";
import { getProviderApplicantState } from "@/services/kyc/providerVerification";
import { VerifyButton } from "@/app/verify/VerifyButton";

export const dynamic = "force-dynamic";

const ROLE_COPY: Partial<Record<Role, { title: string; body: string }>> = {
  LANDLORD: {
    title: "Landlord account",
    body: "Your account is set up. Private listings, the Admin review queue and agent offers open in the next release.",
  },
  SOLICITOR: {
    title: "Solicitor account",
    body: "Your account is set up. Project documents, agreements and the ledger open once the project you are assigned to is live.",
  },
  ADVERTISER: {
    title: "Advertiser account",
    body: "Your account is set up. Placement requests and Admin-approved slots open in a later release.",
  },
};

/**
 * Holding page for roles whose portal ships in a later phase (ADR-021):
 * Landlord (Phase 2), Solicitor (Phase 4) and Advertiser (Phase 6).
 */
export default async function AccountPendingPage() {
  const session = await requirePageRole(Role.LANDLORD, Role.SOLICITOR, Role.ADVERTISER);
  const copy = ROLE_COPY[session.user.role] ?? {
    title: "Your account",
    body: "Your account is set up.",
  };

  const isLandlord = session.user.role === Role.LANDLORD;
  const kycStatus = session.user.kycStatus;
  const provider = isLandlord
    ? await getProviderApplicantState(session.user.authUserId)
    : null;
  const canVerify =
    isLandlord &&
    (kycStatus === KycStatus.NOT_STARTED ||
      kycStatus === KycStatus.REJECTED ||
      (kycStatus === KycStatus.PENDING && provider?.sameProvider === true));

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-bold text-primary">{copy.title}</h1>
      <p className="mt-4 text-body">{copy.body}</p>
      <p className="mt-4 text-sm text-muted">
        We will email you when your portal is ready.
      </p>
      {isLandlord && (
        <section
          className="mt-10 rounded-lg border border-line bg-white p-5"
          data-testid="landlord-kyc"
        >
          <h2 className="text-lg font-semibold text-primary">Identity verification</h2>
          <p className="mt-2 text-sm text-muted">
            {kycStatus === KycStatus.APPROVED
              ? "Your identity is verified."
              : kycStatus === KycStatus.REJECTED
                ? "Your last verification was not approved. You can try again."
                : kycStatus === KycStatus.PENDING
                  ? "Your verification is in progress."
                  : "Landlords verify their identity before listing. It takes a few minutes, and PropLink stores only the result, not your documents."}
          </p>
          {canVerify && (
            <div className="mt-4">
              <VerifyButton
                label={
                  kycStatus === KycStatus.PENDING
                    ? "Continue verification"
                    : "Verify my identity"
                }
              />
            </div>
          )}
        </section>
      )}
    </main>
  );
}
