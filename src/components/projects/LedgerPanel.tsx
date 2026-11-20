import { ActionButton } from "@/components/projects/ActionButton";
import { day } from "@/components/projects/format";
import {
  confirmSaleAction,
  decideCorrectionAction,
  proposeCorrectionAction,
  recordSaleAction,
  settleAction,
} from "@/components/projects/settlementActions";
import { formatPence } from "@/services/projects/common";
import type { LedgerView } from "@/services/projects/settlement";
import type { settlementPlan } from "@/services/projects/settlement";

type Plan = Awaited<ReturnType<typeof settlementPlan>>;

const input = "rounded-lg border border-line bg-white px-2 py-1 text-sm text-body";
const signed = (pence: bigint) =>
  pence < BigInt(0) ? `-${formatPence(-pence)}` : formatPence(pence);

/**
 * Sale, settlement and ledger (Phase 4 Task 8). Agents record the sale;
 * the Solicitor confirms, settles and proposes corrections; Admin decides
 * corrections; parties see their own entries and download their statement.
 */
export function LedgerPanel({
  view,
  plan,
  projectId,
  projectStatus,
  path,
  parties = [],
}: {
  view: LedgerView;
  plan: Plan;
  projectId: string;
  projectStatus: string;
  path: string;
  /** Solicitor/Admin: parties to download statements for. */
  parties?: { id: string; name: string }[];
}) {
  const { relation, sale } = view;
  const solicitor = relation === "SOLICITOR";
  const admin = relation === "ADMIN";
  const settled = view.entries.some((entry) => entry.entryType !== "ADJUSTMENT");
  const party = relation === "INVESTOR" || relation === "LEAD" || relation === "LANDLORD";
  return (
    <div data-testid="ledger-panel" className="space-y-4">
      {relation === "AGENT" && projectStatus === "LISTED_FOR_SALE" && !sale && (
        <ActionButton
          action={recordSaleAction}
          hidden={{ projectId, path }}
          label="Record the sale"
        >
          <div className="flex flex-wrap gap-2">
            <input
              name="salePrice"
              required
              placeholder="Sale price (£)"
              className={input}
            />
            <input
              name="soldOn"
              type="date"
              required
              className={input}
              aria-label="Sale date"
            />
          </div>
        </ActionButton>
      )}
      {sale ? (
        <div className="text-sm text-body" data-testid="sale">
          <p>
            Sold for <strong>{formatPence(sale.salePriceGBP)}</strong> on{" "}
            {day(sale.soldOn)} · purchase {formatPence(sale.purchaseGBP)} · costs{" "}
            {formatPence(sale.totalCostsGBP)} · net{" "}
            {sale.netProfitGBP < BigInt(0) ? "loss" : "profit"}{" "}
            <strong>{signed(sale.netProfitGBP)}</strong> · return on capital{" "}
            {(Number(sale.roiBasisPoints) / 100).toFixed(2)}% ·{" "}
            {sale.status === "CONFIRMED"
              ? "confirmed by the Solicitor"
              : "awaiting the Solicitor"}
          </p>
          {solicitor && sale.status === "RECORDED" && (
            <div className="mt-2">
              <ActionButton
                action={confirmSaleAction}
                hidden={{ projectId, path }}
                label="Confirm the sale"
              />
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">No sale recorded yet.</p>
      )}

      {solicitor && plan && !settled && (
        <div className="rounded-lg border border-line bg-white p-4 text-sm">
          <p className="font-semibold text-primary">
            Settlement under agreement v{plan.agreementVersion}
          </p>
          <p className="mt-1 text-body">
            Capital returned:{" "}
            {plan.capital.map((entry) => formatPence(entry.amountGBP)).join(", ")}
          </p>
          {plan.loss ? (
            <ActionButton
              action={settleAction}
              hidden={{ projectId, path }}
              label="Record settlement"
            >
              <p className="text-body">
                The sale made a loss of {formatPence(-plan.sale.netProfitGBP)}. PropLink
                does not allocate losses: enter each party&apos;s share as the signed
                agreement states.
              </p>
              <p className="whitespace-pre-line text-muted">
                Agreement: {plan.lossAllocation}
              </p>
              {plan.lossParties.map((lossParty) => (
                <label key={lossParty.partyId} className="block text-body">
                  {lossParty.partyRole.toLowerCase()} (
                  {(Number(lossParty.sharePpm) / 10_000).toFixed(4)}%) £
                  <input
                    name={`loss:${lossParty.partyId}`}
                    required
                    className={`${input} ml-2`}
                  />
                </label>
              ))}
            </ActionButton>
          ) : (
            <ActionButton
              action={settleAction}
              hidden={{ projectId, path }}
              label="Record settlement"
            >
              <p className="text-body">
                Profit shares (by the agreement):{" "}
                {plan.profit.map((entry) => formatPence(entry.amountGBP)).join(", ")}
              </p>
            </ActionButton>
          )}
        </div>
      )}

      {view.entries.length > 0 && (
        <table className="w-full text-left text-sm" data-testid="ledger">
          <thead className="text-xs text-muted uppercase">
            <tr>
              <th className="py-1">Date</th>
              {!party && <th>Party</th>}
              <th>Entry</th>
              <th>Share</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {view.entries.map((entry) => (
              <tr key={entry.id} className="border-t border-line align-top">
                <td className="py-1">{day(entry.createdAt)}</td>
                {!party && (
                  <td>
                    {entry.party} ({entry.partyRole.toLowerCase()})
                  </td>
                )}
                <td>
                  {entry.label}
                  {solicitor && entry.entryType !== "ADJUSTMENT" && (
                    <div className="mt-1">
                      <ActionButton
                        action={proposeCorrectionAction}
                        hidden={{ entryId: entry.id, path }}
                        label="Propose correction"
                        tone="secondary"
                      >
                        <div className="flex flex-wrap gap-2">
                          <input
                            name="amount"
                            required
                            placeholder="± £"
                            className={input}
                          />
                          <input
                            name="reason"
                            required
                            placeholder="Reason"
                            className={input}
                          />
                        </div>
                      </ActionButton>
                    </div>
                  )}
                </td>
                <td>{entry.share}</td>
                <td>{signed(entry.amountGBP)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {view.entries.length > 0 && (
        <p className="text-sm font-semibold text-primary">Total {signed(view.total)}</p>
      )}

      {view.corrections.length > 0 && (
        <ul className="space-y-2 text-sm" data-testid="corrections">
          {view.corrections.map((correction) => (
            <li
              key={correction.id}
              className="rounded-lg border border-line bg-white p-3"
            >
              <p className="text-body">
                Correction {signed(correction.amountGBP)} ·{" "}
                {correction.status.toLowerCase()} · {day(correction.proposedAt)}
              </p>
              <p className="text-muted">{correction.reason}</p>
              {admin && correction.status === "PROPOSED" && (
                <div className="mt-2 flex flex-wrap gap-3">
                  <ActionButton
                    action={decideCorrectionAction}
                    hidden={{ correctionId: correction.id, decision: "approve", path }}
                    label="Approve"
                  />
                  <ActionButton
                    action={decideCorrectionAction}
                    hidden={{ correctionId: correction.id, decision: "reject", path }}
                    label="Reject"
                    tone="danger"
                  >
                    <input name="note" placeholder="Reason" className={input} />
                  </ActionButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-4 text-sm">
        {party && view.hasOwnStatement && (
          <a
            href={`/api/projects/${projectId}/statement`}
            className="font-semibold text-primary underline"
          >
            Download your statement (PDF)
          </a>
        )}
        {(solicitor || admin) &&
          parties.map((entry) => (
            <a
              key={entry.id}
              href={`/api/projects/${projectId}/statement?party=${entry.id}`}
              className="text-primary underline"
            >
              Statement: {entry.name}
            </a>
          ))}
      </div>
    </div>
  );
}
