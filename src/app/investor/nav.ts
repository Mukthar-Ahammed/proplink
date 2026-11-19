import type { PortalNavItem } from "@/components/portal/PortalShell";
import { InvestorType } from "@/generated/prisma/enums";

/**
 * Investor navigation. Phase 4 (ADR-044): every investor uses the Investor
 * Portal's projects whatever their legacy subtype; Lead / Co-Investor is a
 * per-project role. The legacy Flipper workspace appears only while
 * FLIPPER_FLOWS_ENABLED (and financial-promotions review) is on; the legacy
 * Syndicate Deals page is replaced by Projects.
 */
export function getInvestorNav(
  investorType: InvestorType | null,
  flipperFlowsEnabled = false,
): PortalNavItem[] {
  const nav: PortalNavItem[] = [
    { href: "/investor", label: "Dashboard" },
    { href: "/investor/projects", label: "Projects" },
    { href: "/messages", label: "Messages" },
  ];
  if (
    flipperFlowsEnabled &&
    (investorType === InvestorType.FLIPPER || investorType === InvestorType.BOTH)
  ) {
    nav.push({ href: "/investor/flip", label: "Flipper Workspace" });
  }
  nav.push(
    { href: "/investor/kyc", label: "Identity & Verification" },
    { href: "/account/reviews", label: "Reviews" },
    { href: "/investor/profile", label: "My profile" },
    { href: "/account/notifications", label: "Notifications" },
  );
  return nav;
}

export const INVESTOR_NAV: PortalNavItem[] = [{ href: "/investor", label: "Dashboard" }];
