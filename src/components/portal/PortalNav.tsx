"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PortalNavItem } from "@/components/portal/PortalShell";
import { OPEN_SUBSCRIPTION_EVENT } from "@/components/billing/events";
import { CrownIcon } from "@/components/billing/CrownIcon";

/**
 * The portal sub-nav, with the current page marked.
 *
 * A client component only because it needs `usePathname` — a layout cannot know
 * which of its children is rendering, and passing `current` down from every page
 * is a prop that would silently rot the first time someone adds a page and
 * forgets it.
 *
 * A `premium` item carries a gold crown; a `locked` one (no active
 * subscription) opens the subscription popup instead of navigating. The link
 * keeps its real `href`, so without JavaScript it still goes to the page,
 * which explains the subscription itself.
 */
export function PortalNav({ items }: { items: PortalNavItem[] }) {
  const pathname = usePathname();

  return (
    // Phones: one swipeable row with the scrollbar hidden. From `lg` the tabs
    // wrap instead, so a long nav (the agent portal has 14) never shows a
    // scrollbar or hides tabs from a mouse user. The frosted backing keeps
    // tabs legible where a long row runs over the busy side of a banner photo.
    <nav
      aria-label="Portal"
      className="mt-8 -mb-px flex gap-1 overflow-x-auto [scrollbar-width:none] lg:-mx-3 lg:flex-wrap lg:overflow-visible lg:rounded-t-2xl lg:bg-white/70 lg:px-3 lg:backdrop-blur-md [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item) => {
        // Exact for the portal root, prefix for its sections — so
        // `/agent/listings/new` still marks `Listings`.
        const active =
          pathname === item.href ||
          (item.href.split("/").length > 2 && pathname.startsWith(`${item.href}/`));

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            aria-haspopup={item.locked ? "dialog" : undefined}
            onClick={
              item.locked
                ? (event) => {
                    event.preventDefault();
                    window.dispatchEvent(new CustomEvent(OPEN_SUBSCRIPTION_EVENT));
                  }
                : undefined
            }
            className={`inline-flex items-center gap-1.5 border-b-2 px-4 py-3.5 text-sm font-medium whitespace-nowrap transition-colors ${
              active
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-primary"
            }`}
          >
            {item.label}
            {item.premium && (
              <>
                <CrownIcon className="h-4 w-4 text-premium" />
                <span className="sr-only"> (subscription feature)</span>
              </>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
