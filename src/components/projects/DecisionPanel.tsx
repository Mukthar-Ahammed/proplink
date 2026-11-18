import { ActionButton } from "@/components/projects/ActionButton";
import { day } from "@/components/projects/format";
import { decisionAction } from "@/components/projects/worksActions";
import type { listDecisions } from "@/services/projects/decisions";

const KIND: Record<string, string> = {
  EXTEND_DEADLINE: "Deadline extended",
  CLOSE_PROJECT: "Project closed",
  RELEASE_PLEDGES: "Unsigned pledges released",
};
const input = "rounded-lg border border-line bg-white px-2 py-1 text-sm text-body";

/**
 * Project decisions (Phase 4 Task 9, Q44): the project's Agent or Admin
 * extends the deadline, closes the project or releases unsigned pledges.
 * Refunds and cancellation payments are the Solicitor's, outside PropLink.
 */
export function DecisionPanel({
  projectId,
  path,
  shortfall,
  canDecide,
  decisions,
}: {
  projectId: string;
  path: string;
  shortfall: boolean;
  canDecide: boolean;
  decisions: Awaited<ReturnType<typeof listDecisions>>;
}) {
  return (
    <div className="space-y-3" data-testid="decisions">
      {shortfall && (
        <p
          role="status"
          className="rounded-lg border border-warning p-3 text-sm text-warning"
        >
          The funding deadline has passed without full funding. Choose what happens next:
          extend the deadline, release the unsigned pledges, or close the project.
        </p>
      )}
      {decisions.length > 0 && (
        <ul className="space-y-1 text-sm text-body">
          {decisions.map((decision) => (
            <li key={decision.id}>
              {day(decision.decidedAt)} · {KIND[decision.kind]}
              {decision.newDeadline && ` to ${day(decision.newDeadline)}`}
              {decision.pledgesReleased > 0 &&
                ` · ${decision.pledgesReleased} pledges released`}{" "}
              · {decision.reason}
            </li>
          ))}
        </ul>
      )}
      {canDecide && (
        <ActionButton
          action={decisionAction}
          hidden={{ projectId, path }}
          label="Record decision"
          tone="secondary"
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <select name="kind" className={input} aria-label="Decision">
              <option value="EXTEND_DEADLINE">Extend the deadline</option>
              <option value="RELEASE_PLEDGES">Release unsigned pledges</option>
              <option value="CLOSE_PROJECT">Close the project</option>
            </select>
            <input
              name="newDeadline"
              type="date"
              className={input}
              aria-label="New deadline"
            />
            <input name="reason" required placeholder="Reason" className={input} />
          </div>
          <p className="text-xs text-muted">
            Closing releases every pledge; any refund or cancellation payment is handled
            by the Solicitor outside PropLink.
          </p>
        </ActionButton>
      )}
    </div>
  );
}
