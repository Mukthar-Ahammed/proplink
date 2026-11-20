import { PortalShell } from "@/components/portal/PortalShell";
import { LANDLORD_FRAME } from "@/components/portal/portalFrames";
import { LANDLORD_NAV } from "@/app/landlord/nav";
import { requirePageRole } from "@/lib/authz";

/**
 * The Landlord portal's frame (Phase 2, ADR-034). Role gating is the proxy
 * (LANDLORD) plus each page's and action's own server-side check.
 */
export default async function LandlordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePageRole("LANDLORD");

  return (
    <PortalShell {...LANDLORD_FRAME} nav={LANDLORD_NAV}>
      {children}
    </PortalShell>
  );
}
