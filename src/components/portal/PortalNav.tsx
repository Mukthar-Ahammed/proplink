"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PortalNavItem } from "@/components/portal/PortalShell";

/**
 * The portal sub-nav, with the current page marked.
 *
 * A client component only because it needs `usePathname` — a layout cannot know
 * which of its children is rendering, and passing `current` down from every page
 * is a prop that would silently rot the first time someone adds a page and
 * forgets it.
 */
export function PortalNav({ items }: { items: PortalNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Portal"
      className="relative z-10 mt-8 flex gap-2 overflow-x-auto pb-3"
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
            className={`rounded-full px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all ${
              active
                ? "bg-white text-primary shadow-sm"
                : "text-pale/65 hover:bg-white/10 hover:text-white"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
