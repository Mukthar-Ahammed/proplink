import "server-only";

import { requirePageRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import { ResaleQueueClient } from "./ResaleQueueClient";

export const metadata = { title: "Admin — Flipper Resale Moderation | PropLink" };

export default async function FlipperResalesPage() {
  await requirePageRole(Role.ADMIN);

  return <ResaleQueueClient />;
}
