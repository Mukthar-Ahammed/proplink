import type { PortalNavItem } from "@/components/portal/PortalShell";

/**
 * The agent portal's navigation, in one place because the global header carries
 * none (ADR-009) — a page missing from this list is unreachable.
 */
export const AGENT_NAV: PortalNavItem[] = [
  { href: "/agent", label: "Dashboard" },
  { href: "/agent/listings", label: "Listings" },
  { href: "/agent/marketplace", label: "Landlord listings" },
  { href: "/agent/mandates", label: "Mandates" },
  { href: "/agent/projects", label: "Investor projects" },
  { href: "/messages", label: "Messages" },
  { href: "/agent/leads", label: "Leads" },
  { href: "/agent/profile", label: "Profile" },
  { href: "/agent/company", label: "Company" },
  { href: "/account/billing", label: "Billing" },
  { href: "/account/profile", label: "My profile" },
  { href: "/account/notifications", label: "Notifications" },
];
