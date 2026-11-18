import { ActionButton } from "@/components/projects/ActionButton";
import { day } from "@/components/projects/format";
import { reportAction } from "@/components/reviews/reviewActions";
import { Stars } from "@/components/reviews/StarRating";

const FROM: Record<string, string> = {
  LANDLORD: "Landlord",
  INVESTOR: "Investor",
  BUYER: "Buyer",
};
const CONTEXT: Record<string, string> = {
  MANDATE: "closed mandate",
  PROJECT: "sold project",
  PURCHASE: "completed purchase",
};

const input = "w-full rounded-lg border border-line bg-white px-2 py-1 text-sm text-body";

export type PublicReview = {
  id: string;
  rating: number;
  body: string;
  contextType: string;
  reply: string | null;
  createdAt: Date;
  reviewer: { role: string };
};

/**
 * Published reviews about one person (Phase 5 Task 4, ADR-054). Reviewers are
 * shown by role only: a review must not reveal a private investor or a
 * Landlord's identity. Signed-in viewers other than the subject may report.
 */
export function ReviewList({
  reviews,
  canReport,
}: {
  reviews: PublicReview[];
  canReport: boolean;
}) {
  if (reviews.length === 0) {
    return (
      <p className="text-sm text-muted">
        No reviews yet. Reviews come only from completed work on PropLink.
      </p>
    );
  }
  return (
    <ul className="space-y-4" data-testid="review-list">
      {reviews.map((review) => (
        <li
          key={review.id}
          className="rounded-lg border border-line bg-white p-4 text-sm"
        >
          <p className="flex flex-wrap items-center gap-2">
            <Stars rating={review.rating} />
            <span className="text-muted">
              {FROM[review.reviewer.role] ?? "Member"} · after a{" "}
              {CONTEXT[review.contextType] ?? "completed interaction"} ·{" "}
              {day(review.createdAt)}
            </span>
          </p>
          <p className="mt-2 whitespace-pre-line text-body">{review.body}</p>
          {review.reply && (
            <div className="mt-3 border-l-2 border-line pl-3">
              <p className="text-xs font-semibold text-muted">Reply</p>
              <p className="whitespace-pre-line text-body">{review.reply}</p>
            </div>
          )}
          {canReport && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted">
                Report this review
              </summary>
              <div className="mt-2">
                <ActionButton
                  action={reportAction}
                  hidden={{ reviewId: review.id }}
                  label="Send report"
                  tone="secondary"
                >
                  <textarea
                    name="reason"
                    required
                    minLength={3}
                    maxLength={500}
                    rows={2}
                    className={input}
                    aria-label="Why should an Admin look at this review?"
                  />
                </ActionButton>
              </div>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
