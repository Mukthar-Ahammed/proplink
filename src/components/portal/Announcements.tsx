import type { AnnouncementKind } from "@/generated/prisma/enums";

export type AnnouncementView = {
  id: string;
  kind: AnnouncementKind;
  title: string;
  body: string;
  startsAt: Date;
};

/**
 * PropLink's own banners and platform updates (Phase 1 Task 3, Q1). Rendered
 * as plain text (React escapes it, and the service rejects markup and links).
 * Labelled "From PropLink" so it is never mistaken for paid advertising.
 */
export function PortalAnnouncements({ items }: { items: AnnouncementView[] }) {
  if (items.length === 0) return null;
  const banners = items.filter((item) => item.kind === "BANNER");
  const updates = items.filter((item) => item.kind === "UPDATE");

  return (
    <div className="space-y-4" data-testid="portal-announcements">
      {banners.map((banner) => (
        <section
          key={banner.id}
          aria-label="Announcement from PropLink"
          className="rounded-2xl border border-accent/30 bg-pale px-5 py-4"
        >
          <p className="text-[11px] font-semibold tracking-[0.18em] text-secondary uppercase">
            From PropLink
          </p>
          <h2 className="mt-1 text-base font-semibold text-primary">{banner.title}</h2>
          <p className="mt-1 whitespace-pre-line text-sm text-body">{banner.body}</p>
        </section>
      ))}
      {updates.length > 0 && (
        <section
          aria-label="Platform updates"
          className="rounded-2xl border border-line bg-white px-5 py-4"
        >
          <p className="text-[11px] font-semibold tracking-[0.18em] text-muted uppercase">
            Platform updates
          </p>
          <ul className="mt-2 space-y-3">
            {updates.map((update) => (
              <li key={update.id}>
                <p className="text-sm font-semibold text-primary">{update.title}</p>
                <p className="mt-0.5 whitespace-pre-line text-sm text-body">
                  {update.body}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {update.startsAt.toISOString().slice(0, 10)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
