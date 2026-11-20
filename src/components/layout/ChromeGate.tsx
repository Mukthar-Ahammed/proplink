"use client";

import { usePathname } from "next/navigation";

/**
 * Decides where the global chrome (`SiteHeader`, `SiteFooter`) appears and how.
 *
 * - **Bare routes** (the auth flow) carry their own full-page shell —
 *   see `<AuthShell>` — so the chrome is not rendered at all. Whole-group, not
 *   just `/login` and `/register`: chrome that reappears when you click
 *   "Forgot password?" reads as a bug.
 * - **`/admin/*`** wears `<AdminShell>`, which has its own header and sign-out,
 *   so the public chrome is hidden there too rather than stacked above it.
 * - **Overlay routes** open on a coloured hero that should run up behind the
 *   floating header pill, so the header takes no layout space there (ADR-071).
 *   The landing page and the agent, buyer, investor and landlord portals (whose mastheads carry
 *   a photo banner); elsewhere the pill sits in flow above the page.
 *
 * A client gate because `<SiteHeader>` is an async server component rendered by
 * the layout, which has no pathname. `usePathname` resolves during SSR, so there
 * is no flash of chrome that then disappears. The variant is published as a data
 * attribute and the header's utilities (`group-data-[overlay=true]/chrome:…`)
 * respond to it.
 */
const BARE_ROUTES = [
  "/login",
  "/admin/login",
  "/admin-login",
  "/register",
  "/check-email",
  "/auth/confirm",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  // Invite acceptance pages render `<AuthShell>` too; a signed-in admin
  // opening the link would otherwise see their own header above the card.
  "/invite/agent",
  "/invite/solicitor",
];

const SHELL_PREFIXES = ["/admin"];

const OVERLAY_ROUTES = ["/"];
/** Every page under these opens on a banner masthead (`<PortalShell banner>`). */
const OVERLAY_PREFIXES = ["/agent", "/buy", "/investor", "/landlord", "/messages"];

export function ChromeGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (BARE_ROUTES.includes(pathname)) return null;
  if (SHELL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return null;
  }

  return (
    <div
      className="group/chrome contents"
      data-overlay={
        OVERLAY_ROUTES.includes(pathname) ||
        OVERLAY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
          ? "true"
          : "false"
      }
    >
      {children}
    </div>
  );
}
