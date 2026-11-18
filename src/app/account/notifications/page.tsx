import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getPreferences } from "@/services/notifications/preferences";

import { PreferencesForm } from "./PreferencesForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notification preferences — PropLink UK" };

/**
 * The roadmap phase now live; later events show as "coming soon". Phase 3
 * delivers chat and billing notices (ADR-042, ADR-043).
 */
const CURRENT_PHASE = 3;

/**
 * Notification preferences for every signed-in role (Phase 1 Task 10,
 * ADR-029). The list is the events offered to this role along the Q12 chain.
 */
export default async function NotificationPreferencesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const rows = await getPreferences(session.user.authUserId, session.user.role);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-primary">Notifications</h1>
      <p className="mt-2 text-sm text-muted">
        Choose how PropLink tells you about activity. Changes apply to new notifications.
      </p>
      <div className="mt-8">
        <PreferencesForm rows={rows} currentPhase={CURRENT_PHASE} />
      </div>
    </main>
  );
}
