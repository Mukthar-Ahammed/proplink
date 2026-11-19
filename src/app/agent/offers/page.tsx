import { PortalSection } from "@/components/portal/PortalShell";
import { ActionButton } from "@/components/projects/ActionButton";
import { day } from "@/components/projects/format";
import {
  agentOfferFormAction,
  agentViewingFormAction,
} from "@/components/buy/negotiationActions";
import { Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { agentQueue } from "@/services/buyers/negotiation";
import { formatPenceGBP } from "@/services/metrics/globalMetrics";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Agent — Offers and viewings",
  robots: { index: false },
};

const OFFER: Record<string, string> = {
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  COUNTER_OFFERED: "Counter-offered",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
  EXPIRED: "Expired",
};
const input = "rounded-lg border border-line bg-white px-2 py-1 text-sm text-body";
const time = (value: Date) => value.toISOString().slice(0, 16).replace("T", " ");

/** Offers and viewings on the Agent's listings (Phase 5 Task 2, ADR-053). */
export default async function AgentOffersPage() {
  const session = await requirePageRole(Role.AGENT);
  const { offers, viewings } = await agentQueue({
    userId: session.user.id,
    role: session.user.role,
  });
  return (
    <>
      <PortalSection title="Offers">
        {offers.length === 0 ? (
          <p className="text-sm text-muted">No offers yet.</p>
        ) : (
          <ul className="space-y-3" data-testid="agent-offers">
            {offers.map((offer) => {
              const open = ["SUBMITTED", "UNDER_REVIEW"].includes(offer.status);
              return (
                <li
                  key={offer.id}
                  className="rounded-lg border border-line bg-white p-4 text-sm"
                >
                  <p className="font-semibold text-primary">
                    {offer.property.title} · {formatPenceGBP(offer.amountGBP)} (asking{" "}
                    {formatPenceGBP(offer.property.askingPriceGBP)})
                  </p>
                  <p className="text-muted">
                    {offer.buyer.name ?? "Buyer"} · {OFFER[offer.status]}
                    {offer.counterAmountGBP && offer.status === "COUNTER_OFFERED"
                      ? ` · your counter ${formatPenceGBP(offer.counterAmountGBP)} until ${day(offer.expiresAt)}`
                      : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {offer.events
                      .map(
                        (event) =>
                          `${day(event.createdAt)} ${OFFER[event.toStatus] ?? event.toStatus}`,
                      )
                      .join(" → ")}
                  </p>
                  {open && (
                    <div className="mt-2 flex flex-wrap gap-3">
                      {offer.status === "SUBMITTED" && (
                        <ActionButton
                          action={agentOfferFormAction}
                          hidden={{ offerId: offer.id, action: "review" }}
                          label="Mark under review"
                          tone="secondary"
                        />
                      )}
                      <ActionButton
                        action={agentOfferFormAction}
                        hidden={{ offerId: offer.id, action: "accept" }}
                        label="Accept"
                      />
                      <ActionButton
                        action={agentOfferFormAction}
                        hidden={{ offerId: offer.id, action: "counter" }}
                        label="Counter"
                        tone="secondary"
                      >
                        <div className="flex gap-2">
                          <input
                            name="counter"
                            required
                            placeholder="£"
                            className={input}
                            aria-label="Counter-offer (£)"
                          />
                          <input
                            name="days"
                            type="number"
                            min={1}
                            max={14}
                            defaultValue={3}
                            className={input}
                            aria-label="Days to respond"
                          />
                        </div>
                      </ActionButton>
                      <ActionButton
                        action={agentOfferFormAction}
                        hidden={{ offerId: offer.id, action: "reject" }}
                        label="Reject"
                        tone="danger"
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PortalSection>
      <PortalSection title="Viewings">
        {viewings.length === 0 ? (
          <p className="text-sm text-muted">No viewing requests.</p>
        ) : (
          <ul className="space-y-2 text-sm" data-testid="agent-viewings">
            {viewings.map((viewing) => (
              <li key={viewing.id} className="flex flex-wrap items-center gap-3">
                <span className="text-body">
                  {viewing.property.title} · {viewing.buyer.name ?? "Buyer"} ·{" "}
                  {time(viewing.slotStart)} UTC · {viewing.status.toLowerCase()}
                </span>
                {viewing.status === "REQUESTED" && (
                  <>
                    <ActionButton
                      action={agentViewingFormAction}
                      hidden={{ viewingId: viewing.id, action: "confirm" }}
                      label="Confirm"
                    />
                    <ActionButton
                      action={agentViewingFormAction}
                      hidden={{ viewingId: viewing.id, action: "decline" }}
                      label="Decline"
                      tone="secondary"
                    />
                  </>
                )}
                {viewing.status === "CONFIRMED" && (
                  <ActionButton
                    action={agentViewingFormAction}
                    hidden={{ viewingId: viewing.id, action: "done" }}
                    label="Mark done"
                    tone="secondary"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </PortalSection>
    </>
  );
}
