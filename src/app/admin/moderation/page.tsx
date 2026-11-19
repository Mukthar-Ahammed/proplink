import "server-only";

import { requireAdminPagePermission } from "@/lib/authz";
import { ModerationQueueClient } from "./ModerationQueueClient";

export const metadata = { title: "Admin — Agent Listing Moderation | PropLink" };

export default async function ModerationPage() {
  await requireAdminPagePermission("LISTING_MODERATION");

  return <ModerationQueueClient />;
}
