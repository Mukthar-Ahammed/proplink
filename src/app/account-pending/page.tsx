import { requirePageRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";

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

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-bold text-primary">{copy.title}</h1>
      <p className="mt-4 text-body">{copy.body}</p>
      <p className="mt-4 text-sm text-muted">
        We will email you when your portal is ready.
      </p>
    </main>
  );
}
