"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { mayOpenAdminPath } from "@/lib/authz/adminRoutes";

export interface NavItem {
  label: string;
  href: string;
  exact?: boolean;
  /** Shown as a tooltip so similar-sounding links are told apart. */
  hint?: string;
  /** Indented under the item above it (agent sub-pages under Agents). */
  child?: boolean;
}

export interface NavGroup {
  id: string;
  title: string;
  items: NavItem[];
}

/**
 * Admin navigation, grouped by the job an Admin is doing. Every link is a
 * working page; unbuilt areas are not listed. Links the Admin lacks the
 * permission for are hidden (the server still checks, ADR-058).
 */
export const NAVIGATION_GROUPS: NavGroup[] = [
  {
    id: "queues",
    title: "Review queues",
    items: [
      {
        label: "KYC checks",
        href: "/admin/kyc",
        hint: "Identity verifications awaiting a decision",
      },
      {
        label: "Landlord listings",
        href: "/admin/landlord-listings",
        hint: "Private landlord listings to review before Agents see them",
      },
      {
        label: "Listing moderation",
        href: "/admin/moderation",
        hint: "Agent listings pending approval",
      },
      {
        label: "Flipper resales",
        href: "/admin/resales",
        hint: "Investor resales pending approval",
      },
      {
        label: "Reviews",
        href: "/admin/reviews",
        hint: "Reviews waiting to be published",
      },
    ],
  },
  {
    id: "deals",
    title: "Deals & chats",
    items: [
      {
        label: "Investor projects",
        href: "/admin/projects",
        hint: "Projects, expressions of interest and funding",
      },
      { label: "Chats", href: "/admin/chats", hint: "Chat authorisations and access" },
    ],
  },
  {
    id: "people",
    title: "People",
    items: [
      { label: "Users", href: "/admin/users", hint: "Every account, any role" },
      { label: "Agents", href: "/admin/agents", exact: true, hint: "Agent profiles" },
      { label: "Agencies", href: "/admin/agents/agencies", child: true },
      { label: "Invites", href: "/admin/agents/invites", child: true },
      { label: "Company checks", href: "/admin/agents/companies", child: true },
      { label: "Existing agents", href: "/admin/agents/migration", child: true },
      {
        label: "Verified badges",
        href: "/admin/badges",
        hint: "Award or revoke the blue tick",
      },
    ],
  },
  {
    id: "support",
    title: "Support & compliance",
    items: [
      {
        label: "Cases",
        href: "/admin/cases",
        hint: "Reports about chats, reviews, listings and members",
      },
      {
        label: "Data requests",
        href: "/admin/privacy",
        hint: "UK GDPR access and erasure requests",
      },
    ],
  },
  {
    id: "revenue",
    title: "Revenue & marketing",
    items: [
      { label: "Subscriptions", href: "/admin/billing", hint: "Plans and prices" },
      { label: "Fee rules", href: "/admin/fees", hint: "What PropLink charges for" },
      { label: "Advertising", href: "/admin/ads", hint: "Sponsored placements" },
      {
        label: "Announcements",
        href: "/admin/announcements",
        hint: "Banners shown in user dashboards",
      },
    ],
  },
  {
    id: "system",
    title: "System & settings",
    items: [
      {
        label: "KPIs",
        href: "/admin/system",
        exact: true,
        hint: "Queue times, funnel, email and webhook health",
      },
      {
        label: "Integrations",
        href: "/admin/system/integrations",
        hint: "Provider status",
      },
      { label: "Security events", href: "/admin/system/security" },
      { label: "Upload limits", href: "/admin/settings/uploads" },
      { label: "Track record", href: "/admin/settings/track-record" },
      { label: "Admin roles", href: "/admin/roles", hint: "Admin permissions" },
    ],
  },
];

const OVERVIEW: NavItem = { label: "Overview", href: "/admin", exact: true };

function isItemActive(currentPath: string, item: NavItem): boolean {
  if (item.exact) return currentPath === item.href;
  return currentPath === item.href || currentPath.startsWith(`${item.href}/`);
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={item.hint}
      aria-current={active ? "page" : undefined}
      className={`flex items-center rounded-xl py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        item.child ? "ml-3 border-l border-line pl-4 pr-3 text-[13px]" : "px-3"
      } ${
        active
          ? "bg-pale text-accent font-semibold"
          : "text-secondary hover:bg-surface hover:text-primary"
      }`}
    >
      {item.label}
    </Link>
  );
}

export function AdminSidebar({
  mobileOpen,
  onCloseMobile,
  permissions = [],
}: {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
  /** Phase 6 (ADR-058): links the Admin may not open are hidden (the server still checks). */
  permissions?: string[];
}) {
  const currentPath = usePathname() ?? "";
  const groups = NAVIGATION_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => mayOpenAdminPath(permissions, item.href)),
  })).filter((group) => group.items.length > 0);

  // Prefix match (ignoring `exact`) so detail pages such as
  // /admin/agents/[id] still keep their group open.
  const activeGroupId = groups.find((g) =>
    g.items.some((item) => isItemActive(currentPath, { ...item, exact: false })),
  )?.id;

  // Groups start collapsed except Review queues and the one holding the
  // current page. The admin layout stays mounted between pages, so the
  // Admin's own open/closed choices last for the session.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    queues: true,
  });

  function toggleGroup(id: string) {
    setOpenGroups((prev) => ({ ...prev, [id]: !isGroupOpen(prev, id) }));
  }

  function isGroupOpen(state: Record<string, boolean>, id: string): boolean {
    if (id === activeGroupId) return true;
    return state[id] ?? false;
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
        className={`fixed bottom-0 top-0 left-0 z-50 flex w-64 flex-col border-r border-line bg-white transition-transform duration-200 ease-in-out lg:sticky lg:bottom-auto lg:h-screen lg:shrink-0 lg:z-auto lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Admin Navigation Sidebar"
      >
        {/* Brand Area */}
        <div className="flex h-[72px] items-center justify-between border-b border-line px-5">
          <Link href="/admin" className="flex items-center gap-2.5 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-xs font-bold tracking-wider text-white">
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
            className="rounded-full p-2 text-muted hover:bg-surface hover:text-primary lg:hidden"
            aria-label="Close navigation sidebar"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Navigation Items */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          <NavLink
            item={OVERVIEW}
            active={isItemActive(currentPath, OVERVIEW)}
            onNavigate={onCloseMobile}
          />

          {groups.map((group) => {
            const open = isGroupOpen(openGroups, group.id);
            const listId = `admin-nav-${group.id}`;
            return (
              <div key={group.id} className="pt-2">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={open}
                  aria-controls={listId}
                  disabled={group.id === activeGroupId}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:hover:text-muted"
                >
                  <span>{group.title}</span>
                  <span className="flex items-center gap-2">
                    {!open && (
                      <span className="rounded-full bg-surface px-1.5 text-[10px] font-semibold tabular-nums">
                        {group.items.length}
                      </span>
                    )}
                    <svg
                      className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M7.05 4.05a1 1 0 0 1 1.4 0l5.25 5.25a1 1 0 0 1 0 1.4l-5.25 5.25a1 1 0 1 1-1.4-1.4L11.6 10 7.05 5.45a1 1 0 0 1 0-1.4Z" />
                    </svg>
                  </span>
                </button>
                {open && (
                  <ul id={listId} className="mt-1 space-y-0.5">
                    {group.items.map((item) => (
                      <li key={item.href}>
                        <NavLink
                          item={item}
                          active={isItemActive(currentPath, item)}
                          onNavigate={onCloseMobile}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer Security Badge */}
        <div className="border-t border-line p-4">
          <div className="rounded-2xl bg-surface p-3 text-center">
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
