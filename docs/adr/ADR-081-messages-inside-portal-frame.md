# ADR-081: Messages lives inside the viewer's portal frame

- Status: Accepted
- Date: 2026-11-20

## Context

`/messages` used the sign-in screens' gradient-and-grid ground with glassy
cards under a floating header. It looked like a different product from the
portals, and on desktop there was no way back to the portal except the site
header.

## Decision

- `src/app/messages/layout.tsx` wraps Messages in `PortalShell` using the
  signed-in role's own sub-nav (Agent, Investor, Landlord, Buyer), so the
  Messages tab is marked current and every other portal tab is one click away.
  A "Back to <portal>" link sits above the eyebrow.
- `PortalShell` gains `compact` (no banner, smaller headline, tighter padding,
  for pages that need vertical space) and `back`.
- `MessagesShell` is now just the two-pane grid; the list and the chat are
  plain white hairline cards like `Panel` (ADR-080). The thread list's heading
  is "Conversations" (`<h2>`); the page's `<h1>` is the masthead's "Messages".
- `/messages` is no longer an overlay route in `ChromeGate`.
- Phones still show one pane at a time; the chat header's back arrow returns to
  the list.

## Amendment (2026-11-20): full portal masthead

- Agents, Investors, Landlords and Buyers now see their portal's full banner
  masthead on Messages, not the compact one. The four mastheads live in
  `src/components/portal/portalFrames.ts` and both the portal layouts and
  `messages/layout.tsx` use them, so clicking the Messages tab only changes the
  content under the tabs. `/messages` is an overlay route in `ChromeGate`.
- `compact` with a back link remains for Admin and Solicitor; it pads its top
  to clear the floating header.
- The root `src/app/loading.tsx` is gone (ADR-077 amendment). It replaced the
  whole page while `/messages` loaded. `messages/loading.tsx` shows the spinner
  under the tabs instead.

## Consequences

Roles without a portal nav here (Admin, Solicitor) get the compact masthead
with a back link and no tabs. Admin reads chats through `/admin/chats`.
