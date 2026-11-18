import type { PortalNavItem } from "@/components/portal/PortalShell";

/**
 * Landlord portal navigation (Phase 2, ADR-034). Order follows the design
 * spec §8.4; Proposals and Mandate arrive with Tasks 5 and 6, Projects in
 * Phase 4 and Messages in Phase 3.
 */
export const LANDLORD_NAV: PortalNavItem[] = [
  { href: "/landlord", label: "Overview" },
  { href: "/landlord/listings", label: "My properties" },
  { href: "/landlord/projects", label: "Projects" },
  { href: "/messages", label: "Messages" },
  { href: "/account/profile", label: "Profile" },
  { href: "/account/notifications", label: "Notifications" },
];
