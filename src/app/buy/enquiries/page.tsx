import { requirePageRole } from "@/lib/authz";
import { db } from "@/lib/db";
import { PortalEmpty } from "@/components/portal/PortalShell";
import { ActivityList, type ActivityItem } from "@/components/buy/ActivityList";

export const dynamic = "force-dynamic";

export default async function EnquiriesPage() {
  const { user } = await requirePageRole("BUYER");

  const enquiries = await db.enquiry.findMany({
    where: { fromUserId: user.id },
    orderBy: { createdAt: "desc" },
    include: { property: { select: { id: true, title: true } } },
  });

  if (enquiries.length === 0) {
    return (
      <PortalEmpty>
        No enquiries sent. Contacting an agent from a listing records it here.
      </PortalEmpty>
    );
  }

  const items: ActivityItem[] = enquiries.map((e) => ({
    id: e.id,
    href: `/marketplace/${e.property.id}`,
    title: e.property.title,
    meta: e.createdAt,
    status: e.status,
  }));

  return <ActivityList items={items} />;
}
