import { requireAdminPagePermission } from "@/lib/authz";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export const metadata = { title: "Admin — Fee Settings" };

export default async function FeesPage() {
  await requireAdminPagePermission("SUBSCRIPTION_PRICING");

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Fee Architecture & Financial Rules"
        description="Configure platform transaction success fees, syndicate management caps, and billing rules."
      />

      <div className="rounded-xl border border-line bg-white p-8 text-center shadow-xs">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-pale text-brand mb-4">
          💳
        </div>
        <h2 className="text-base font-bold text-primary">
          Operational Surface Placeholder
        </h2>
        <p className="mt-2 text-xs text-muted max-w-md mx-auto">
          Success-fee dashboard arrives with Stripe billing (Sprint 5, Task 5.6 / Phase
          A7).
        </p>
      </div>
    </div>
  );
}
