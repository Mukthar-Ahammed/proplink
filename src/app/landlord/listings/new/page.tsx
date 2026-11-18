import { requirePageRole } from "@/lib/authz";
import { PortalSection } from "@/components/portal/PortalShell";

import { NewListingForm } from "./NewListingForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "List a property — PropLink UK" };

/** Start a private listing (Phase 2 Task 1). Saved as a draft straight away. */
export default async function NewLandlordListingPage() {
  await requirePageRole("LANDLORD");
  return (
    <PortalSection title="List a property">
      <p className="mb-6 max-w-2xl text-sm text-muted">
        Start with a short title. Your listing is saved as a private draft; nobody else
        sees it until you submit it and PropLink approves it, and then only verified
        agents.
      </p>
      <NewListingForm />
    </PortalSection>
  );
}
