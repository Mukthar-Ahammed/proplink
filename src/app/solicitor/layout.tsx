import { PortalShell } from "@/components/portal/PortalShell";
import { requirePageRole } from "@/lib/authz";

/**
 * The Solicitor portal (Phase 4 Task 5, ADR-047). requirePageRole enforces
 * the role and the mandatory second factor (ADR-030); every page and action
 * also checks the Solicitor is ACTIVE on that project.
 */
export default async function SolicitorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePageRole("SOLICITOR");
  return (
    <PortalShell
      eyebrow="Solicitor portal"
      title="Your project,"
      titleTail="on record"
      standfirst="Agreements, funds status, costs and settlement for the one project you are appointed to. No money moves through PropLink."
      nav={[
        { href: "/solicitor", label: "Project" },
        { href: "/account/profile", label: "My profile" },
        { href: "/account/notifications", label: "Notifications" },
      ]}
    >
      {children}
    </PortalShell>
  );
}
