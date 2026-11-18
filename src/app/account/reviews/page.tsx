import { redirect } from "next/navigation";

import { ActionButton } from "@/components/projects/ActionButton";
import { day } from "@/components/projects/format";
import { replyAction, submitReviewAction } from "@/components/reviews/reviewActions";
import { Stars } from "@/components/reviews/StarRating";
import { auth } from "@/lib/auth";
import { myReviews, reviewOpportunities } from "@/services/reviews/reviews";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reviews — PropLink UK", robots: { index: false } };

const STATUS: Record<string, string> = {
  PENDING: "Waiting for Admin review",
  PUBLISHED: "Published",
  REJECTED: "Not published",
  HIDDEN: "Hidden by Admin",
};
const field = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body";

/**
 * Reviews for every signed-in role (Phase 5 Task 4, ADR-054): what you can
 * review (only completed, qualifying interactions), what you have written,
 * and published reviews about you with a one-time reply.
 */
export default async function AccountReviewsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/account/reviews");
  const actor = {
    profileId: session.user.authUserId,
    legacyUserId: session.user.id,
    role: session.user.role,
  };
  const [open, mine] = await Promise.all([reviewOpportunities(actor), myReviews(actor)]);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-10 px-4 py-10 sm:px-6">
      <header>
        <h1 className="text-2xl font-bold text-primary">Reviews</h1>
        <p className="mt-2 text-sm text-muted">
          You can review someone once you have finished working with them on PropLink: a
          closed mandate, a sold project or a completed purchase. An Admin checks every
          review before it is published.
        </p>
      </header>

      <section aria-labelledby="to-review" className="space-y-4">
        <h2 id="to-review" className="text-lg font-semibold text-primary">
          Waiting for your review
        </h2>
        {open.length === 0 ? (
          <p className="text-sm text-muted">Nothing to review right now.</p>
        ) : (
          <ul className="space-y-4" data-testid="review-opportunities">
            {open.map((item) => (
              <li
                key={`${item.contextType}:${item.contextId}:${item.subjectId}`}
                className="rounded-lg border border-line bg-white p-4"
              >
                <p className="text-sm font-semibold text-primary">
                  {item.subjectName}{" "}
                  <span className="font-normal text-muted">
                    ({item.subjectRole}) · {item.label}
                  </span>
                </p>
                <div className="mt-3">
                  <ActionButton
                    action={submitReviewAction}
                    hidden={{
                      contextType: item.contextType,
                      contextId: item.contextId,
                      subjectId: item.subjectId,
                    }}
                    label="Send review"
                  >
                    <fieldset>
                      <legend className="text-sm text-body">Rating</legend>
                      <div className="mt-1 flex flex-wrap gap-3">
                        {[5, 4, 3, 2, 1].map((n) => (
                          <label key={n} className="flex items-center gap-1 text-sm">
                            <input type="radio" name="rating" value={n} required />
                            {n} star{n === 1 ? "" : "s"}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <label className="block text-sm text-body">
                      Your review
                      <textarea
                        name="body"
                        required
                        minLength={10}
                        maxLength={2000}
                        rows={4}
                        className={`mt-1 ${field}`}
                      />
                    </label>
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="about-you" className="space-y-4">
        <h2 id="about-you" className="text-lg font-semibold text-primary">
          Reviews about you
        </h2>
        {mine.received.length === 0 ? (
          <p className="text-sm text-muted">No published reviews about you yet.</p>
        ) : (
          <ul className="space-y-4" data-testid="reviews-received">
            {mine.received.map((review) => (
              <li
                key={review.id}
                className="rounded-lg border border-line bg-white p-4 text-sm"
              >
                <p className="flex items-center gap-2">
                  <Stars rating={review.rating} />
                  <span className="text-muted">{day(review.createdAt)}</span>
                </p>
                <p className="mt-2 whitespace-pre-line text-body">{review.body}</p>
                {review.reply ? (
                  <p className="mt-2 border-l-2 border-line pl-3 text-body">
                    <span className="block text-xs font-semibold text-muted">
                      Your reply
                    </span>
                    {review.reply}
                  </p>
                ) : (
                  <div className="mt-3">
                    <ActionButton
                      action={replyAction}
                      hidden={{ reviewId: review.id }}
                      label="Post reply"
                      tone="secondary"
                    >
                      <textarea
                        name="reply"
                        required
                        maxLength={1000}
                        rows={2}
                        className={field}
                        aria-label="Your reply (posted once, shown under the review)"
                      />
                    </ActionButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="written" className="space-y-4">
        <h2 id="written" className="text-lg font-semibold text-primary">
          Reviews you wrote
        </h2>
        {mine.written.length === 0 ? (
          <p className="text-sm text-muted">You have not written any reviews.</p>
        ) : (
          <ul className="space-y-3" data-testid="reviews-written">
            {mine.written.map((review) => (
              <li
                key={review.id}
                className="rounded-lg border border-line bg-white p-4 text-sm"
              >
                <p className="flex flex-wrap items-center gap-2">
                  <Stars rating={review.rating} />
                  <span className="text-muted">
                    {review.subject.name ?? "Member"} · {STATUS[review.status]}
                    {review.status === "REJECTED" && review.moderationNote
                      ? `: ${review.moderationNote}`
                      : ""}
                  </span>
                </p>
                <p className="mt-2 whitespace-pre-line text-body">{review.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
