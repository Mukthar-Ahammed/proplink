"use client";

import { useState } from "react";
import { AdminSidebar } from "./AdminSidebar";
import { AdminHeader } from "./AdminHeader";

export interface AdminShellProps {
  children: React.ReactNode;
  userName?: string;
  userEmail?: string;
}

export function AdminShell({ children, userName, userEmail }: AdminShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-surface/50 text-body flex flex-col font-sans">
      <div className="flex flex-1">
        {/* Sidebar */}
        <AdminSidebar
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
        />

        {/* Main Content Area */}
        <div className="flex flex-1 flex-col min-w-0">
          <AdminHeader
            userName={userName}
            userEmail={userEmail}
            onOpenMobileSidebar={() => setMobileOpen(true)}
          />

          <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
