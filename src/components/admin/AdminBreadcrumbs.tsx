"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ROUTE_LABELS: Record<string, string> = {
  "/admin": "Overview",
  "/admin/kyc": "KYC Review Queue",
  "/admin/moderation": "Listing Moderation",
  "/admin/ads": "Ad Campaigns",
  "/admin/fees": "Fees & Billing",
  "/admin/users": "Users Directory",
  "/admin/resales": "Flipper Resales",
};

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface AdminBreadcrumbsProps {
  items?: BreadcrumbItem[];
}

export function AdminBreadcrumbs({ items: customItems }: AdminBreadcrumbsProps = {}) {
  const pathname = usePathname();

  let items: Array<{ href?: string; label: string; isLast: boolean }>;

  if (customItems && customItems.length > 0) {
    items = customItems.map((item, idx) => ({
      href: item.href,
      label: item.label,
      isLast: idx === customItems.length - 1,
    }));
  } else {
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 0) return null;

    const computedItems: Array<{ href?: string; label: string; isLast: boolean }> = [];
    let currentPath = "";

    segments.forEach((seg, index) => {
      currentPath += `/${seg}`;
      const isLast = index === segments.length - 1;
      const label =
        ROUTE_LABELS[currentPath] ?? seg.charAt(0).toUpperCase() + seg.slice(1);
      computedItems.push({ href: currentPath, label, isLast });
    });
    items = computedItems;
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center space-x-1.5 text-xs text-muted"
    >
      <Link href="/admin" className="hover:text-primary font-medium transition-colors">
        Admin Portal
      </Link>
      {items.map((item, idx) => {
        if (item.href === "/admin") return null;
        return (
          <div
            key={item.href ?? item.label ?? idx}
            className="flex items-center space-x-1.5"
          >
            <span className="text-line select-none">/</span>
            {item.isLast || !item.href ? (
              <span className="font-semibold text-primary" aria-current="page">
                {item.label}
              </span>
            ) : (
              <Link href={item.href} className="hover:text-primary transition-colors">
                {item.label}
              </Link>
            )}
          </div>
        );
      })}
    </nav>
  );
}
