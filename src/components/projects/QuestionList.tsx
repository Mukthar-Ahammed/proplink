import { day } from "@/components/projects/format";
import type { QuestionView } from "@/services/projects/community";

/**
 * Project Q&A (Phase 4 Task 3). `renderActions` adds the Agent's answer form
 * or Admin's hide form under a question.
 */
export function QuestionList({
  questions,
  renderActions,
}: {
  questions: QuestionView[];
  renderActions?: (question: QuestionView) => React.ReactNode;
}) {
  if (questions.length === 0) {
    return <p className="text-sm text-muted">No questions yet.</p>;
  }
  return (
    <ul className="space-y-3" data-testid="project-questions">
      {questions.map((question) => (
        <li key={question.id} className="rounded-lg border border-line bg-white p-4">
          <p className="text-xs text-muted">
            {question.askedBy} · {day(question.createdAt)}
            {question.status === "OPEN" && " · waiting for the agent"}
            {question.status === "HIDDEN" &&
              ` · hidden by PropLink${question.hiddenReason ? `: ${question.hiddenReason}` : ""}`}
          </p>
          <p className="mt-1 text-sm whitespace-pre-line text-body">{question.body}</p>
          {question.answer && (
            <p className="mt-2 border-l-2 border-primary pl-3 text-sm whitespace-pre-line text-body">
              <span className="font-semibold text-primary">Agent: </span>
              {question.answer}
            </p>
          )}
          {renderActions && <div className="mt-3">{renderActions(question)}</div>}
        </li>
      ))}
    </ul>
  );
}
