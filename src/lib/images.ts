/**
 * Image optimisation allowlist (Phase 5 Task 6, ADR-057). Only these sources
 * go through Next's image optimiser; the same hosts are the only remote ones
 * the Content Security Policy's img-src allows (src/lib/security/headers.ts).
 * Anything else (an agent-hosted URL, say) is not optimised and the CSP
 * decides whether it loads at all.
 */
export const IMAGE_REMOTE_HOSTS = ["*.supabase.co", "images.unsplash.com"] as const;
/** Same-origin uploads (mock and dev storage, seeds). */
export const IMAGE_LOCAL_PREFIX = "/uploads/";

function hostAllowed(host: string): boolean {
  return IMAGE_REMOTE_HOSTS.some((pattern) =>
    pattern.startsWith("*.") ? host.endsWith(pattern.slice(1)) : host === pattern,
  );
}

/** True when `<Image>` may optimise this URL (https on an allowlisted host, or a local upload). */
export function isOptimisableImage(url: string): boolean {
  if (url.startsWith(IMAGE_LOCAL_PREFIX) && !url.includes("?") && !url.includes("..")) {
    return true;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && hostAllowed(parsed.hostname);
  } catch {
    return false;
  }
}
