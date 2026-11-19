export const FIXTURE_DATA_VERSION = 1;

export const FIXTURE_DATA_PLAN = Object.freeze({
  profiles: { order: 1, ownerRole: "each", table: "profiles" },
  users: { order: 2, ownerRole: "each", table: "User" },
  properties: { order: 3, ownerRole: "AGENT", table: "Property" },
  enquiries: { order: 4, ownerRole: "BUYER", table: "Enquiry", parent: "properties" },
  savedProperties: {
    order: 5,
    ownerRole: "BUYER",
    table: "SavedProperty",
    parent: "properties",
  },
  offers: { order: 6, ownerRole: "BUYER", table: "Offer", parent: "properties" },
  viewings: { order: 7, ownerRole: "BUYER", table: "properties", parent: "properties" },
  pledges: { order: 8, ownerRole: "INVESTOR", table: "SyndicatePledge" },
  chat: { order: 9, ownerRole: "BUYER", table: "ChatMessage", parent: "properties" },
  storage: {
    order: 10,
    ownerRole: "AGENT",
    buckets: ["kyc-documents", "property-images"],
  },
});

export function validateFixtureManifest(manifest, projectRef) {
  if (
    !manifest ||
    manifest.version !== FIXTURE_DATA_VERSION ||
    manifest.projectRef !== projectRef
  )
    throw new Error("Invalid fixture manifest");
  if (!manifest.resources || !Array.isArray(manifest.resources))
    throw new Error("Fixture manifest resources missing");
  for (const resource of manifest.resources) {
    if (
      !resource.kind ||
      !resource.id ||
      !resource.ownerId ||
      !resource.disposableMarker?.startsWith("phase3-test-")
    )
      throw new Error("Invalid or non-disposable fixture resource");
  }
  return manifest;
}

export async function provisionFixtureData({
  projectRef,
  manifest,
  identities,
  db,
  storage,
  ledger = undefined,
}) {
  const next = validateFixtureManifest(manifest, projectRef);
  for (const role of ["AGENT", "INVESTOR", "BUYER", "ADMIN"])
    if (!identities?.[role]?.authUserId)
      throw new Error(`Missing verified identity ${role}`);
  const created = [];
  for (const kind of Object.keys(FIXTURE_DATA_PLAN).sort(
    (a, b) => FIXTURE_DATA_PLAN[a].order - FIXTURE_DATA_PLAN[b].order,
  )) {
    const descriptor = FIXTURE_DATA_PLAN[kind];
    if (descriptor.buckets) {
      for (const bucket of descriptor.buckets) {
        const existing = next.resources.find((r) => r.kind === `storage:${bucket}`);
        if (existing) continue;
        const owner = identities[descriptor.ownerRole];
        const path = `phase3-test-${owner.authUserId}/${bucket}.bin`;
        const result = await storage.ensureObject(bucket, path, owner.authUserId);
        if (!result?.id) throw new Error(`Storage fixture failed: ${bucket}`);
        next.resources.push({
          kind: `storage:${bucket}`,
          id: result.id,
          path,
          ownerId: owner.authUserId,
          disposableMarker: `phase3-test-${owner.authUserId}`,
        });
        created.push(result.id);
        continue;
      }
      continue;
    }
    const existing = next.resources.find((r) => r.kind === kind);
    if (existing) continue;
    const ownerRole = descriptor.ownerRole === "each" ? "AGENT" : descriptor.ownerRole;
    const planned = {
      key: `db:${kind}`,
      kind,
      model: kind,
      projectRef,
      ownerId: identities[ownerRole].legacyUserId,
      disposableMarker: `phase3-test-${identities[ownerRole].legacyUserId}`,
      state: "PLANNED",
    };
    if (ledger) await ledger.put(planned);
    const result = await db.ensureRecord(kind, identities[ownerRole], next.resources);
    if (!result?.id) throw new Error(`Database fixture failed: ${kind}`);
    next.resources.push({
      kind,
      id: result.id,
      ownerId: result.ownerId,
      disposableMarker: `phase3-test-${result.ownerId}`,
    });
    if (ledger) await ledger.put({ ...planned, id: result.id, state: "VERIFIED" });
    created.push(result.id);
  }
  return { manifest: next, created };
}

export function buildFixturePayloads(identities) {
  const id = (role) => identities[role]?.legacyUserId;
  if (!id("AGENT") || !id("BUYER") || !id("INVESTOR"))
    throw new Error("Verified legacy identity mappings are required");
  return {
    properties: {
      ownerRole: "AGENT",
      payload: {
        title: "Phase 3 disposable property",
        description: "phase3-test fixture",
        status: "PUBLISHED",
      },
    },
    enquiries: { ownerRole: "BUYER", payload: { message: "phase3-test enquiry" } },
    savedProperties: { ownerRole: "BUYER", payload: {} },
    offers: { ownerRole: "BUYER", payload: { amountGBP: 1, status: "PENDING" } },
    viewings: { ownerRole: "BUYER", payload: { status: "REQUESTED" } },
    pledges: { ownerRole: "INVESTOR", payload: { amountGBP: 1, status: "PENDING" } },
    chat: { ownerRole: "BUYER", payload: { body: "phase3-test message" } },
  };
}

export function buildCleanupOrder(resources) {
  const order = Object.fromEntries(
    Object.entries(FIXTURE_DATA_PLAN).map(([k, v]) => [k, v.order]),
  );
  return [...resources].sort(
    (a, b) =>
      (order[b.kind] ?? order[b.kind?.split(":")[0]] ?? 0) -
      (order[a.kind] ?? order[a.kind?.split(":")[0]] ?? 0),
  );
}

export function buildPrismaFixturePayloads({ ids }) {
  for (const key of ["agentUserId", "buyerUserId", "investorUserId"])
    if (!ids?.[key]) throw new Error(`Missing required fixture id: ${key}`);
  if (!ids.propertyId || !ids.projectId)
    throw new Error("Property and syndicate project IDs are required");
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    Property: {
      id: ids.propertyId,
      listingSource: "AGENT",
      title: "Phase 3 disposable property",
      description: "Disposable RLS fixture",
      status: "DRAFT",
      addressLine1: "1 Phase 3 Way",
      city: "London",
      region: "Greater London",
      postcode: "SW1A 1AA",
      propertyType: "RESIDENTIAL",
      bedrooms: 2,
      askingPriceGBP: 100000,
    },
    SyndicateProject: {
      id: ids.projectId,
      propertyId: ids.propertyId,
      name: "Phase 3 disposable syndicate",
      capitalTargetGBP: 1000,
      status: "OPEN",
      createdAt: now,
    },
    Enquiry: {
      id: ids.enquiryId,
      propertyId: ids.propertyId,
      fromUserId: ids.buyerUserId,
      message: "Phase 3 disposable enquiry",
      status: "NEW",
      createdAt: now,
    },
    SavedProperty: { userId: ids.buyerUserId, propertyId: ids.propertyId },
    Offer: {
      id: ids.offerId,
      propertyId: ids.propertyId,
      buyerUserId: ids.buyerUserId,
      amountGBP: 90000,
      status: "SUBMITTED",
      createdAt: now,
    },
    Viewing: {
      id: ids.viewingId,
      propertyId: ids.propertyId,
      buyerUserId: ids.buyerUserId,
      slotStart: now,
      slotEnd: new Date(now.getTime() + 3600000),
      status: "REQUESTED",
    },
    ChatMessage: {
      id: ids.chatId,
      propertyId: ids.propertyId,
      fromUserId: ids.buyerUserId,
      toUserId: ids.agentUserId,
      body: "Phase 3 disposable message",
      createdAt: now,
    },
    SyndicatePledge: {
      id: ids.pledgeId,
      projectId: ids.projectId,
      investorUserId: ids.investorUserId,
      amountGBP: 100,
      status: "PLEDGED",
      createdAt: now,
    },
  };
}

export function resolveLedgerParentIds(resources) {
  const verified = new Map(
    resources.filter((r) => r.state === "VERIFIED" && r.id).map((r) => [r.kind, r.id]),
  );
  const propertyId = verified.get("Property");
  const projectId = verified.get("SyndicateProject");
  if (!propertyId || !projectId)
    throw new Error("Verified parent IDs are missing from fixture ledger");
  return { propertyId, projectId };
}

export async function cleanupFixtureData({
  projectRef,
  manifest,
  db,
  storage,
  dryRun = true,
}) {
  validateFixtureManifest(manifest, projectRef);
  const plan = buildCleanupOrder(manifest.resources);
  if (dryRun) return { dryRun: true, plan };
  const deleted = [];
  for (const resource of plan) {
    const result = resource.kind.startsWith("storage:")
      ? await storage.deleteOwned(resource.kind.slice(9), resource.path, resource.ownerId)
      : await db.deleteOwned(resource.kind, resource.id, resource.ownerId);
    if (!result?.ok) throw new Error(`Cleanup stopped at ${resource.kind}`);
    deleted.push(resource.id);
  }
  return { dryRun: false, deleted };
}

export async function provisionDependentWithLedger({
  projectRef,
  manifest,
  ledger,
  db,
  payloads,
  identities,
}) {
  validateFixtureManifest(manifest, projectRef);
  const resources = [
    "Property",
    "SyndicateProject",
    "Enquiry",
    "SavedProperty",
    "Offer",
    "Viewing",
    "ChatMessage",
    "SyndicatePledge",
  ];
  const result = { ...manifest, resources: [...manifest.resources] };
  for (const model of resources) {
    const key = `db:${model}`;
    const intended = payloads[model];
    if (!intended) throw new Error(`Missing payload for ${model}`);
    const ownerRole =
      model === "SyndicatePledge"
        ? "INVESTOR"
        : model === "Property" || model === "SyndicateProject"
          ? "AGENT"
          : "BUYER";
    const owner = identities[ownerRole];
    const existing = result.resources.find((r) => r.key === key);
    if (existing?.state === "VERIFIED") continue;
    if (existing?.state === "NEEDS_RECONCILIATION" || existing?.state === "PLANNED") {
      if (existing.id && typeof db.reconcileRecord === "function") {
        const reconciliation = await db.reconcileRecord(
          model,
          identities[
            model === "SyndicatePledge"
              ? "INVESTOR"
              : model === "Property" || model === "SyndicateProject"
                ? "AGENT"
                : "BUYER"
          ],
          existing,
        );
        if (reconciliation.status === "VERIFIED") {
          await ledger.put({ ...existing, state: "VERIFIED" });
          continue;
        }
        if (
          existing.state === "NEEDS_RECONCILIATION" &&
          reconciliation.status !== "MISSING"
        )
          throw new Error(`${model} reconciliation=${reconciliation.status}`);
      } else if (existing.state === "NEEDS_RECONCILIATION")
        throw new Error(`${model} requires reconciliation`);
    }
    const planned = {
      key,
      kind: model,
      model,
      projectRef,
      ownerId: owner.legacyUserId,
      parentRefs: intended,
      disposableMarker: `phase3-test-${owner.legacyUserId}`,
      state: "PLANNED",
    };
    await ledger.put(planned);
    result.resources.push(planned);
    try {
      const created = await db.ensureRecord(model, owner, intended);
      if (!created?.id) throw new Error(`${model} was not verified after insert`);
      const verified = { ...planned, id: created.id, state: "VERIFIED" };
      await ledger.put(verified);
      const index = result.resources.findIndex((r) => r.key === key);
      result.resources[index] = verified;
    } catch (error) {
      const state = error?.uncertain ? "NEEDS_RECONCILIATION" : "FAILED";
      await ledger.put({ ...planned, state, errorCode: error?.code });
      throw error;
    }
  }
  return result;
}
