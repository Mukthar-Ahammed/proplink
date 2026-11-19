import { requirePageRole } from "@/lib/authz";
import { DeleteAccount } from "@/app/account/profile/DeleteAccount";
import { ProfileEditor } from "@/app/account/profile/ProfileEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your investor profile — PropLink UK" };

/**
 * The investor's profile, inside the investor portal (banner masthead and
 * tabs) rather than the bare `/account/profile` page (ADR-071). Same editor and
 * save action as every other role.
 */
export default async function InvestorProfilePage() {
  const session = await requirePageRole("INVESTOR");
  return (
    <div>
      <h2 className="sr-only">Your investor profile</h2>
      <ProfileEditor user={session.user} />
      <div className="mt-12">
        <DeleteAccount />
      </div>
    </div>
  );
}
