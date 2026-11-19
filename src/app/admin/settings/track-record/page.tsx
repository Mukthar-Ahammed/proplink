import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ActionButton } from "@/components/projects/ActionButton";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { isFinancialPromotionsReviewed } from "@/env";
import { requireAdminPagePermission } from "@/lib/authz";
import { getTrackRecordSettings, ROI_LABEL } from "@/services/profiles/trackRecord";

import { setHistoricalRoiAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — Track record | PropLink" };

/**
 * Track record settings (Phase 5 Task 5, ADR-055). Historical ROI is an
 * owner decision (OD-07); the default formula is shown only when this flag is
 * on and the financial promotions review is complete.
 */
export default async function AdminTrackRecordPage() {
  await requireAdminPagePermission("SYSTEM_INTEGRATIONS");
  const { showHistoricalRoi } = await getTrackRecordSettings();
  const reviewed = isFinancialPromotionsReviewed();
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Track record"
        description="Profiles show figures the server computes from platform data: properties handled, completed projects, average completion time, success rate and membership. Nobody can edit them."
      />
      <Card>
        <CardTitle>Historical ROI</CardTitle>
        <CardBody>
          <div className="space-y-3 text-sm text-body">
            <p>
              When on, profiles add <strong>{ROI_LABEL}</strong>: for each sale the
              Solicitor confirmed, net profit divided by purchase price plus itemised
              costs, averaged. The formula is a default until the owner defines it
              (OD-07).
            </p>
            <p data-testid="roi-state">
              Flag: <strong>{showHistoricalRoi ? "on" : "off"}</strong>. Financial
              promotions review: <strong>{reviewed ? "complete" : "not complete"}</strong>
              .
              {reviewed
                ? showHistoricalRoi
                  ? " ROI is shown on profiles."
                  : " ROI is hidden."
                : " ROI stays hidden on every public page until the review is complete, whatever this flag says."}
            </p>
            <ActionButton
              action={setHistoricalRoiAction}
              hidden={{ on: showHistoricalRoi ? "false" : "true" }}
              label={showHistoricalRoi ? "Turn off" : "Turn on"}
              tone={showHistoricalRoi ? "secondary" : "primary"}
            />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
