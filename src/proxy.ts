import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/db";
import { createMiddlewareClient } from "@/lib/supabase/proxy";

const GATES: Array<{ prefix: string; roles: string[] }> = [
  { prefix: "/admin", roles: ["ADMIN"] },
  { prefix: "/agent", roles: ["AGENT"] },
  { prefix: "/investor", roles: ["INVESTOR"] },
  { prefix: "/buy", roles: ["BUYER"] },
];

/**
 * Refreshes Supabase Auth cookies and provides an optimistic portal gate.
 * Every protected page/action still performs its own server authorization.
 */
export async function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const { pathname } = request.nextUrl;
  requestHeaders.set("x-pathname", pathname);
  const { supabase, getResponse, applyCookies } = createMiddlewareClient(
    request,
    requestHeaders,
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The Admin authentication surface is intentionally separate from both the
  // public login page and the protected Admin portal.
  if (pathname === "/admin/login" || pathname === "/admin-login") return getResponse();

  const gate = GATES.find(
    (candidate) =>
      pathname === candidate.prefix || pathname.startsWith(`${candidate.prefix}/`),
  );
  if (!gate) return getResponse();

  if (!user?.email_confirmed_at) {
    const login = new URL(
      gate.prefix === "/admin" ? "/admin/login" : "/login",
      request.url,
    );
    login.searchParams.set("callbackUrl", pathname);
    return applyCookies(NextResponse.redirect(login));
  }

  const profile = await db.profile.findUnique({
    where: { id: user.id },
    select: {
      role: true,
      active: true,
      kycStatus: true,
      legacyUserId: true,
      legacyUser: { select: { role: true, active: true, kycStatus: true } },
    },
  });
  if (
    !profile?.active ||
    !profile.legacyUserId ||
    !profile.legacyUser?.active ||
    profile.role !== profile.legacyUser.role ||
    profile.kycStatus !== profile.legacyUser.kycStatus
  ) {
    return applyCookies(
      NextResponse.redirect(
        new URL(gate.prefix === "/admin" ? "/admin/login" : "/login", request.url),
      ),
    );
  }

  if (!gate.roles.includes(profile.role)) {
    return applyCookies(
      NextResponse.rewrite(new URL("/403", request.url), { status: 403 }),
    );
  }

  return getResponse();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif)$).*)",
  ],
};
