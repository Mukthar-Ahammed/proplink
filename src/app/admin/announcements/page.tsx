import { Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { listAnnouncementsForAdmin } from "@/services/announcements/announcements";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Card, CardBody, CardTitle } from "@/components/ui/card";

import { archiveAnnouncementAction } from "./actions";
import { AnnouncementForm } from "./AnnouncementForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — Announcements | PropLink" };

function formatDate(value: Date | null): string {
  return value ? value.toISOString().slice(0, 16).replace("T", " ") : "—";
}

function stateOf(
  item: { startsAt: Date; endsAt: Date | null; archivedAt: Date | null },
  now: Date,
) {
  if (item.archivedAt) return "ARCHIVED";
  if (item.startsAt > now) return "SCHEDULED";
  if (item.endsAt && item.endsAt <= now) return "ENDED";
  return "LIVE";
}

/**
 * Admin-managed banners and platform updates (Phase 1 Task 3, business Q1).
 * PropLink's own messaging only; paid advertising is a separate Phase 6 module.
 */
export default async function AdminAnnouncementsPage() {
  await requirePageRole(Role.ADMIN);
  const announcements = await listAnnouncementsForAdmin();
  const now = new Date();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Announcements"
        description="Promotional banners and platform updates shown in user dashboards. Plain text only; no links or third-party content. Separate from paid advertising."
      />

      <Card>
        <CardTitle>New announcement</CardTitle>
        <CardBody>
          <AnnouncementForm defaultStart={now.toISOString().slice(0, 16)} />
        </CardBody>
      </Card>

      <Card>
        <CardTitle>All announcements</CardTitle>
        <CardBody>
          {announcements.length === 0 ? (
            <p className="text-sm text-muted">No announcements yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {announcements.map((item) => {
                const state = stateOf(item, now);
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-start justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="font-semibold text-primary">{item.title}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {item.kind === "BANNER" ? "Banner" : "Update"} · for{" "}
                        {item.audienceRoles.join(", ")} · {formatDate(item.startsAt)} →{" "}
                        {formatDate(item.endsAt)} UTC
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={state} />
                      {state !== "ARCHIVED" && (
                        <form action={archiveAnnouncementAction}>
                          <input type="hidden" name="id" value={item.id} />
                          <button
                            type="submit"
                            className="text-sm font-semibold text-danger underline"
                          >
                            Archive
                          </button>
                        </form>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
