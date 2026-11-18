import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/db";
import { getServerEnv } from "@/env";
import {
  isSameOriginMutation,
  isSignedWebhookRequest,
  isStateChangingMethod,
} from "@/lib/security/csrf";
import {
  buildContentSecurityPolicy,
  isFlipperPath,
  isPrivateResponsePath,
} from "@/lib/security/headers";
import {
  enforceRequestRateLimit,
  RateLimitBackendUnavailableError,
} from "@/lib/security/rate-limit";
import { createMiddlewareClient } from "@/lib/supabase/proxy";

const GATES: Array<{ prefix: string; roles: string[] }> = [
  { prefix: "/admin", roles: ["ADMIN"] },
  { prefix: "/agent", roles: ["AGENT"] },
  { prefix: "/investor", roles: ["INVESTOR"] },
  { prefix: "/buy", roles: ["BUYER"] },
  { prefix: "/account-pending", roles: ["LANDLORD", "SOLICITOR", "ADVERTISER"] },
  { prefix: "/verify", roles: ["LANDLORD", "INVESTOR"] },
];

/**
 * Refreshes Supabase Auth cookies and provides an optimistic portal gate.
 * Every protected page/action still performs its own server authorization.
 */
export async function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const { pathname } = request.nextUrl;
  requestHeaders.delete("x-proplink-user-id");
  const requestId = randomUUID();
  const nonce = randomBytes(18).toString("base64");
  const env = getServerEnv();
  const supabaseOrigin = env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin
    : undefined;
  const contentSecurityPolicy = buildContentSecurityPolicy(
    nonce,
    supabaseOrigin,
    env.NODE_ENV !== "production",
  );
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", contentSecurityPolicy);
  requestHeaders.set("x-pathname", pathname);

  if (
    isFlipperPath(pathname) &&
    !(env.FLIPPER_FLOWS_ENABLED && env.FINANCIAL_PROMOTIONS_REVIEWED)
  ) {
    const response = pathname.startsWith("/api/")
      ? NextResponse.json({ error: "Not found" }, { status: 404 })
      : NextResponse.rewrite(new URL("/403", request.url), { status: 404 });
    return secureResponse(response, request, requestId, nonce, contentSecurityPolicy);
  }

  const { supabase, getResponse, applyCookies } = createMiddlewareClient(
    request,
    requestHeaders,
  );

  const expectedOrigin = env.APP_ORIGIN ?? request.nextUrl.origin;
  const isApiRequest = pathname.startsWith("/api/");
  if (
    !isSignedWebhookRequest(request.method, pathname) &&
    !isSameOriginMutation(
      request,
      expectedOrigin,
      isApiRequest && isStateChangingMethod(request.method),
    )
  ) {
    console.warn(
      JSON.stringify({
        event: "security.csrf_rejected",
        requestId,
        path: pathname,
      }),
    );
    return secureResponse(
      NextResponse.json({ error: "Request origin rejected" }, { status: 403 }),
      request,
      requestId,
      nonce,
      contentSecurityPolicy,
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The Admin authentication surface is intentionally separate from both the
  // public login page and the protected Admin portal.
  requestHeaders.delete("x-proplink-user-id");
  if (user?.id) requestHeaders.set("x-proplink-user-id", user.id);

  let rateLimit;
  try {
    rateLimit = await enforceRequestRateLimit(request, user?.id);
  } catch (error) {
    if (!(error instanceof RateLimitBackendUnavailableError)) throw error;
    return secureResponse(
      NextResponse.json({ error: "Service temporarily unavailable" }, { status: 503 }),
      request,
      requestId,
      nonce,
      contentSecurityPolicy,
    );
  }
  if (rateLimit && !rateLimit.allowed) {
    console.warn(
      JSON.stringify({
        event: "security.rate_limit_exceeded",
        requestId,
        routeClass: rateLimit.routeClass,
        blocked: rateLimit.blocked,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      }),
    );
    const response = NextResponse.json(
      {
        error: "Too many requests. Please try again later.",
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      { status: 429 },
    );
    response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
    return secureResponse(response, request, requestId, nonce, contentSecurityPolicy);
  }

  if (pathname === "/admin/login" || pathname === "/admin-login") {
    return secureResponse(
      applyCookies(getResponse()),
      request,
      requestId,
      nonce,
      contentSecurityPolicy,
    );
  }

  const gate = GATES.find(
    (candidate) =>
      pathname === candidate.prefix || pathname.startsWith(`${candidate.prefix}/`),
  );
  if (!gate) {
    return secureResponse(
      applyCookies(getResponse()),
      request,
      requestId,
      nonce,
      contentSecurityPolicy,
    );
  }

  if (!user?.email_confirmed_at) {
    const login = new URL(
      gate.prefix === "/admin" ? "/admin/login" : "/login",
      request.url,
    );
    login.searchParams.set("callbackUrl", pathname);
    return secureResponse(
      applyCookies(NextResponse.redirect(login)),
      request,
      requestId,
      nonce,
      contentSecurityPolicy,
    );
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
    return secureResponse(
      applyCookies(
        NextResponse.redirect(
          new URL(gate.prefix === "/admin" ? "/admin/login" : "/login", request.url),
        ),
      ),
      request,
      requestId,
      nonce,
      contentSecurityPolicy,
    );
  }

  if (!gate.roles.includes(profile.role)) {
    return secureResponse(
      applyCookies(NextResponse.rewrite(new URL("/403", request.url), { status: 403 })),
      request,
      requestId,
      nonce,
      contentSecurityPolicy,
    );
  }

  return secureResponse(
    applyCookies(getResponse()),
    request,
    requestId,
    nonce,
    contentSecurityPolicy,
  );
}

function secureResponse(
  response: NextResponse,
  request: NextRequest,
  requestId: string,
  nonce: string,
  contentSecurityPolicy: string,
): NextResponse {
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  response.headers.set("X-Request-ID", requestId);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("X-Frame-Options", "DENY");
  if (process.env.NODE_ENV === "production") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  const { pathname } = request.nextUrl;
  if (isPrivateResponsePath(pathname)) {
    response.headers.set(
      "Cache-Control",
      "private, no-store, max-age=0, must-revalidate",
    );
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  if (pathname === "/auth/confirm" || pathname === "/reset-password") {
    response.headers.set("Referrer-Policy", "no-referrer");
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif)$).*)",
  ],
};
