import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getESignProvider, getMockESignProvider } from "@/services/esign";

import { MockSignForm } from "./MockSignForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign (development)", robots: { index: false } };

/**
 * The mock e-signature provider's signing page (ADR-048; development and
 * tests only; 404 with a real provider). The link is HMAC-signed and
 * expires; only the party it was issued for may use it.
 */
export default async function MockSigningPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (getESignProvider().name !== "mock") notFound();
  const session = await auth();
  if (!session?.user) redirect("/login");
  const params = new URLSearchParams(
    Object.entries(await searchParams).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const link = getMockESignProvider().verifySigningLink(params);
  if (!link) notFound();
  const party = await db.agreementParty.findFirst({
    where: { providerSignerId: link.signerId, profileId: session.user.authUserId },
    select: {
      signerStatus: true,
      sharePpm: true,
      agreement: {
        select: {
          title: true,
          version: true,
          envelopeId: true,
          project: { select: { title: true } },
        },
      },
    },
  });
  if (!party || party.agreement.envelopeId !== link.envelopeId) notFound();
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12">
      <p className="text-xs font-semibold tracking-wide text-warning uppercase">
        Development signing (mock provider, no legal effect)
      </p>
      <h1 className="mt-2 text-2xl font-bold text-primary">
        {party.agreement.project.title}: {party.agreement.title} (v
        {party.agreement.version})
      </h1>
      {party.signerStatus === "PENDING" ? (
        <MockSignForm query={params.toString()} />
      ) : (
        <p className="mt-4 text-sm text-body">
          You have already responded to this agreement.
        </p>
      )}
    </main>
  );
}
