import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ActionButton } from "@/components/projects/ActionButton";
import { day } from "@/components/projects/format";
import { moderateAction, resolveReportAction } from "@/components/reviews/reviewActions";
import { Stars } from "@/components/reviews/StarRating";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { Role } from "@/generated/prisma/enums";
import { requirePageRole } from "@/lib/authz";
import { moderationQueue } from "@/services/reviews/reviews";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — Reviews | PropLink", robots: { index: false } };

const CONTEXT: Record<string, string> = {
  MANDATE: "Landlord → Agent, closed mandate",
  PROJECT: "Investor review, sold project",
  PURCHASE: "Buyer → Agent, completed purchase",
};
const note = "w-full rounded-lg border border-line bg-white px-2 py-1 text-sm text-body";

type QueueReview = Awaited<ReturnType<typeof moderationQueue>>["pending"][number];

function ReviewSummary({ review }: { review: QueueReview }) {
  return (
    <>
      <p className="flex flex-wrap items-center gap-2">
        <Stars rating={review.rating} />
        <span className="text-muted">
          {review.reviewer.name ?? "Reviewer"} → {review.subject.name ?? "Subject"} ·{" "}
          {CONTEXT[review.contextType]} · {day(review.createdAt)}
        </span>
      </p>
      <p className="mt-2 whitespace-pre-line text-body">{review.body}</p>
    </>
  );
}

/**
 * Review moderation (Phase 5 Task 4, ADR-054; OD-17 default: Admin publishes
 * before anyone sees a review). Reports on published reviews come here too.
 */
export default async function AdminReviewsPage() {
  const session = await requirePageRole(Role.ADMIN);
  const { pending, reports } = await moderationQueue({
    profileId: session.user.authUserId,
    legacyUserId: session.user.id,
    role: session.user.role,
  });
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Reviews"
        description="Reviews come only from a completed, qualifying interaction and stay hidden until you publish them. Rejecting or hiding needs a reason; every decision is logged."
      />
      <Card>
        <CardTitle>Waiting for a decision ({pending.length})</CardTitle>
        <CardBody>
          {pending.length === 0 ? (
            <p className="text-sm text-muted">Nothing to moderate.</p>
          ) : (
            <ul className="space-y-4" data-testid="review-queue">
              {pending.map((review) => (
                <li key={review.id} className="rounded-lg border border-line p-4 text-sm">
                  <ReviewSummary review={review} />
                  <div className="mt-3 flex flex-wrap items-start gap-3">
                    <ActionButton
                      action={moderateAction}
                      hidden={{ reviewId: review.id, decision: "publish" }}
                      label="Publish"
                    />
                    <ActionButton
                      action={moderateAction}
                      hidden={{ reviewId: review.id, decision: "reject" }}
                      label="Reject"
                      tone="danger"
                    >
                      <input
                        name="note"
                        required
                        className={note}
                        aria-label="Reason for rejecting"
                        placeholder="Reason"
                      />
                    </ActionButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardTitle>Reported reviews ({reports.length})</CardTitle>
        <CardBody>
          {reports.length === 0 ? (
            <p className="text-sm text-muted">No open reports.</p>
          ) : (
            <ul className="space-y-4" data-testid="review-reports">
              {reports.map((report) => (
                <li key={report.id} className="rounded-lg border border-line p-4 text-sm">
                  <p className="text-muted">
                    Reported by {report.reporter.name ?? "a member"} on{" "}
                    {day(report.createdAt)}:{" "}
                    <span className="text-body">{report.reason}</span>
                  </p>
                  <div className="mt-2">
                    <ReviewSummary review={report.review} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-start gap-3">
                    <ActionButton
                      action={resolveReportAction}
                      hidden={{ reportId: report.id, hide: "true" }}
                      label="Hide the review"
                      tone="danger"
                    >
                      <input
                        name="note"
                        className={note}
                        aria-label="Reason for hiding"
                        placeholder="Reason (defaults to the report)"
                      />
                    </ActionButton>
                    <ActionButton
                      action={resolveReportAction}
                      hidden={{ reportId: report.id, hide: "false" }}
                      label="Keep it published"
                      tone="secondary"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
