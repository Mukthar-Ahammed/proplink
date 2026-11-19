import { ActionButton } from "@/components/projects/ActionButton";
import { day } from "@/components/projects/format";
import {
  agentOfferFormAction,
  agentViewingFormAction,
} from "@/components/buy/negotiationActions";
import {
  ClockIcon,
  HomeIcon,
  IconChip,
  InvestorEmpty,
  InvestorSectionTitle,
  StatusPill,
} from "@/components/investor/InvestorUi";
import { Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { agentQueue } from "@/services/buyers/negotiation";
import { formatPenceGBP } from "@/services/metrics/globalMetrics";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Agent — Offers and viewings",
  robots: { index: false },
};

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

const OFFER: Record<string, string> = {
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  COUNTER_OFFERED: "Counter-offered",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
  EXPIRED: "Expired",
};
const OFFER_TONE: Record<string, Tone> = {
  SUBMITTED: "accent",
  UNDER_REVIEW: "warning",
  COUNTER_OFFERED: "warning",
  ACCEPTED: "success",
  REJECTED: "danger",
  WITHDRAWN: "neutral",
  EXPIRED: "neutral",
};
const VIEWING_TONE: Record<string, Tone> = {
  REQUESTED: "accent",
  CONFIRMED: "success",
  DECLINED: "danger",
};
const input =
  "w-28 rounded-xl border border-line bg-white px-3 py-2 text-sm text-body transition-colors placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/15 focus:outline-none";
const time = (value: Date) => value.toISOString().slice(0, 16).replace("T", " ");
const sentence = (value: string) =>
  value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ");

/** Offers and viewings on the Agent's listings (Phase 5 Task 2, ADR-053). */
export default async function AgentOffersPage() {
  const session = await requirePageRole(Role.AGENT);
  const { offers, viewings } = await agentQueue({
    userId: session.user.id,
    role: session.user.role,
  });
  return (
    <div className="space-y-12">
      <section className="space-y-5">
        <InvestorSectionTitle
          title="Offers"
          description="Buyer offers on your live listings. Accept, counter or reject while an offer is open."
        />
        {offers.length === 0 ? (
          <InvestorEmpty title="No offers yet">
            Offers appear here as soon as a buyer makes one on one of your listings.
          </InvestorEmpty>
        ) : (
          <ul className="space-y-4" data-testid="agent-offers">
            {offers.map((offer) => {
              const open = ["SUBMITTED", "UNDER_REVIEW"].includes(offer.status);
              return (
                <li
                  key={offer.id}
                  className="rounded-2xl border border-line bg-white p-5 text-sm transition-shadow hover:shadow-md sm:p-6"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <IconChip>
                        <HomeIcon />
                      </IconChip>
                      <div className="min-w-0">
                        <p className="font-semibold text-primary">
                          {offer.property.title}
                        </p>
                        <p className="mt-0.5 text-muted">{offer.buyer.name ?? "Buyer"}</p>
                      </div>
                    </div>
                    <StatusPill tone={OFFER_TONE[offer.status] ?? "neutral"}>
                      {OFFER[offer.status]}
                    </StatusPill>
                  </div>

                  <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4">
                    <div>
                      <dt className="text-xs text-muted">Offer</dt>
                      <dd className="mt-0.5 font-semibold text-primary tabular-nums">
                        {formatPenceGBP(offer.amountGBP)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted">Asking</dt>
                      <dd className="mt-0.5 font-semibold text-primary tabular-nums">
                        {formatPenceGBP(offer.property.askingPriceGBP)}
                      </dd>
                    </div>
                    {offer.counterAmountGBP && offer.status === "COUNTER_OFFERED" ? (
                      <div className="col-span-2">
                        <dt className="text-xs text-muted">Your counter</dt>
                        <dd className="mt-0.5 font-semibold text-primary tabular-nums">
                          {formatPenceGBP(offer.counterAmountGBP)}{" "}
                          <span className="font-normal text-muted">
                            until {day(offer.expiresAt)}
                          </span>
                        </dd>
                      </div>
                    ) : null}
                  </dl>

                  <p className="mt-4 text-xs text-muted">
                    {offer.events
                      .map(
                        (event) =>
                          `${day(event.createdAt)} ${OFFER[event.toStatus] ?? event.toStatus}`,
                      )
                      .join(" → ")}
                  </p>

                  {open && (
                    <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
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
      </section>

      <section className="space-y-5">
        <InvestorSectionTitle
          title="Viewings"
          description="Viewing requests from buyers. Times are shown in UTC."
        />
        {viewings.length === 0 ? (
          <InvestorEmpty title="No viewing requests">
            When a buyer asks to view one of your listings, the request lands here for you
            to confirm or decline.
          </InvestorEmpty>
        ) : (
          <ul
            className="divide-y divide-line rounded-3xl border border-line bg-white px-6 text-sm shadow-sm sm:px-7"
            data-testid="agent-viewings"
          >
            {viewings.map((viewing) => (
              <li
                key={viewing.id}
                className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <IconChip>
                    <ClockIcon />
                  </IconChip>
                  <div className="min-w-0">
                    <p className="font-semibold text-primary">{viewing.property.title}</p>
                    <p className="mt-0.5 text-muted">
                      {viewing.buyer.name ?? "Buyer"} ·{" "}
                      <span className="tabular-nums">{time(viewing.slotStart)} UTC</span>
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <StatusPill tone={VIEWING_TONE[viewing.status] ?? "neutral"}>
                    {sentence(viewing.status)}
                  </StatusPill>
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
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
