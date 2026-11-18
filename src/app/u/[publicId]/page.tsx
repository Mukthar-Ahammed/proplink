import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { VerifiedBadge } from "@/components/profiles/VerifiedBadge";
import { viewProfile } from "@/services/profiles/userProfiles";
import { createProfilePhotoUrl } from "@/services/uploads/pipeline";

export const dynamic = "force-dynamic";
export const metadata = { title: "Profile — PropLink UK", robots: { index: false } };

const ROLE_LABEL: Record<string, string> = {
  AGENT: "Agent",
  INVESTOR: "Investor",
  LANDLORD: "Landlord",
  BUYER: "Buyer",
  SOLICITOR: "Solicitor",
  ADVERTISER: "Advertiser",
};

const SECTION_HEADING = "text-sm font-semibold tracking-wide text-muted uppercase";

/**
 * Profile view (Phase 1 Task 8, ADR-032). `viewProfile` decides what this
 * viewer may see; a private investor profile is "not found" to others.
 */
export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  const session = await auth();
  const viewer = session?.user
    ? { profileId: session.user.authUserId, role: session.user.role }
    : null;
  const view = await viewProfile(viewer, publicId);
  if (!view) notFound();

  const named = view.kind !== "anonymous";
  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 px-4 py-10 sm:px-6">
      <header className="flex items-start gap-4">
        {named && view.photoFileId ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed, sandboxed image route
          <img
            src={createProfilePhotoUrl(view.photoFileId)}
            alt=""
            className="h-20 w-20 flex-none rounded-full border border-line object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="flex h-20 w-20 flex-none items-center justify-center rounded-full bg-accent/10 text-2xl font-bold text-accent"
          >
            {named ? view.name.charAt(0).toUpperCase() : "?"}
          </div>
        )}
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold text-primary">
            {named ? view.name : view.publicId}
            {view.verified && <VerifiedBadge />}
          </h1>
          <p className="text-sm text-muted">
            {ROLE_LABEL[view.role] ?? "Member"}
            {named && view.headline ? ` · ${view.headline}` : ""}
            {named && view.location ? ` · ${view.location}` : ""}
          </p>
          {view.kind === "full" && view.role === "INVESTOR" && (
            <p className="mt-1 text-xs text-muted">
              Visibility:{" "}
              {view.visibility === "PRIVATE" ? "private" : "public (anonymous)"}
            </p>
          )}
        </div>
      </header>

      <section aria-labelledby="track-record">
        <h2 id="track-record" className={SECTION_HEADING}>
          Track record
        </h2>
        <dl className="mt-3 grid gap-4 sm:grid-cols-3">
          {view.trackRecord.map((item) => (
            <div key={item.label} className="rounded-lg border border-line bg-white p-4">
              <dt className="text-xs text-muted">{item.label}</dt>
              <dd className="text-xl font-semibold text-primary">{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {named && view.specialisms.length > 0 && (
        <section aria-labelledby="specialisms">
          <h2 id="specialisms" className={SECTION_HEADING}>
            Specialisms
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {view.specialisms.map((item) => (
              <li
                key={item}
                className="rounded-full border border-line px-3 py-1 text-xs text-body"
              >
                {item}
              </li>
            ))}
          </ul>
        </section>
      )}
      {named && view.bio && (
        <section aria-labelledby="about">
          <h2 id="about" className={SECTION_HEADING}>
            About
          </h2>
          <p className="mt-2 text-sm whitespace-pre-line text-body">{view.bio}</p>
        </section>
      )}
      {named && view.experience && (
        <section aria-labelledby="experience">
          <h2 id="experience" className={SECTION_HEADING}>
            Experience
          </h2>
          <p className="mt-2 text-sm whitespace-pre-line text-body">{view.experience}</p>
        </section>
      )}

      <section aria-labelledby="reviews">
        <h2 id="reviews" className={SECTION_HEADING}>
          Reviews
        </h2>
        <p className="mt-2 text-sm text-muted">
          Reviews open after completed deals (coming soon).
        </p>
      </section>
    </main>
  );
}
