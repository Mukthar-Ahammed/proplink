/**
 * Advertising placement allowlist (Phase 6 Task 1, ADR-060; Clarification
 * Answers section G, OD-11). Ads appear only in these fixed, designated
 * areas, always labelled "Sponsored". Never in search, chats, listing or
 * offer pages, viewing or pledge steps, or project pages. A test scans the
 * code so <AdSlot> is used only in the pages listed here.
 */
export const AD_PLACEMENTS = {
  HOME_PARTNERS: {
    label: "Home page, partners strip (below the fold)",
    page: "src/app/page.tsx",
  },
  AGENT_DASHBOARD: { label: "Agent dashboard", page: "src/app/agent/page.tsx" },
  LANDLORD_DASHBOARD: { label: "Landlord overview", page: "src/app/landlord/page.tsx" },
  INVESTOR_DASHBOARD: { label: "Investor dashboard", page: "src/app/investor/page.tsx" },
} as const;

export type AdPlacementName = keyof typeof AD_PLACEMENTS;

export function isAdPlacement(value: string): value is AdPlacementName {
  return Object.prototype.hasOwnProperty.call(AD_PLACEMENTS, value);
}

/** Areas that must never show an ad (checked by tests against the code). */
export const AD_FORBIDDEN_AREAS = [
  "src/app/marketplace/",
  "src/app/buy/",
  "src/app/messages/",
  "src/app/investor/projects/",
  "src/app/agent/projects/",
  "src/app/landlord/projects/",
  "src/app/agent/offers/",
  "src/app/admin/",
  "src/app/solicitor/",
  "src/app/esign/",
  "src/components/chat/",
  "src/components/projects/",
  "src/components/buy/",
  "src/components/marketplace/",
] as const;

/** Link shorteners and redirectors hide the real destination: refused. */
const BLOCKED_HOSTS = [
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "rebrand.ly",
  "cutt.ly",
  "shorturl.at",
];

/** An advertiser destination: https, a real hostname, no credentials, not a shortener. */
export function checkDestinationUrl(
  raw: string,
): { ok: true; url: string } | { ok: false; error: string } {
  const value = raw.trim();
  if (value.length === 0 || value.length > 500)
    return { ok: false, error: "Enter the destination link" };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "The destination must be a full https:// link" };
  }
  if (url.protocol !== "https:")
    return { ok: false, error: "The destination must use https" };
  if (url.username || url.password)
    return { ok: false, error: "Links with credentials are not allowed" };
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.startsWith("[")) {
    return { ok: false, error: "Use the advertiser's website address" };
  }
  if (url.port && url.port !== "443")
    return { ok: false, error: "Use the standard https port" };
  if (BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) {
    return { ok: false, error: "Link shorteners are not allowed; use the real address" };
  }
  if (/\s/.test(value)) return { ok: false, error: "The link contains spaces" };
  return { ok: true, url: url.toString() };
}
