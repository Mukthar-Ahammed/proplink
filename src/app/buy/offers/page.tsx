import { requirePageRole } from "@/lib/authz";
import { formatPenceGBP } from "@/services/metrics/globalMetrics";
import { buyerOfferHistory } from "@/services/buyers/negotiation";
import { ActionButton } from "@/components/projects/ActionButton";
import { buyerOfferFormAction } from "@/components/buy/negotiationActions";
import { PortalEmpty } from "@/components/portal/PortalShell";
import { DealTracker } from "@/components/buy/DealTracker";
import { ActivityList, type ActivityItem } from "@/components/buy/ActivityList";

export const dynamic = "force-dynamic";

export default async function OffersPage() {
  const { user } = await requirePageRole("BUYER");

  // Phase 5 Task 2 (ADR-053): statuses, counter-offers and history.
  const offers = await buyerOfferHistory(user.id);

  if (offers.length === 0) {
    return (
      <PortalEmpty>
        No offers submitted. Make an offer from a live listing and track it here.
      </PortalEmpty>
    );
  }

  // An accepted offer has a deal behind it, and the deal is the thing the buyer
  // actually wants to watch — so it gets its own stepper above the list.
  const live = offers.filter((o) => o.deals.length > 0);

  const items: ActivityItem[] = offers.map((o) => ({
    id: o.id,
    href: `/marketplace/${o.property.id}`,
    title: o.property.title,
    meta: formatPenceGBP(o.amountGBP),
    status: o.status,
    detail: `Asking ${formatPenceGBP(o.property.askingPriceGBP)}`,
  }));

  return (
    <>
      {live.map((o) => (
        <div key={o.id} className="mb-10">
          <h2 className="text-lg font-semibold text-primary">{o.property.title}</h2>
          <DealTracker stage={o.deals[0].stage} />
        </div>
      ))}
      <ul className="mb-8 space-y-3" data-testid="buyer-offers">
        {offers
          .filter((o) =>
            ["SUBMITTED", "UNDER_REVIEW", "COUNTER_OFFERED"].includes(o.status),
          )
          .map((o) => (
            <li key={o.id} className="rounded-lg border border-line bg-white p-4 text-sm">
              <p className="font-semibold text-primary">
                {o.property.title} · your offer {formatPenceGBP(o.amountGBP)}
              </p>
              <p className="text-muted">
                {o.status === "COUNTER_OFFERED" && o.counterAmountGBP
                  ? `The agent counter-offered ${formatPenceGBP(o.counterAmountGBP)}${o.expiresAt ? ` (until ${o.expiresAt.toISOString().slice(0, 10)})` : ""}`
                  : o.status === "UNDER_REVIEW"
                    ? "The agent is reviewing your offer"
                    : "Submitted; waiting for the agent"}
              </p>
              <p className="mt-1 text-xs text-muted">
                History:{" "}
                {o.events
                  .map((e) => e.toStatus.toLowerCase().replace("_", " "))
                  .join(" → ")}
              </p>
              <div className="mt-2 flex flex-wrap gap-3">
                {o.status === "COUNTER_OFFERED" && (
                  <ActionButton
                    action={buyerOfferFormAction}
                    hidden={{ offerId: o.id, action: "accept_counter" }}
                    label="Accept counter-offer"
                  />
                )}
                <ActionButton
                  action={buyerOfferFormAction}
                  hidden={{ offerId: o.id, action: "withdraw" }}
                  label="Withdraw"
                  tone="secondary"
                />
              </div>
            </li>
          ))}
      </ul>
      <ActivityList items={items} />
    </>
  );
}
