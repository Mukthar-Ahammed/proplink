"use server";

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getESignProvider, getMockESignProvider } from "@/services/esign";
import { processESignWebhook } from "@/services/projects/agreements";

export type MockSignState = { kind: "idle" } | { kind: "error"; message: string };

/**
 * Sign or decline with the mock provider: builds the provider's signed event
 * and runs it through the same verified webhook processing as a real one.
 */
export async function mockSignAction(
  _previous: MockSignState,
  formData: FormData,
): Promise<MockSignState> {
  if (getESignProvider().name !== "mock")
    return { kind: "error", message: "Not available" };
  const session = await auth();
  if (!session?.user) return { kind: "error", message: "Sign in again" };
  const provider = getMockESignProvider();
  const link = provider.verifySigningLink(
    new URLSearchParams(String(formData.get("query") ?? "")),
  );
  if (!link) return { kind: "error", message: "This signing link has expired" };
  const party = await db.agreementParty.findFirst({
    where: { providerSignerId: link.signerId, profileId: session.user.authUserId },
    select: { id: true },
  });
  if (!party) return { kind: "error", message: "This signing link is not yours" };
  const decline = formData.get("decision") === "decline";
  const event = provider.signedEvent(
    decline ? "DECLINED" : "SIGNED",
    link.envelopeId,
    link.signerId,
  );
  const result = await processESignWebhook(event.rawBody, event.headers);
  if (!result.ok)
    return { kind: "error", message: "The signature could not be recorded" };
  redirect(link.returnPath);
}
