import "server-only";

import { notFound } from "next/navigation";
import { requireAdminPagePermission } from "@/lib/authz";
import { getAdminKycSubmissionDetail } from "@/services/admin/kycAdminService";
import { KycReviewStudioClient } from "./KycReviewStudioClient";

export const metadata = { title: "Admin — KYC Compliance Review Studio | PropLink" };

export default async function KycReviewStudioPage(props: {
  params: Promise<{ submissionId: string }>;
}) {
  const session = await requireAdminPagePermission("VERIFICATION");

  const { submissionId } = await props.params;

  const result = await getAdminKycSubmissionDetail(
    {
      userId: session.user.id,
      role: session.user.role,
      active: session.user.active ?? true,
    },
    submissionId,
  );

  if (!result.ok || !result.data) {
    notFound();
  }

  return (
    <KycReviewStudioClient
      submissionId={submissionId}
      initialData={result.data}
      currentAdminUserId={session.user.id}
    />
  );
}
