import "server-only";

import { requireAdminPagePermission } from "@/lib/authz";
import { ResaleQueueClient } from "./ResaleQueueClient";

export const metadata = { title: "Admin — Flipper Resale Moderation | PropLink" };

export default async function FlipperResalesPage() {
  await requireAdminPagePermission("LISTING_MODERATION");

  return <ResaleQueueClient />;
}
