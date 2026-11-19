import { ActionButton } from "@/components/projects/ActionButton";
import { day } from "@/components/projects/format";
import {
  advanceAction,
  changeAction,
  costAction,
  decideChangeAction,
  fundStatusAction,
  milestoneAction,
  updateAction,
  voidCostAction,
} from "@/components/projects/worksActions";
import { formatPence } from "@/services/projects/common";
import type { WorksView } from "@/services/projects/works";

const CATEGORY: Record<string, string> = {
  MATERIALS: "Materials",
  CONTRACTOR: "Contractor fees",
  AGENT_FEES: "Agent fees",
  LEGAL_FEES: "Legal fees",
  TAXES: "Taxes",
  OTHER: "Other",
};
const FUNDS: Record<string, string> = {
  AWAITING: "Awaiting funds",
  RECEIVED: "Received",
  PART_RECEIVED: "Part received",
  RETURNED: "Returned",
};
const NEXT: Record<string, { to: string; label: string }> = {
  FUNDED: { to: "IN_WORKS", label: "Start works (agreement signed)" },
  IN_WORKS: { to: "COMPLETED", label: "Mark works complete" },
};
const input = "rounded-lg border border-line bg-white px-2 py-1 text-sm text-body";

function H({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 mb-2 text-sm font-semibold text-primary">{children}</h3>;
}

/**
 * Works, costs, funds and updates (Phase 4 Task 7) for any related viewer;
 * the forms shown depend on the viewer's relation to the project.
 */
export function WorksPanel({
  view,
  projectId,
  projectStatus,
  path,
  pledges = [],
}: {
  view: WorksView;
  projectId: string;
  projectStatus: string;
  path: string;
  /** Solicitor only: pledges to record funds against. */
  pledges?: { id: string; label: string }[];
}) {
  const { relation } = view;
  const agent = relation === "AGENT";
  const solicitor = relation === "SOLICITOR";
  const lead = relation === "LEAD";
  const costEditor = agent || solicitor;
  // OD-30 (Q18): the Lead Investor decides when works start and finish and
  // can manage milestones; the Agent manages milestones day to day.
  const worksManager = agent || lead;
  const next = NEXT[projectStatus];
  return (
    <div data-testid="works-panel">
      {lead && next && (
        <ActionButton
          action={advanceAction}
          hidden={{ projectId, to: next.to, path }}
          label={next.label}
        />
      )}
      {agent && next && (
        <p className="text-sm text-muted" data-testid="lead-decides-stage">
          The Lead Investor decides when works start and when they are complete.
        </p>
      )}

      {view.myFunds && (
        <p className="mt-2 text-sm text-body" data-testid="my-funds">
          Funds for your pledge (recorded by the Solicitor): {FUNDS[view.myFunds.status]}
          {view.myFunds.receivedGBP !== null &&
            ` · ${formatPence(view.myFunds.receivedGBP)}`}{" "}
          · {day(view.myFunds.recordedAt)}
        </p>
      )}

      {solicitor && (
        <>
          <H>Funds received (status only; money moves through your client account)</H>
          <ul className="space-y-2 text-sm">
            {pledges.map((pledge) => {
              const latest = view.funds?.get(pledge.id);
              return (
                <li
                  key={pledge.id}
                  className="rounded-lg border border-line bg-white p-3"
                >
                  <p className="text-body">
                    {pledge.label} · {latest ? FUNDS[latest.status] : "Not recorded"}
                  </p>
                  <ActionButton
                    action={fundStatusAction}
                    hidden={{ pledgeId: pledge.id, path }}
                    label="Record"
                    tone="secondary"
                  >
                    <div className="flex flex-wrap gap-2">
                      <select name="status" className={input} aria-label="Status">
                        {Object.entries(FUNDS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <input
                        name="received"
                        placeholder="Received (£)"
                        className={input}
                      />
                      <input name="note" placeholder="Note" className={input} />
                    </div>
                  </ActionButton>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <H>Milestones</H>
      {view.milestones.length === 0 ? (
        <p className="text-sm text-muted">No milestones yet.</p>
      ) : (
        <ul className="space-y-1 text-sm" data-testid="milestones">
          {view.milestones.map((milestone) => (
            <li key={milestone.id} className="flex flex-wrap items-center gap-3">
              <span className="text-body">
                {milestone.status === "COMPLETE" ? "✓" : "○"} {milestone.title}
                {milestone.dueOn && ` · due ${day(milestone.dueOn)}`}
                {milestone.completedAt && ` · done ${day(milestone.completedAt)}`}
              </span>
              {worksManager && milestone.status !== "COMPLETE" && (
                <ActionButton
                  action={milestoneAction}
                  hidden={{
                    milestoneId: milestone.id,
                    status: milestone.status === "PLANNED" ? "IN_PROGRESS" : "COMPLETE",
                    path,
                  }}
                  label={milestone.status === "PLANNED" ? "Start" : "Complete"}
                  tone="secondary"
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {worksManager && (
        <div className="mt-2">
          <ActionButton
            action={milestoneAction}
            hidden={{ projectId, path }}
            label="Add milestone"
            tone="secondary"
          >
            <div className="flex flex-wrap gap-2">
              <input name="title" required placeholder="Milestone" className={input} />
              <input name="dueOn" type="date" className={input} aria-label="Due date" />
            </div>
          </ActionButton>
        </div>
      )}

      <H>Costs (itemised)</H>
      {view.costs.costs.length === 0 ? (
        <p className="text-sm text-muted">No costs recorded yet.</p>
      ) : (
        <table className="w-full text-left text-sm" data-testid="costs">
          <thead className="text-xs text-muted uppercase">
            <tr>
              <th className="py-1">Date</th>
              <th>Category</th>
              <th>Description</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {view.costs.costs.map((cost) => (
              <tr key={cost.id} className="border-t border-line">
                <td className="py-1">{day(cost.incurredOn)}</td>
                <td>{CATEGORY[cost.category]}</td>
                <td>
                  {cost.voidedAt ? <s>{cost.description}</s> : cost.description}
                  {cost.voidReason && ` (void: ${cost.voidReason})`}
                  {costEditor && !cost.voidedAt && (
                    <div className="mt-1">
                      <ActionButton
                        action={voidCostAction}
                        hidden={{ costId: cost.id, path }}
                        label="Void"
                        tone="danger"
                      >
                        <input
                          name="reason"
                          required
                          placeholder="Reason"
                          className={input}
                        />
                      </ActionButton>
                    </div>
                  )}
                </td>
                <td>{formatPence(cost.amountGBP)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-2 text-sm text-body" data-testid="cost-total">
        Total {formatPence(view.costs.total)}
        {[...view.costs.totals.entries()].map(
          ([category, amount]) => ` · ${CATEGORY[category]} ${formatPence(amount)}`,
        )}
      </p>
      {costEditor && (
        <div className="mt-2">
          <ActionButton
            action={costAction}
            hidden={{ projectId, path }}
            label="Record cost"
            tone="secondary"
          >
            <div className="flex flex-wrap gap-2">
              <select name="category" className={input} aria-label="Category">
                {Object.entries(CATEGORY).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                name="description"
                required
                placeholder="Description"
                className={input}
              />
              <input name="amount" required placeholder="Amount (£)" className={input} />
              <input
                name="incurredOn"
                type="date"
                required
                className={input}
                aria-label="Date"
              />
            </div>
          </ActionButton>
        </div>
      )}

      {relation !== "LANDLORD" && (
        <>
          <H>Budget, timeline and scope changes</H>
          {view.changes.length === 0 ? (
            <p className="text-sm text-muted">No changes recorded.</p>
          ) : (
            <ul className="space-y-2 text-sm" data-testid="changes">
              {view.changes.map((change) => (
                <li
                  key={change.id}
                  className="rounded-lg border border-line bg-white p-3"
                >
                  <p className="font-medium text-primary">
                    {change.kind} · {change.status.toLowerCase()} ·{" "}
                    {day(change.recordedAt)}
                  </p>
                  <p className="whitespace-pre-line text-body">{change.summary}</p>
                  {change.budgetDeltaGBP !== null && (
                    <p className="text-body">
                      Budget change: {change.budgetDeltaGBP < BigInt(0) ? "−" : "+"}
                      {formatPence(
                        change.budgetDeltaGBP < BigInt(0)
                          ? -change.budgetDeltaGBP
                          : change.budgetDeltaGBP,
                      )}
                    </p>
                  )}
                  {change.newCompletionOn && (
                    <p className="text-body">
                      New completion: {day(change.newCompletionOn)}
                    </p>
                  )}
                  {change.decisionNote && (
                    <p className="text-muted">Lead Investor: {change.decisionNote}</p>
                  )}
                  {lead && change.status === "PROPOSED" && (
                    <div className="mt-2 flex flex-wrap gap-3">
                      <ActionButton
                        action={decideChangeAction}
                        hidden={{ changeId: change.id, decision: "approve", path }}
                        label="Approve"
                      >
                        <input
                          name="note"
                          placeholder="Note (optional)"
                          className={input}
                        />
                      </ActionButton>
                      <ActionButton
                        action={decideChangeAction}
                        hidden={{ changeId: change.id, decision: "reject", path }}
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
          {solicitor && (
            <div className="mt-2">
              <ActionButton
                action={changeAction}
                hidden={{ projectId, path }}
                label="Record change for the Lead to decide"
                tone="secondary"
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <select name="kind" className={input} aria-label="Kind">
                    <option value="BUDGET">Budget</option>
                    <option value="TIMELINE">Timeline</option>
                    <option value="SCOPE">Scope</option>
                  </select>
                  <input
                    name="budgetDelta"
                    placeholder="Budget change (£, e.g. -2000)"
                    className={input}
                  />
                  <input
                    name="newCompletionOn"
                    type="date"
                    className={input}
                    aria-label="New completion date"
                  />
                  <textarea
                    name="summary"
                    required
                    rows={2}
                    placeholder="What changes and why"
                    className={input}
                  />
                </div>
              </ActionButton>
            </div>
          )}
        </>
      )}

      <H>Updates</H>
      {(agent || solicitor || relation === "ADMIN") && (
        <div className="mb-3">
          <ActionButton
            action={updateAction}
            hidden={{ projectId, path }}
            label="Post update"
            tone="secondary"
          >
            <div className="grid gap-2">
              <input name="title" required placeholder="Title" className={input} />
              <textarea
                name="body"
                required
                rows={3}
                placeholder="Update"
                className={input}
              />
              <select name="audience" className={input} aria-label="Audience">
                <option value="INVESTORS">Investors</option>
                <option value="INVESTORS_AND_LANDLORD">Investors and the Landlord</option>
              </select>
            </div>
          </ActionButton>
        </div>
      )}
      {view.updates.length === 0 ? (
        <p className="text-sm text-muted">No updates yet.</p>
      ) : (
        <ul className="space-y-2 text-sm" data-testid="updates">
          {view.updates.map((update) => (
            <li key={update.id} className="rounded-lg border border-line bg-white p-3">
              <p className="text-xs text-muted">
                {update.from} · {day(update.createdAt)}
              </p>
              <p className="font-medium text-primary">{update.title}</p>
              <p className="whitespace-pre-line text-body">{update.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
