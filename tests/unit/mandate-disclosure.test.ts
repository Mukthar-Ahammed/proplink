import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    profile: { findUnique: vi.fn() },
    mandate: { findFirst: vi.fn() },
    mandateDisclosure: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));
vi.mock("@/services/admin/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/services/agents/companyGate", () => ({ agentCompanyGate: vi.fn() }));
// OD-27: these Agents are authorised (the gate itself is tested in agent-migration tests).
vi.mock("@/services/agents/agentMigration", () => ({
  hasNewFeatureAccess: async () => true,
}));
vi.mock("@/services/auth/supabaseAuthService", () => ({ consumeRateLimits: vi.fn() }));
vi.mock("@/services/notifications/preferences", () => ({ shouldNotify: vi.fn() }));
vi.mock("@/services/uploads/pipeline", () => ({ createGrantedDownloadLink: vi.fn() }));
vi.mock("@/services/email/mailer", () => ({}));

import { Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { writeAudit } from "@/services/admin/audit";
import { agentCompanyGate } from "@/services/agents/companyGate";
import { consumeRateLimits } from "@/services/auth/supabaseAuthService";
import {
  buildInvestorView,
  DISCLOSURE_DEFAULTS,
  DISCLOSURE_FIELDS,
  disclosureFor,
  parseDisclosure,
  updateDisclosure,
  type DisclosableListing,
} from "@/services/landlord/disclosure";

const mockDb = vi.mocked(db, true);
const AGENT = {
  profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  legacyUserId: "agent-1",
  role: Role.AGENT,
};
const MANDATE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const LISTING: DisclosableListing = {
  city: "Leeds",
  postcode: "LS6 2AB",
  addressLine1: "1 Hidden Lane",
  propertyKind: "PROPERTY",
  propertyType: "terraced house",
  landAreaSqm: null,
  desiredOutcome: "REFURBISHMENT",
  description: "A three-bedroom terrace.",
  defects: "Damp at the back.",
  requiredWork: "New roof.",
  landlordName: "Jane Owner",
  files: [
    { fileId: "photo-1", kind: "PHOTO" },
    { fileId: "survey-1", kind: "DOCUMENT" },
    { fileId: "title-1", kind: "OWNERSHIP_DOCUMENT" },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(consumeRateLimits).mockResolvedValue(true);
  vi.mocked(agentCompanyGate).mockResolvedValue({ allowed: true, reason: "verified" });
  mockDb.profile.findUnique.mockResolvedValue({
    active: true,
    role: Role.AGENT,
    legacyUserId: AGENT.legacyUserId,
  } as never);
});

describe("investor view (AG-7)", () => {
  it("hides the Landlord's personal details by default", () => {
    const view = buildInvestorView(LISTING, DISCLOSURE_DEFAULTS);
    expect(view).toMatchObject({
      landlordName: null,
      addressLine1: null,
      postcode: null,
      postcodeDistrict: "LS6",
      city: "Leeds",
      description: "A three-bedroom terrace.",
      photoFileIds: ["photo-1"],
      documentFileIds: [],
    });
    const text = JSON.stringify(view);
    for (const secret of [
      "Jane Owner",
      "1 Hidden Lane",
      "LS6 2AB",
      "title-1",
      "survey-1",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("never exposes ownership documents or the Landlord's own title, whatever is ticked", () => {
    const everything = Object.fromEntries(
      DISCLOSURE_FIELDS.map((f) => [f.key, true]),
    ) as typeof DISCLOSURE_DEFAULTS;
    const view = buildInvestorView(LISTING, everything);
    expect(view).toMatchObject({
      landlordName: "Jane Owner",
      addressLine1: "1 Hidden Lane",
      postcode: "LS6 2AB",
    });
    expect(view.documentFileIds).toEqual(["survey-1"]);
    expect(JSON.stringify(view)).not.toContain("title-1");
    expect(view).not.toHaveProperty("title");
    expect(view).not.toHaveProperty("email");
  });

  it("hides everything optional when nothing is ticked", () => {
    const view = buildInvestorView(LISTING, parseDisclosure({}));
    expect(view).toMatchObject({
      description: null,
      defects: null,
      requiredWork: null,
      photoFileIds: [],
    });
  });

  it("reads checkboxes strictly", () => {
    expect(
      parseDisclosure({
        showLandlordName: "on",
        showPhotos: "true",
        showDefects: "yes",
        unknown: "on",
      }),
    ).toEqual({
      ...Object.fromEntries(DISCLOSURE_FIELDS.map((f) => [f.key, false])),
      showLandlordName: true,
      showPhotos: true,
    });
  });

  it("falls back to the safe defaults when nothing is stored", async () => {
    mockDb.mandateDisclosure.findUnique.mockResolvedValue(null);
    expect(await disclosureFor(MANDATE)).toEqual(DISCLOSURE_DEFAULTS);
  });
});

describe("updating the disclosure", () => {
  it("is limited, needs a verified Agent and their own active mandate", async () => {
    vi.mocked(consumeRateLimits).mockResolvedValueOnce(false);
    expect(await updateDisclosure(AGENT, MANDATE, {})).toMatchObject({
      ok: false,
      status: 429,
    });
    vi.mocked(agentCompanyGate).mockResolvedValueOnce({
      allowed: false,
      status: "NEEDS_REVIEW",
    });
    expect(await updateDisclosure(AGENT, MANDATE, {})).toMatchObject({
      ok: false,
      status: 403,
    });
    mockDb.mandate.findFirst.mockResolvedValue(null);
    expect(await updateDisclosure(AGENT, MANDATE, {})).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(mockDb.mandate.findFirst.mock.calls[0][0]?.where).toEqual({
      id: MANDATE,
      agentId: AGENT.profileId,
      status: "ACTIVE",
    });
    expect(mockDb.mandateDisclosure.upsert).not.toHaveBeenCalled();
  });

  it("saves the choice and audits what changed", async () => {
    mockDb.mandate.findFirst.mockResolvedValue({ id: MANDATE } as never);
    mockDb.mandateDisclosure.findUnique.mockResolvedValue(null);
    const raw = {
      showLandlordName: "on",
      showDescription: "on",
      showDefects: "on",
      showRequiredWork: "on",
      showPhotos: "on",
    };
    expect(await updateDisclosure(AGENT, MANDATE, raw)).toEqual({ ok: true });
    expect(mockDb.mandateDisclosure.upsert.mock.calls[0][0].create).toMatchObject({
      mandateId: MANDATE,
      showLandlordName: true,
      showStreetAddress: false,
      updatedBy: AGENT.profileId,
    });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "MANDATE_DISCLOSURE_UPDATED",
        meta: expect.objectContaining({ changed: ["showLandlordName"] }),
      }),
    );
  });
});
