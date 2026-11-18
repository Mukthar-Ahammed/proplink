export function buildContentSecurityPolicy(
  nonce: string,
  supabaseOrigin: string | undefined,
  development: boolean,
): string {
  const connectSources = [
    "'self'",
    "https://*.supabase.co",
    "wss://*.supabase.co",
    "https://*.ingest.sentry.io",
    "https://*.sentry.io",
    "https://maps.googleapis.com",
    "https://challenges.cloudflare.com",
  ];
  if (supabaseOrigin) connectSources.push(supabaseOrigin);

  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "https://challenges.cloudflare.com",
    "https://maps.googleapis.com",
  ];
  if (development) scriptSources.push("'unsafe-eval'");

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co https://maps.googleapis.com https://maps.gstatic.com https://images.unsplash.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src ${connectSources.join(" ")}`,
    "frame-src 'self' https://challenges.cloudflare.com https://*.supabase.co",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://*.supabase.co",
    "frame-ancestors 'none'",
    "worker-src 'self' blob:",
  ];
  if (!development) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export function isPrivateResponsePath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/agent" ||
    pathname.startsWith("/agent/") ||
    pathname === "/investor" ||
    pathname.startsWith("/investor/") ||
    pathname === "/buy" ||
    pathname.startsWith("/buy/") ||
    pathname === "/account" ||
    pathname.startsWith("/account/") ||
    pathname === "/mfa" ||
    pathname === "/messages" ||
    pathname.startsWith("/messages/") ||
    pathname === "/landlord" ||
    pathname.startsWith("/landlord/") ||
    pathname === "/solicitor" ||
    pathname.startsWith("/esign/") ||
    pathname.startsWith("/solicitor/") ||
    pathname.startsWith("/dev/") ||
    pathname.startsWith("/u/") ||
    pathname === "/verify" ||
    pathname.startsWith("/verify/") ||
    pathname.startsWith("/auth/") ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password"
  );
}

export function isFlipperPath(pathname: string): boolean {
  return (
    pathname === "/investor/flip" ||
    pathname.startsWith("/investor/flip/") ||
    pathname === "/api/investor/flip" ||
    pathname.startsWith("/api/investor/flip/") ||
    pathname.startsWith("/api/agent/flipper-offers") ||
    pathname.startsWith("/api/agent/flipper-acquisitions")
  );
}
