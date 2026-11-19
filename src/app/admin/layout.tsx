import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminPermissionsOf } from "@/services/admin/permissions";
import { isMfaSatisfied } from "@/services/auth/mfa";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const pathname = headerList.get("x-pathname") || "";

  // The Admin Login surface (/admin/login) shares this route segment layout.
  // Unauthenticated visitors to /admin/login must render the login page without shell wrapper.
  if (pathname === "/admin/login" || pathname === "/admin-login") {
    return <>{children}</>;
  }

  // SEC-01 Hardening: Fail Closed Boundary.
  // Any attempt to access protected /admin/* routes without an active ADMIN session
  // is blocked and redirected immediately at the layout level.
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN" || !session.user.active) {
    redirect("/admin/login");
  }
  // Phase 1 Task 11 (ADR-030): Admin never sees /admin without a second factor.
  if (!(await isMfaSatisfied(session.user))) redirect("/mfa");

  const permissions = [...(await adminPermissionsOf(session.user.authUserId))];
  return (
    <AdminShell
      userName={session.user.name ?? "Administrator"}
      userEmail={session.user.email}
      permissions={permissions}
    >
      {children}
    </AdminShell>
  );
}
