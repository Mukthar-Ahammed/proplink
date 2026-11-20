import { redirect } from "next/navigation";

import { AGENT_NAV } from "@/app/agent/nav";
import { BUYER_NAV } from "@/app/buy/nav";
import { getInvestorNav } from "@/app/investor/nav";
import { LANDLORD_NAV } from "@/app/landlord/nav";
import { PortalShell, type PortalNavItem } from "@/components/portal/PortalShell";
import {
  AGENT_FRAME,
  BUYER_FRAME,
  INVESTOR_FRAME,
  LANDLORD_FRAME,
  type PortalFrame,
} from "@/components/portal/portalFrames";
import { areFlipperFlowsEnabled } from "@/env";
import { Role } from "@/generated/prisma/enums";
import { auth } from "@/lib/auth";
import { PORTAL_HOME, PORTAL_LABEL } from "@/lib/portalHome";

/**
 * Messages wears the viewer's own portal frame (ADR-081): the very same banner
 * masthead and sub-nav as the rest of their portal, so clicking the Messages
 * tab only swaps the content under the tabs, as if it were a portal page.
 * Roles without a portal here (Admin, Solicitor) get the compact masthead
 * with a "Back to" link instead.
 */
const FRAMES: Partial<Record<Role, PortalFrame>> = {
  [Role.AGENT]: AGENT_FRAME,
  [Role.INVESTOR]: INVESTOR_FRAME,
  [Role.LANDLORD]: LANDLORD_FRAME,
  [Role.BUYER]: BUYER_FRAME,
};

function navFor(
  role: Role,
  investorType: Parameters<typeof getInvestorNav>[0],
): PortalNavItem[] {
  switch (role) {
    case Role.AGENT:
      return AGENT_NAV.map((item) =>
        item.href === "/messages" ? { ...item, premium: true } : item,
      );
    case Role.INVESTOR:
      return getInvestorNav(investorType, areFlipperFlowsEnabled());
    case Role.LANDLORD:
      return LANDLORD_NAV;
    case Role.BUYER:
      return BUYER_NAV;
    default:
      return [];
  }
}

export default async function MessagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { role } = session.user;
  const nav = navFor(role, session.user.investorType);
  const frame = FRAMES[role];

  if (frame) {
    return (
      <PortalShell {...frame} nav={nav}>
        {children}
      </PortalShell>
    );
  }

  return (
    <PortalShell
      compact
      back={{ href: PORTAL_HOME[role], label: `Back to ${PORTAL_LABEL[role]}` }}
      eyebrow={PORTAL_LABEL[role]}
      title="Messages"
      nav={nav}
    >
      {children}
    </PortalShell>
  );
}
