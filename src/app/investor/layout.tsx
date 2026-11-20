import { PortalShell } from "@/components/portal/PortalShell";
import { INVESTOR_FRAME } from "@/components/portal/portalFrames";
import { getInvestorNav } from "@/app/investor/nav";
import { areFlipperFlowsEnabled } from "@/env";
import { requirePageRole } from "@/lib/authz";

export default async function InvestorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requirePageRole("INVESTOR");
  const nav = getInvestorNav(session.user.investorType, areFlipperFlowsEnabled());

  return (
    <PortalShell {...INVESTOR_FRAME} nav={nav}>
      {children}
    </PortalShell>
  );
}
