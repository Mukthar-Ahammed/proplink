import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  AD_FORBIDDEN_AREAS,
  AD_PLACEMENTS,
  checkDestinationUrl,
  isAdPlacement,
} from "@/services/ads/placements";

/**
 * Phase 6 Task 1 exit gate (ADR-060): ads cannot appear on forbidden pages.
 * Only the designated pages render <AdSlot>, each with its own slot; nothing
 * in search, chat, listings, offers, viewings, pledges or projects does; the
 * slot is labelled Sponsored, links are rel="sponsored", and no third-party
 * script or pop-up is involved.
 */
const ROOT = path.resolve(__dirname, "../..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "generated" ? [] : files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const sources = files(path.join(ROOT, "src")).map((full) => ({
  rel: path.relative(ROOT, full).split(path.sep).join("/"),
  text: readFileSync(full, "utf8"),
}));
const USES_SLOT = /from\s+["']@\/components\/ads\/AdSlot["']|<AdSlot\s+slot=/;

describe("ads appear only in designated places", () => {
  const users = sources.filter(({ text }) => USES_SLOT.test(text)).map(({ rel }) => rel);
  const allowed = Object.values(AD_PLACEMENTS).map((p) => p.page);

  it("only the designated pages use <AdSlot>", () => {
    expect(users.filter((rel) => rel !== "src/components/ads/AdSlot.tsx").sort()).toEqual(
      [...allowed].sort(),
    );
  });

  it("each designated page shows only its own slot", () => {
    for (const [slot, placement] of Object.entries(AD_PLACEMENTS)) {
      const text = sources.find((s) => s.rel === placement.page)?.text ?? "";
      const slots = [...text.matchAll(/<AdSlot\s+slot="([A-Z_]+)"/g)].map((m) => m[1]);
      expect(slots, placement.page).toEqual([slot]);
    }
  });

  it.each(AD_FORBIDDEN_AREAS)("no ad anywhere in %s", (area) => {
    const offenders = sources.filter(
      ({ rel, text }) =>
        rel.startsWith(area) &&
        (USES_SLOT.test(text) || /data-testid="ad-slot"/.test(text)),
    );
    expect(offenders.map((o) => o.rel)).toEqual([]);
  });

  it("no designated page is in a forbidden area", () => {
    for (const page of allowed) {
      expect(
        AD_FORBIDDEN_AREAS.some((area) => page.startsWith(area)),
        page,
      ).toBe(false);
    }
  });

  it("labels the slot Sponsored, uses rel=sponsored, and loads nothing third-party", () => {
    const slot =
      sources.find((s) => s.rel === "src/components/ads/AdSlot.tsx")?.text ?? "";
    expect(slot).toMatch(/>\s*Sponsored\s*</);
    expect(slot).toContain('rel="sponsored noopener noreferrer"');
    expect(slot).not.toMatch(/<script|dangerouslySetInnerHTML|window\.open|https?:\/\//);
    expect(slot).toContain("isAdPlacement(slot)");
  });

  it("knows only the designated slots", () => {
    expect(isAdPlacement("HOME_PARTNERS")).toBe(true);
    expect(isAdPlacement("SEARCH_RESULTS")).toBe(false);
    expect(isAdPlacement("constructor")).toBe(false);
  });
});

describe("checkDestinationUrl", () => {
  it.each([
    ["https://surveyors.example.co.uk/offer", true],
    ["https://www.insurer.example/", true],
    ["http://insecure.example", false],
    ["javascript:alert(1)", false],
    ["https://user:pass@site.example", false],
    ["https://bit.ly/abc", false],
    ["https://x.tinyurl.com/abc", false],
    ["https://192.168.0.1/", false],
    ["https://localhost/", false],
    ["https://site.example:8443/", false],
    ["not a url", false],
  ])("%s → %s", (url, ok) => {
    expect(checkDestinationUrl(url).ok).toBe(ok);
  });
});
