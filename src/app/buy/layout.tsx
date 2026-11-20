import { PortalShell } from "@/components/portal/PortalShell";
import { BUYER_FRAME } from "@/components/portal/portalFrames";
import { BUYER_NAV } from "@/app/buy/nav";
import { requirePageRole } from "@/lib/authz";

/**
 * The buyer portal's frame (ADR-016, ADR-017). Role gating is
 * `src/middleware.ts` (BUYER/ADMIN) plus each page's own `auth()` check.
 */
export default async function BuyerLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole("BUYER");

  return (
    <PortalShell {...BUYER_FRAME} nav={BUYER_NAV}>
      {children}
    </PortalShell>
  );
}
