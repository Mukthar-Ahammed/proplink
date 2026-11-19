import "server-only";

import { redirect } from "next/navigation";
import { requirePageRole } from "@/lib/authz";
import { Role, InvestorType } from "@/generated/prisma/enums";
import { ProjectDetailClient } from "./ProjectDetailClient";

export const metadata = { title: "Investor — Refurbishment Project Detail" };

export default async function ProjectDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePageRole(Role.INVESTOR);

  const isFlipperEligible =
    session.user.investorType === InvestorType.FLIPPER ||
    session.user.investorType === InvestorType.BOTH;

  if (!isFlipperEligible) {
    redirect("/investor");
  }

  const { id } = await props.params;

  return <ProjectDetailClient projectId={id} />;
}
