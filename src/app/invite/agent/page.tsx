import { AcceptAgentInviteForm } from "./AcceptAgentInviteForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Accept your agent invitation",
  robots: { index: false, follow: false },
};

/**
 * Agent invitation acceptance (Phase 1 Task 3, ADR-023). The token lives in the
 * URL fragment, so it never reaches the server in the page request, logs or a
 * Referer header; the form reads it in the browser and sends it only to the
 * server actions.
 */
export default function AcceptAgentInvitePage() {
  return <AcceptAgentInviteForm />;
}
