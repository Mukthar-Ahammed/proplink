import "server-only";

import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/authz";
import { Role, InvestorType } from "@/generated/prisma/enums";
import { FlipperWorkspaceClient } from "./FlipperWorkspaceClient";

export const metadata = { title: "Investor — Flipper Workspace" };

export default async function FlipperWorkspacePage() {
  const session = await requirePageRole(Role.INVESTOR);

  // Subtype Gate: Restrict Flipper workspace exclusively to FLIPPER or BOTH subtypes
  const isFlipperEligible =
    session.user.investorType === InvestorType.FLIPPER ||
    session.user.investorType === InvestorType.BOTH;

  if (!isFlipperEligible) {
    redirect("/investor");
  }

  return <FlipperWorkspaceClient />;
}
