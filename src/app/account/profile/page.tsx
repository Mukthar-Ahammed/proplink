import { redirect } from "next/navigation";

import { Role } from "@/generated/prisma/enums";
import { auth } from "@/lib/auth";

import { DeleteAccount } from "./DeleteAccount";
import { ProfileEditor } from "./ProfileEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your profile — PropLink UK" };

/**
 * Edit your LinkedIn-style profile (Phase 1 Task 8, ADR-032). Investors edit
 * theirs inside the investor portal at `/investor/profile`.
 */
export default async function EditProfilePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { user } = session;
  if (user.role === Role.ADMIN) redirect("/admin");
  if (user.role === Role.INVESTOR) redirect("/investor/profile");

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="font-display text-[clamp(1.75rem,3vw,2.25rem)] font-semibold tracking-[-0.03em] text-primary">
        Your
        <span className="font-serif font-normal tracking-normal italic"> profile</span>
      </h1>
      <p className="mt-2 mb-8 text-sm text-muted">
        How other PropLink members see you. Your email and phone are never shown.
      </p>
      <ProfileEditor user={user} />
      <div className="mt-12">
        <DeleteAccount />
      </div>
    </main>
  );
}
