import "server-only";

import { requirePageRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import { KycQueueClient } from "./KycQueueClient";

export const metadata = { title: "Admin — KYC Queue & Review" };

export default async function KycQueuePage() {
  await requirePageRole(Role.ADMIN);

  return <KycQueueClient />;
}
