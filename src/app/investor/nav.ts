import type { PortalNavItem } from "@/components/portal/PortalShell";
import { InvestorType } from "@/generated/prisma/enums";

export function getInvestorNav(investorType: InvestorType | null): PortalNavItem[] {
  const base: PortalNavItem[] = [{ href: "/investor", label: "Dashboard" }];

  if (!investorType) {
    return [...base, { href: "/investor/kyc", label: "Identity & Verification" }];
  }

  if (investorType === InvestorType.FLIPPER || investorType === InvestorType.BOTH) {
    base.push({ href: "/investor/flip", label: "Flipper Workspace" });
  }

  if (investorType === InvestorType.SYNDICATE || investorType === InvestorType.BOTH) {
    base.push({ href: "/investor/syndicates", label: "Syndicate Deals" });
  }

  base.push({ href: "/investor/kyc", label: "Identity & Verification" });
  return base;
}

export const INVESTOR_NAV: PortalNavItem[] = [{ href: "/investor", label: "Dashboard" }];
