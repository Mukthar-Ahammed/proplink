import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getAgentProfilePublic } from "@/services/agents/agentProfileService";
import {
  agentRatingsByAgentProfile,
  publishedReviewsAbout,
} from "@/services/reviews/reviews";
import { formatPenceGBP } from "@/components/listings/wizardTypes";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { ReviewList } from "@/components/reviews/ReviewList";
import { VerifiedBadge } from "@/components/profiles/VerifiedBadge";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const profile = await getAgentProfilePublic(id);
  return { title: profile ? `${profile.agencyName} — PropLink UK` : "Agent not found" };
}

/**
 * Public agent profile & credibility hub (Task 2.4 brief): agency info, star
 * rating and reviews (published reviews from completed, qualifying work
 * only — Phase 5 Task 4, ADR-054), Verified Completed Deals (count of SOLD
 * listings), compliance code, case studies (capex/net margin/narrative) and
 * Sprint-era appraisals kept as read-only history. Reviews are written from
 * `/account/reviews`. No auth required to view the page itself.
 */
export default async function AgentProfilePage({ params }: PageProps) {
  const { id } = await params;
  const profile = await getAgentProfilePublic(id);
  if (!profile) notFound();

  const session = await auth();
  const owner = (await agentRatingsByAgentProfile([id])).get(id);
  const ownerProfileId = owner?.profileId ?? null;
  const reviews = ownerProfileId ? await publishedReviewsAbout(ownerProfileId) : [];

  return (
    // `<main>` for the same reason as `/marketplace/[id]`: the other publicly
    // indexed page in Sprint 2, so it needs the landmark too. The
    // authenticated `/agent/**` and `/admin/**` pages still use plain `<div>`
    // wrappers — same defect, but noindex and behind auth; queued for the
    // Sprint 6 hardening pass rather than fixed piecemeal here.
    <main className="mx-auto w-full max-w-4xl space-y-8 px-6 py-10">
      <div className="flex items-start gap-4">
        <div
          aria-hidden
          className="flex h-16 w-16 flex-none items-center justify-center rounded-full bg-accent/10 text-2xl font-bold text-accent"
        >
          {profile.agencyName.charAt(0).toUpperCase()}
        </div>
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold text-primary">
            {profile.agencyName}
            {profile.verified && <VerifiedBadge />}
          </h1>
          {profile.bio && <p className="mt-1 text-sm text-body">{profile.bio}</p>}
          <p className="mt-1 text-xs font-medium text-muted">
            Compliance code: {profile.complianceCode}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardTitle>Rating</CardTitle>
          <CardBody>
            {profile.ratingCount > 0 ? (
              <p
                className="text-lg font-semibold text-primary"
                data-testid="agent-rating"
              >
                ★ {profile.ratingAverage?.toFixed(1)}{" "}
                <span className="text-sm font-normal text-muted">
                  ({profile.ratingCount} review{profile.ratingCount === 1 ? "" : "s"})
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted">No reviews yet</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardTitle>Verified completed deals</CardTitle>
          <CardBody>
            <p
              className="text-lg font-semibold text-primary"
              data-testid="verified-deal-count"
            >
              {profile.verifiedDealCount}
            </p>
          </CardBody>
        </Card>
      </div>

      <section>
        <h2 className="text-lg font-bold text-primary">Case studies</h2>
        {profile.caseStudies.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No case studies published yet.</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {profile.caseStudies.map((c) => (
              <Card key={c.id} data-testid="case-study-card">
                <CardTitle>{c.title}</CardTitle>
                <CardBody>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-muted">Capex</dt>
                      <dd
                        className="font-semibold text-body"
                        data-testid="case-study-capex"
                      >
                        {formatPenceGBP(c.capexGBP)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Net margin</dt>
                      <dd
                        className="font-semibold text-body"
                        data-testid="case-study-net-margin"
                      >
                        {formatPenceGBP(c.netMarginGBP)}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-body">{c.description}</p>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="reviews">
        <h2 id="reviews" className="text-lg font-bold text-primary">
          Reviews
        </h2>
        <p className="mt-1 text-sm text-muted" data-testid="review-rule">
          Reviews come only from Landlords, Investors and Buyers who have completed work
          with this agency on PropLink, and an Admin checks each one before it appears.
          {session?.user && (
            <>
              {" "}
              <Link href="/account/reviews" className="text-accent underline">
                Your reviews
              </Link>
            </>
          )}
        </p>
        <div className="mt-4">
          <ReviewList
            reviews={reviews}
            canReport={
              Boolean(session?.user) && session?.user.authUserId !== ownerProfileId
            }
          />
        </div>
      </section>

      {profile.appraisals.length > 0 && (
        <section aria-labelledby="appraisals">
          <h2 id="appraisals" className="text-lg font-bold text-primary">
            Earlier appraisals
          </h2>
          <p className="mt-1 text-sm text-muted">
            Written before verified reviews; not counted in the rating.
          </p>
          <ul className="mt-4 space-y-3">
            {profile.appraisals.map((a) => (
              <li key={a.id} className="rounded-lg border border-line bg-white p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-primary">
                    ★ {a.rating}/5 — {a.reviewerName}
                  </span>
                  <span className="text-xs text-muted">
                    {a.createdAt.toISOString().slice(0, 10)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-body">{a.review}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
