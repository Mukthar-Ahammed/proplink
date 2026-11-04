import "server-only";

import { notFound } from "next/navigation";
import { requirePageRole } from "@/lib/authz";
import { Role } from "@/generated/prisma/enums";
import { getAdminResaleDetail } from "@/services/admin/flipperResaleAdminService";
import { ResaleReviewStudioClient } from "./ResaleReviewStudioClient";

export const metadata = { title: "Admin — Flipper Resale Moderation Studio | PropLink" };

export default async function FlipperResaleReviewStudioPage(
  props: { params: Promise<{ resaleId: string }> },
) {
  const session = await requirePageRole(Role.ADMIN);

  const { resaleId } = await props.params;

  const result = await getAdminResaleDetail(
    {
      userId: session.user.id,
      role: session.user.role,
      active: session.user.active ?? true,
    },
    resaleId,
  );

  if (!result.ok || !result.data) {
    notFound();
  }

  return (
    <ResaleReviewStudioClient
      resaleId={resaleId}
      initialData={result.data}
      currentAdminUserId={session.user.id}
    />
  );
}
