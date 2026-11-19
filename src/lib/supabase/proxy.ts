import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicEnv } from "@/lib/supabase/env";

/**
 * Creates the cookie-aware Supabase client used by Next.js Proxy.
 *
 * Supabase Auth is the active session provider. Authorization consumers still
 * validate the user with auth.getUser() rather than trusting cookie contents.
 */
export function createMiddlewareClient(
  request: NextRequest,
  requestHeaders: Headers = new Headers(request.headers),
) {
  const { url, publishableKey } = getSupabasePublicEnv();
  let refreshedCookies: Array<{
    name: string;
    value: string;
    options: CookieOptions;
  }> = [];

  const supabase = createServerClient(url, publishableKey, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        refreshedCookies = cookiesToSet;
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
      },
    },
  });

  return {
    supabase,
    getResponse() {
      const response = NextResponse.next({ request: { headers: requestHeaders } });
      refreshedCookies.forEach(({ name, value, options }) =>
        response.cookies.set(name, value, options),
      );
      return response;
    },
    applyCookies(target: NextResponse) {
      refreshedCookies.forEach(({ name, value, options }) =>
        target.cookies.set(name, value, options),
      );
      return target;
    },
  };
}
