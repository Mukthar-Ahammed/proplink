import { PortalShell } from "@/components/portal/PortalShell";
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
    <PortalShell
      eyebrow="Landlord portal"
      title="Your property,"
      titleTail="privately"
      standfirst="Listings stay private: only PropLink-verified agents see them, after our review."
      nav={LANDLORD_NAV}
    >
      {children}
    </PortalShell>
  );
}
