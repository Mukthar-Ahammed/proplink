import Link from "next/link";

import { Role } from "@/generated/prisma/enums";
import { VerifiedBadge } from "@/components/profiles/VerifiedBadge";
import { ensureUserProfile, viewProfile } from "@/services/profiles/userProfiles";
import { createProfilePhotoUrl } from "@/services/uploads/pipeline";

import { ProfileForm } from "./ProfileForm";

const VISIBILITY_LABEL: Record<string, { label: string; body: string }> = {
  PRIVATE: {
    label: "Private",
    body: "Hidden from everyone except the Agent on a project you join.",
  },
  PUBLIC_INVESTOR: {
    label: "Public (anonymous)",
    body: "Others see your anonymous ID and track record — never your name.",
  },
  PUBLIC: { label: "Public", body: "Anyone with the link can see it." },
  MEMBERS: { label: "Members only", body: "Only people signed in to PropLink." },
};

/**
 * The profile editor (Phase 1 Task 8, ADR-032; layout ADR-071): the edit form
 * beside a preview card of what the profile shows. Used by `/investor/profile`
 * inside the investor portal and by `/account/profile` for other roles.
 *
 * The preview reflects the **saved** profile (it re-renders after a save);
 * track record figures are computed by the server and cannot be edited.
 */
export async function ProfileEditor({
  user,
}: {
  user: { authUserId: string; role: Role; name?: string | null };
}) {
  const isInvestor = user.role === Role.INVESTOR;
  const profile = await ensureUserProfile(user.authUserId, user.role);
  const self = await viewProfile(
    { profileId: user.authUserId, role: user.role },
    profile.publicId,
  );
  const full =
    self && self.kind !== "members_only" && self.kind !== "anonymous" ? self : null;

  const name = full?.name ?? user.name ?? "You";
  const photoUrl = full?.photoFileId ? createProfilePhotoUrl(full.photoFileId) : null;
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const visibilityKey =
    isInvestor && profile.visibility === "PUBLIC"
      ? "PUBLIC_INVESTOR"
      : profile.visibility;
  const visibility = VISIBILITY_LABEL[visibilityKey] ?? VISIBILITY_LABEL.MEMBERS;
  const trackRecord = self && "trackRecord" in self ? self.trackRecord : [];
  const specialisms = full?.specialisms ?? [];

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0">
        <ProfileForm
          isInvestor={isInvestor}
          avatar={{ photoUrl, initial }}
          initial={{
            headline: profile.headline ?? "",
            bio: profile.bio ?? "",
            location: profile.location ?? "",
            experience: profile.experience ?? "",
            specialisms: profile.specialisms.join(", "),
            visibility: profile.visibility,
          }}
        />
      </div>

      <aside
        aria-label="Profile preview"
        className="space-y-4 lg:sticky lg:top-28 lg:order-none"
      >
        <div className="overflow-hidden rounded-[1.75rem] border border-line bg-white">
          <div aria-hidden className="hero-ground h-20" />
          <div className="-mt-10 px-6 pb-6">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed, sandboxed image route
              <img
                src={photoUrl}
                alt=""
                className="size-20 rounded-full border-4 border-white object-cover"
              />
            ) : (
              <span
                aria-hidden
                className="grid size-20 place-items-center rounded-full border-4 border-white bg-pale text-2xl font-semibold text-accent"
              >
                {initial}
              </span>
            )}
            <p className="mt-3 flex flex-wrap items-center gap-2 text-lg font-semibold text-primary">
              {name}
              {self && "verified" in self && self.verified ? <VerifiedBadge /> : null}
            </p>
            <p className="text-sm text-muted">
              {[isInvestor ? "Investor" : null, full?.headline, full?.location]
                .filter(Boolean)
                .join(" · ") || "Add a headline and location"}
            </p>
            <p className="mt-3 inline-flex items-center rounded-full bg-surface px-3 py-1 font-mono text-xs text-secondary">
              {profile.publicId}
            </p>
            {isInvestor ? (
              <p className="mt-2 text-xs text-muted">
                Only you see your name. Others see this ID.
              </p>
            ) : null}

            {specialisms.length > 0 ? (
              <ul className="mt-4 flex flex-wrap gap-1.5">
                {specialisms.map((item) => (
                  <li
                    key={item}
                    className="rounded-full bg-pale px-3 py-1 text-xs font-semibold text-accent"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="border-t border-line px-6 py-5">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
              Track record
            </p>
            <dl className="mt-3 space-y-2.5">
              {trackRecord.map((item) => (
                <div
                  key={item.label}
                  className="flex items-baseline justify-between gap-4"
                >
                  <dt className="text-sm text-muted">{item.label}</dt>
                  <dd className="shrink-0 text-right text-sm font-semibold text-primary">
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted">
              Calculated by PropLink from platform activity; it cannot be edited.
            </p>
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-line bg-surface p-5">
          <p className="text-sm font-semibold text-primary">
            Visibility: {visibility.label}
          </p>
          <p className="mt-1 text-sm text-muted">{visibility.body}</p>
          <Link
            href={`/u/${profile.publicId}`}
            className="mt-4 inline-flex h-10 items-center rounded-full border border-line bg-white px-4 text-sm font-semibold text-primary transition-colors hover:border-accent"
          >
            View as others see it
          </Link>
        </div>
      </aside>
    </div>
  );
}
