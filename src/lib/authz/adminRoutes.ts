/**
 * Which Admin permission each Admin area needs (Phase 6 Task 2, ADR-058).
 * Pages, actions and APIs check it on the server; the sidebar uses the same
 * list only to hide links an Admin cannot open. Most specific prefix first.
 * `null` means any Admin (the overview).
 */
export const ADMIN_ROUTE_PERMISSIONS: readonly (readonly [string, string | null])[] = [
  ["/admin/roles", "SUPER_ADMIN"],
  ["/admin/ads", "ADVERTISER_MANAGEMENT"],
  ["/admin/agents/companies", "VERIFICATION"],
  ["/admin/agents/invites", "VERIFICATION"],
  ["/admin/agents/migration", "VERIFICATION"],
  ["/admin/agents", "SUSPENSION"],
  ["/admin/announcements", "SYSTEM_INTEGRATIONS"],
  ["/admin/badges", "VERIFICATION"],
  ["/admin/billing", "SUBSCRIPTION_PRICING"],
  ["/admin/fees", "SUBSCRIPTION_PRICING"],
  ["/admin/chats", "CHAT_AUTHORIZATION"],
  ["/admin/kyc", "VERIFICATION"],
  ["/admin/landlord-listings", "LISTING_MODERATION"],
  ["/admin/moderation", "LISTING_MODERATION"],
  ["/admin/listings", "LISTING_MODERATION"],
  ["/admin/resales", "LISTING_MODERATION"],
  ["/admin/projects", "PROJECT_OVERSIGHT"],
  ["/admin/reviews", "REVIEW_MODERATION"],
  ["/admin/cases", "CASE_MANAGEMENT"],
  ["/admin/data-exports", "CASE_MANAGEMENT"],
  ["/admin/privacy", "CASE_MANAGEMENT"],
  ["/admin/system", "SYSTEM_INTEGRATIONS"],
  ["/admin/settings", "SYSTEM_INTEGRATIONS"],
  ["/admin/users", "SUSPENSION"],
  ["/admin/audit", "SUPER_ADMIN"],
  ["/admin", null],
];

export function permissionForAdminPath(path: string): string | null {
  if (path === "/admin") return null;
  const hit = ADMIN_ROUTE_PERMISSIONS.find(
    ([prefix]) =>
      prefix !== "/admin" && (path === prefix || path.startsWith(`${prefix}/`)),
  );
  // Unknown Admin areas need super-admin until they are mapped.
  return hit ? hit[1] : "SUPER_ADMIN";
}

export function mayOpenAdminPath(permissions: readonly string[], path: string): boolean {
  const needed = permissionForAdminPath(path);
  return (
    needed === null || permissions.includes("SUPER_ADMIN") || permissions.includes(needed)
  );
}
