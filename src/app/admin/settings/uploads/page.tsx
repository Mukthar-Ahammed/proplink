import { requireAdminPagePermission } from "@/lib/authz";
import { getUploadSettings, uploadsEnabled } from "@/services/uploads/pipeline";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardBody, CardTitle } from "@/components/ui/card";

import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — Upload limits | PropLink" };

const MB = 1024 * 1024;

/** Admin-configurable upload limits (Phase 1 Task 12, ADR-031). */
export default async function AdminUploadSettingsPage() {
  await requireAdminPagePermission("SYSTEM_INTEGRATIONS");
  const settings = await getUploadSettings();
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Upload limits"
        description="Every file type is accepted, quarantined, checked against its real contents and scanned for malware before anyone can download it."
      />
      <Card>
        <CardTitle>Limits</CardTitle>
        <CardBody>
          <p className="mb-4 text-sm text-muted">
            Uploads are{" "}
            {uploadsEnabled()
              ? "enabled"
              : "disabled in this environment until storage and the malware scanner are configured"}
            .
          </p>
          <SettingsForm
            maxFileMb={Math.round(settings.maxFileBytes / MB)}
            userQuotaMb={Math.round(settings.userQuotaBytes / MB)}
          />
        </CardBody>
      </Card>
    </div>
  );
}
