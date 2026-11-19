import "server-only";

import { requireAdminPagePermission } from "@/lib/authz";
import { KycQueueClient } from "./KycQueueClient";

export const metadata = { title: "Admin — KYC Queue & Review" };

export default async function KycQueuePage() {
  await requireAdminPagePermission("VERIFICATION");

  return <KycQueueClient />;
}
