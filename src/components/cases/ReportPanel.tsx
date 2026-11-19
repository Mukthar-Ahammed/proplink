import { reportSubjectAction } from "@/components/cases/reportActions";
import { ActionButton } from "@/components/projects/ActionButton";

/**
 * "Report this listing / member" for signed-in members (Phase 6 Task 3,
 * ADR-059). A closed disclosure, so it never interrupts the page.
 */
export function ReportPanel({
  subjectType,
  subjectId,
  label,
}: {
  subjectType: "LISTING" | "USER";
  subjectId: string;
  label: string;
}) {
  return (
    <details className="text-sm" data-testid="report-panel">
      <summary className="cursor-pointer text-xs text-muted">{label}</summary>
      <div className="mt-2 max-w-md">
        <ActionButton
          action={reportSubjectAction}
          hidden={{ subjectType, subjectId }}
          label="Send report"
          tone="secondary"
        >
          <textarea
            name="reason"
            required
            minLength={10}
            maxLength={1000}
            rows={3}
            aria-label="What is wrong?"
            className="w-full rounded-lg border border-line bg-white px-2 py-1 text-sm text-body"
          />
        </ActionButton>
      </div>
    </details>
  );
}
