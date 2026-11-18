const CSRF_REQUEST_HEADER = "x-proplink-request";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isStateChangingMethod(method: string): boolean {
  return STATE_CHANGING_METHODS.has(method.toUpperCase());
}

export function isSameOriginMutation(
  request: Request,
  expectedOrigin: string,
  requireCustomHeader: boolean,
): boolean {
  if (!isStateChangingMethod(request.method)) return true;

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  let requestOrigin = origin;
  if (!requestOrigin && referer) {
    try {
      requestOrigin = new URL(referer).origin;
    } catch {
      return false;
    }
  }
  if (!requestOrigin || requestOrigin !== new URL(expectedOrigin).origin) return false;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site") {
    return false;
  }

  const hasTrustedFetchMetadata = fetchSite === "same-origin";
  return (
    !requireCustomHeader ||
    hasTrustedFetchMetadata ||
    request.headers.get(CSRF_REQUEST_HEADER) === "1"
  );
}

/**
 * Provider webhooks (POST /api/webhooks/*) are authenticated by a signature
 * over the raw body, verified in their route, so they are exempt from the
 * same-origin check. Nothing else is: the prefix is exact and POST-only.
 */
export function isSignedWebhookRequest(method: string, pathname: string): boolean {
  return method.toUpperCase() === "POST" && pathname.startsWith("/api/webhooks/");
}
