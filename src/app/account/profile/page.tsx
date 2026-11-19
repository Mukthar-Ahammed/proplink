import Link from "next/link";
import { redirect } from "next/navigation";

import { Role } from "@/generated/prisma/enums";
import { auth } from "@/lib/auth";
import { ensureUserProfile } from "@/services/profiles/userProfiles";

import { DeleteAccount } from "./DeleteAccount";
import { ProfileForm } from "./ProfileForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your profile — PropLink UK" };

/** Edit your LinkedIn-style profile (Phase 1 Task 8, ADR-032). */
export default async function EditProfilePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { user } = session;
  if (user.role === Role.ADMIN) redirect("/admin");
  const profile = await ensureUserProfile(user.authUserId, user.role);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold text-primary">Your profile</h1>
        <Link
          href={`/u/${profile.publicId}`}
          className="text-sm font-semibold text-accent underline"
        >
          View as others see it
        </Link>
      </div>
      <p className="mt-2 text-sm text-muted">
        PropLink calculates your track record; it cannot be edited. Your email and phone
        are never shown.
      </p>
      <div className="mt-8">
        <ProfileForm
          isInvestor={user.role === Role.INVESTOR}
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
      <div className="mt-12">
        <DeleteAccount />
      </div>
    </main>
  );
}
