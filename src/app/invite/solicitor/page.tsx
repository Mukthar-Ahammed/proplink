import { AcceptSolicitorInviteForm } from "./AcceptSolicitorInviteForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Accept your Solicitor appointment",
  robots: { index: false, follow: false },
};

/**
 * Solicitor invitation acceptance (Phase 4 Task 5, ADR-047). The token lives
 * in the URL fragment, so it never reaches the server in the page request,
 * logs or a Referer header.
 */
export default function AcceptSolicitorInvitePage() {
  return <AcceptSolicitorInviteForm />;
}
