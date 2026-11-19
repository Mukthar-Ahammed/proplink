import { notFound } from "next/navigation";

import { Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { isMockFlowAvailable } from "@/services/kyc/providerVerification";

import { completeMockVerificationAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mock identity verification" };

/**
 * Development-only stand-in for the provider's hosted flow (ADR-026). Returns
 * 404 unless the mock provider is active outside production.
 */
export default async function MockVerificationPage() {
  if (!isMockFlowAvailable()) notFound();
  await requirePageRole(Role.LANDLORD, Role.INVESTOR);

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <p className="text-xs font-semibold tracking-wide text-warning uppercase">
        Development only: mock verification provider
      </p>
      <h1 className="mt-2 text-2xl font-bold text-primary">Identity verification</h1>
      <p className="mt-4 text-sm text-muted">
        A real provider would check your identity documents here. Choose the result to
        send as a signed webhook.
      </p>
      <form action={completeMockVerificationAction} className="mt-6 flex flex-wrap gap-3">
        <button
          type="submit"
          name="decision"
          value="APPROVED"
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white"
        >
          Approve
        </button>
        <button
          type="submit"
          name="decision"
          value="REJECTED"
          className="rounded-lg border border-danger px-4 py-2 text-sm font-semibold text-danger"
        >
          Reject
        </button>
      </form>
    </main>
  );
}
