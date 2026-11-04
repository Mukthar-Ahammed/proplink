import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicEnv } from "@/lib/supabase/env";

/**
 * Creates the cookie-aware Supabase client used by Next.js Proxy.
 *
 * This is intentionally not wired into the existing Auth.js middleware yet:
 * Phase 2 lays the foundation without cutting authentication over.
 * Authorization consumers must validate the user with auth.getUser().
 */
export function createMiddlewareClient(
  request: NextRequest,
  requestHeaders: Headers = new Headers(request.headers),
) {
  const { url, publishableKey } = getSupabasePublicEnv();
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  let refreshedCookies: Array<{
    name: string;
    value: string;
    options: CookieOptions;
  }> = [];

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        refreshedCookies = cookiesToSet;
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: requestHeaders } });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  return {
    supabase,
    getResponse: () => response,
    applyCookies(target: NextResponse) {
      refreshedCookies.forEach(({ name, value, options }) =>
        target.cookies.set(name, value, options),
      );
      return target;
    },
  };
}
