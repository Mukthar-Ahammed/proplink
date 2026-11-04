"use client";

import { logoutAction } from "@/app/(auth)/actions";
import { AdminBreadcrumbs } from "./AdminBreadcrumbs";

export interface AdminHeaderProps {
  userName?: string;
  userEmail?: string;
  onOpenMobileSidebar?: () => void;
}

export function AdminHeader({
  userName = "Administrator",
  userEmail,
  onOpenMobileSidebar,
}: AdminHeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-line bg-white/95 px-4 backdrop-blur-xs sm:px-6">
      <div className="flex items-center gap-3">
        {/* Mobile menu toggle */}
        <button
          onClick={onOpenMobileSidebar}
          className="rounded-md p-2 text-secondary hover:bg-surface hover:text-primary lg:hidden"
          aria-label="Open navigation sidebar"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* Breadcrumb Navigation */}
        <AdminBreadcrumbs />
      </div>

      {/* Admin User Info & Controls */}
      <div className="flex items-center gap-4">
        <div className="hidden sm:flex flex-col text-right">
          <span className="text-xs font-semibold text-primary">{userName}</span>
          {userEmail && <span className="text-[10px] text-muted">{userEmail}</span>}
        </div>

        <span className="hidden sm:inline-flex items-center rounded-md bg-brand/10 px-2 py-0.5 text-[10px] font-extrabold tracking-wider text-brand uppercase border border-brand/20">
          ADMIN
        </span>

        <form action={logoutAction}>
          <button
            type="submit"
            className="rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-secondary hover:border-danger hover:bg-danger/5 hover:text-danger transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
