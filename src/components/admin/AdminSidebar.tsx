"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  label: string;
  href: string;
  exact?: boolean;
  status?: "active" | "placeholder" | "soon";
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAVIGATION_GROUPS: NavGroup[] = [
  {
    title: "OPERATIONS",
    items: [
      { label: "Overview", href: "/admin", exact: true, status: "active" },
      { label: "KYC Queue", href: "/admin/kyc", status: "active" },
      {
        label: "Landlord Listings",
        href: "/admin/landlord-listings",
        exact: true,
        status: "active",
      },
      { label: "Moderation", href: "/admin/moderation", status: "active" },
      { label: "Flipper Resales", href: "/admin/resales", status: "active" },
    ],
  },
  {
    title: "PLATFORM",
    items: [
      { label: "Users Directory", href: "/admin/users", status: "active" },
      { label: "Agents & Agencies", href: "/admin/agents", exact: true, status: "soon" },
      { label: "Agent Invites", href: "/admin/agents/invites", status: "active" },
      { label: "Company Checks", href: "/admin/agents/companies", status: "active" },
      { label: "Existing Agents", href: "/admin/agents/migration", status: "active" },
      { label: "Verified Badges", href: "/admin/badges", status: "active" },
      { label: "Upload Limits", href: "/admin/settings/uploads", status: "active" },
      { label: "Announcements", href: "/admin/announcements", status: "active" },
      {
        label: "List for a Landlord",
        href: "/admin/landlord-listings/new",
        status: "active",
      },
      { label: "Projects & Funding", href: "/admin/projects", status: "soon" },
    ],
  },
  {
    title: "COMMERCIAL",
    items: [
      { label: "Fee Settings", href: "/admin/fees", status: "placeholder" },
      { label: "Ad Campaigns", href: "/admin/ads", status: "placeholder" },
    ],
  },
  {
    title: "GOVERNANCE",
    items: [
      { label: "Audit Logs", href: "/admin/audit", status: "soon" },
      { label: "Privacy & Erasure", href: "/admin/privacy", status: "soon" },
      { label: "Platform Settings", href: "/admin/settings", status: "soon" },
    ],
  },
];

export function AdminSidebar({
  mobileOpen,
  onCloseMobile,
}: {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}) {
  const currentPath = usePathname();

  function isItemActive(item: NavItem): boolean {
    if (item.exact) {
      return currentPath === item.href;
    }
    return currentPath === item.href || currentPath.startsWith(`${item.href}/`);
  }

  return (
    <>
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-primary/60 backdrop-blur-xs lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed bottom-0 top-0 left-0 z-50 flex w-64 flex-col border-r border-line bg-white transition-transform duration-200 ease-in-out lg:static lg:z-auto lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Admin Navigation Sidebar"
      >
        {/* Brand Area */}
        <div className="flex h-16 items-center justify-between border-b border-line px-5">
          <Link href="/admin" className="flex items-center gap-2.5 group">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand text-xs font-black tracking-widest text-white shadow-xs">
              PL
            </div>
            <div>
              <div className="text-sm font-bold tracking-tight text-primary leading-none group-hover:text-accent transition-colors">
                PropLink
              </div>
              <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                Admin Operations
              </div>
            </div>
          </Link>

          {/* Close button for mobile */}
          <button
            onClick={onCloseMobile}
            className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-primary lg:hidden"
            aria-label="Close navigation sidebar"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Navigation Items */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {NAVIGATION_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="px-3 pb-2 text-[10px] font-bold tracking-wider text-muted uppercase">
                {group.title}
              </div>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isItemActive(item);
                  const isAvailable =
                    item.status === "active" || item.status === "placeholder";

                  if (!isAvailable) {
                    return (
                      <li key={item.label}>
                        <div
                          className="flex items-center justify-between rounded-md px-3 py-2 text-xs font-medium text-muted/60 bg-transparent opacity-60 cursor-not-allowed select-none"
                          title="Operational surface under development (Phase A4-A8)"
                        >
                          <span>{item.label}</span>
                          <span className="rounded bg-surface px-1.5 py-0.5 text-[9px] font-semibold text-muted uppercase">
                            Soon
                          </span>
                        </div>
                      </li>
                    );
                  }

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onCloseMobile}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center justify-between rounded-md px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                          active
                            ? "bg-primary text-white font-semibold shadow-xs"
                            : "text-secondary hover:bg-surface hover:text-primary"
                        }`}
                      >
                        <span>{item.label}</span>
                        {item.status === "placeholder" && (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                              active ? "bg-white/20 text-white" : "bg-pale text-secondary"
                            }`}
                          >
                            Placeholder
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer Security Badge */}
        <div className="border-t border-line p-4">
          <div className="rounded-md bg-surface p-2.5 text-center">
            <div className="text-[11px] font-semibold text-primary">
              🔒 Admin Security Portal
            </div>
            <div className="mt-0.5 text-[10px] text-muted">
              Role: <span className="font-semibold text-body">ADMIN</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
