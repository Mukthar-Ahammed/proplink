import "server-only";

import { requirePageRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import { ModerationQueueClient } from "./ModerationQueueClient";

export const metadata = { title: "Admin — Agent Listing Moderation | PropLink" };

export default async function ModerationPage() {
  await requirePageRole(Role.ADMIN);

  return <ModerationQueueClient />;
}
