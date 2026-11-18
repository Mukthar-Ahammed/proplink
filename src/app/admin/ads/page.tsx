import { requireAdminPagePermission } from "@/lib/authz";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export const metadata = { title: "Admin — Ad Campaigns" };

export default async function AdsPage() {
  await requireAdminPagePermission("ADVERTISER_MANAGEMENT");

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Ad Campaign & Promotion Management"
        description="Configure banner slots, featured deal placements, and agent promotion allocations."
      />

      <div className="rounded-xl border border-line bg-white p-8 text-center shadow-xs">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-pale text-brand mb-4">
          📢
        </div>
        <h2 className="text-base font-bold text-primary">
          Operational Surface Placeholder
        </h2>
        <p className="mt-2 text-xs text-muted max-w-md mx-auto">
          Ad campaign dashboard arrives with the Ecosystem Marketplace (Sprint 6, Task 6.3
          / Phase A7).
        </p>
      </div>
    </div>
  );
}
