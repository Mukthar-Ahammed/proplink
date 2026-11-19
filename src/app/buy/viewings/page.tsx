import { requirePageRole } from "@/lib/authz";
import { listBuyerViewings } from "@/services/viewings/viewingService";
import { PortalEmpty } from "@/components/portal/PortalShell";
import { ActivityList, type ActivityItem } from "@/components/buy/ActivityList";
import { ActionButton } from "@/components/projects/ActionButton";
import { buyerViewingFormAction } from "@/components/buy/negotiationActions";

export const dynamic = "force-dynamic";

const SLOT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function ViewingsPage() {
  const { user } = await requirePageRole("BUYER");

  const viewings = await listBuyerViewings(user.id);

  if (viewings.length === 0) {
    return (
      <PortalEmpty>
        No viewings requested. Ask for a slot from any live listing and it appears here
        once the agent has seen it.
      </PortalEmpty>
    );
  }

  const items: ActivityItem[] = viewings.map((v) => ({
    id: v.id,
    href: `/marketplace/${v.property.id}`,
    title: v.property.title,
    meta: SLOT.format(v.slotStart),
    status: v.status,
    detail: v.status === "REQUESTED" ? "Waiting for the agent to confirm" : undefined,
  }));

  const upcoming = viewings.filter(
    (v) => v.status === "REQUESTED" || v.status === "CONFIRMED",
  );
  return (
    <>
      {upcoming.length > 0 && (
        <ul className="mb-8 space-y-3" data-testid="buyer-viewings">
          {upcoming.map((v) => (
            <li key={v.id} className="rounded-lg border border-line bg-white p-4 text-sm">
              <p className="font-semibold text-primary">
                {v.property.title} · {SLOT.format(v.slotStart)} ·{" "}
                {v.status === "CONFIRMED" ? "confirmed" : "waiting for the agent"}
              </p>
              <div className="mt-2 flex flex-wrap gap-3">
                <ActionButton
                  action={buyerViewingFormAction}
                  hidden={{ viewingId: v.id, action: "reschedule" }}
                  label="Ask for a new time"
                  tone="secondary"
                >
                  <input
                    name="slot"
                    type="datetime-local"
                    required
                    aria-label="New time"
                    className="rounded-lg border border-line px-2 py-1 text-sm"
                  />
                </ActionButton>
                <ActionButton
                  action={buyerViewingFormAction}
                  hidden={{ viewingId: v.id, action: "cancel" }}
                  label="Cancel viewing"
                  tone="danger"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <ActivityList items={items} />
    </>
  );
}
