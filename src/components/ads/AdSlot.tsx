import { headers } from "next/headers";

import { pickAd, recordAdEvent } from "@/services/ads/ads";
import { isAdPlacement, type AdPlacementName } from "@/services/ads/placements";

/**
 * A designated ad slot (Phase 6 Task 1, ADR-060). Server-rendered: no
 * third-party script, no tracker, no pop-up. Always labelled "Sponsored";
 * the link goes through PropLink's click counter with
 * rel="sponsored noopener noreferrer". Renders nothing when the slot is not
 * on the allowlist or has no live ad. Use only on the pages listed in
 * src/services/ads/placements.ts (a test enforces it).
 */
export async function AdSlot({ slot }: { slot: AdPlacementName }) {
  if (!isAdPlacement(slot)) return null;
  let ad: Awaited<ReturnType<typeof pickAd>> = null;
  try {
    ad = await pickAd(slot);
  } catch {
    return null; // an ad must never break the page around it
  }
  if (!ad) return null;
  const requestHeaders = await headers();
  const visitor =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  try {
    await recordAdEvent(ad.id, "impression", visitor);
  } catch {
    // Counting is best effort.
  }
  return (
    <aside
      aria-label="Sponsored"
      data-testid="ad-slot"
      data-slot={slot}
      className="rounded-xl border border-line bg-surface p-4"
    >
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">
        Sponsored
      </p>
      <a
        href={`/api/ads/click/${ad.id}`}
        target="_blank"
        rel="sponsored noopener noreferrer"
        className="mt-2 flex items-center gap-4 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {ad.hasImage && (
          // Served by PropLink after the malware scan; not an external host.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/ads/image/${ad.id}`}
            alt=""
            width={96}
            height={72}
            loading="lazy"
            className="h-18 w-24 flex-none rounded object-cover"
          />
        )}
        <span>
          <span className="block font-semibold text-primary">{ad.headline}</span>
          <span className="block text-sm text-body">{ad.body}</span>
          <span className="mt-1 block text-xs text-muted">{ad.advertiser}</span>
        </span>
      </a>
    </aside>
  );
}
