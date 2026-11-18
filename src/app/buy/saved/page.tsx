import Link from "next/link";
import { requirePageRole } from "@/lib/authz";
import { db } from "@/lib/db";
import { formatPenceGBP } from "@/services/metrics/globalMetrics";
import { PortalEmpty, PortalSection } from "@/components/portal/PortalShell";
import { ActionButton } from "@/components/projects/ActionButton";
import { searchAlertsAction } from "@/components/buy/savedSearchActions";
import {
  listSavedSearches,
  MAX_ALERT_EMAILS_PER_DAY,
  MAX_ALERTING_SEARCHES,
} from "@/services/buyers/savedSearches";

export const dynamic = "force-dynamic";

export default async function SavedPage() {
  const { user } = await requirePageRole("BUYER");

  // Scoped by `userId` in the `where` — never filtered after the fact.
  const [saved, searches] = await Promise.all([
    db.savedProperty.findMany({
      where: { userId: user.id },
      orderBy: { property: { createdAt: "desc" } },
      include: {
        property: { select: { id: true, title: true, city: true, askingPriceGBP: true } },
      },
    }),
    listSavedSearches({ userId: user.id, role: user.role }),
  ]);

  return (
    <>
      <PortalSection title="Saved searches">
        {searches.length === 0 ? (
          <p className="text-sm text-muted">
            No saved searches. Use &ldquo;Save this search&rdquo; on the search page.
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted">
              Alerts email you new matches at most once a day per search (up to{" "}
              {MAX_ALERTING_SEARCHES} searches, {MAX_ALERT_EMAILS_PER_DAY} emails a day).
              Each email has a link to stop it.
            </p>
            <ul className="space-y-3" data-testid="saved-searches">
              {searches.map((search) => (
                <li
                  key={search.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white p-3 text-sm"
                >
                  <Link
                    href={`/buy${search.query ? `?${search.query}` : ""}`}
                    className="font-medium text-primary underline decoration-line underline-offset-4 hover:decoration-accent"
                  >
                    {search.name}
                  </Link>
                  <span className="text-muted">
                    Alerts {search.alertsEnabled ? "on" : "off"}
                  </span>
                  <ActionButton
                    action={searchAlertsAction}
                    hidden={{
                      id: search.id,
                      action: search.alertsEnabled ? "off" : "on",
                    }}
                    label={search.alertsEnabled ? "Turn alerts off" : "Turn alerts on"}
                    tone="secondary"
                  />
                  <ActionButton
                    action={searchAlertsAction}
                    hidden={{ id: search.id, action: "delete" }}
                    label="Delete"
                    tone="danger"
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </PortalSection>
      <PortalSection title="Saved properties">
        {saved.length === 0 ? (
          <PortalEmpty>
            Nothing saved yet. Save a listing from the search and it appears here.
          </PortalEmpty>
        ) : (
          <ul className="border-t border-line">
            {saved.map((s) => (
              <li
                key={s.propertyId}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line py-4"
              >
                <Link
                  href={`/marketplace/${s.property.id}`}
                  className="font-medium text-primary underline decoration-line underline-offset-4 hover:decoration-accent"
                >
                  {s.property.title}
                </Link>
                <span className="text-sm text-muted">
                  {s.property.city} · {formatPenceGBP(s.property.askingPriceGBP)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PortalSection>
    </>
  );
}
