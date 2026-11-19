import { PortalShell } from "@/components/portal/PortalShell";
import { getInvestorNav } from "@/app/investor/nav";
import { requirePageRole } from "@/lib/authz";

export default async function InvestorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requirePageRole("INVESTOR");
  const nav = getInvestorNav(session.user.investorType);

  return (
    <PortalShell
      eyebrow="Investor portal"
      title="Your syndicates,"
      titleTail="your position"
      standfirst="Expressions of interest, funding progress and the projects behind them."
      nav={nav}
      banner={{ src: "/banners/investor%20portal%20banner.png" }}
    >
      {children}
    </PortalShell>
  );
}
