import { Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardBody, CardTitle } from "@/components/ui/card";

import { OnBehalfForm } from "./OnBehalfForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — List for a Landlord | PropLink" };

/**
 * TRD permission matrix: Admin may create a private listing on a Landlord's
 * behalf, audited. The Landlord owns it and must confirm before it is
 * submitted (Phase 2 Task 1, ADR-034).
 */
export default async function AdminOnBehalfListingPage() {
  await requirePageRole(Role.ADMIN);
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="List a property for a Landlord"
        description="The listing belongs to the Landlord. They confirm it (and must have passed their identity check) before it enters the review queue. This action is logged."
      />
      <Card>
        <CardTitle>Listing details</CardTitle>
        <CardBody>
          <OnBehalfForm />
        </CardBody>
      </Card>
    </div>
  );
}
