import { assertDisposable } from "./phase3-ledger.mjs";
import crypto from "node:crypto";

export const STATES = Object.freeze({ PLANNED: "PLANNED", AUTH_CREATED: "AUTH_CREATED", DATABASE_MAPPED: "DATABASE_MAPPED", READY: "READY", FAILED: "FAILED", NEEDS_RECONCILIATION: "NEEDS_RECONCILIATION" });

export async function provisionOne({ fixture, auth, database, ledger, projectRef }) {
  assertDisposable({ ...fixture, projectRef });
  let entry = await ledger.get(fixture.role);
  if (entry?.state === STATES.READY) return entry;
  if (!entry) { entry = { role: fixture.role, email: fixture.email, projectRef, marker: fixture.marker ?? `phase3-${crypto.randomUUID()}`, state: STATES.PLANNED }; await ledger.put(entry); }
  if (entry.email !== fixture.email || entry.projectRef !== projectRef) throw new Error("Ledger ownership mismatch");
  try {
    let authUserId = entry.authUserId;
    if (!authUserId) {
      const discovered = await auth.discover(entry.marker, fixture.email);
      if (discovered.length > 1) throw new Error("Ambiguous Auth discovery; reconciliation required");
      if (discovered.length === 1) { authUserId = discovered[0].id; await ledger.put({ ...entry, authUserId, state: STATES.AUTH_CREATED }); }
      else {
      const created = await auth.createUser({ email: fixture.email, password: fixture.password, email_confirm: true, app_metadata: { phase3_disposable: true, proplink_fixture_marker: entry.marker } });
      authUserId = created.id;
      await ledger.put({ ...entry, authUserId, state: STATES.AUTH_CREATED });
      }
    } else {
      const verified = await auth.getUser(authUserId);
      if (!verified || verified.email !== fixture.email) throw new Error("Auth ownership verification failed");
    }
    entry = { ...entry, authUserId, state: STATES.AUTH_CREATED }; await ledger.put(entry);
    const mapped = entry.legacyUserId ? await database.verify(authUserId, entry.legacyUserId, fixture.role) : await database.provision({ authUserId, email: fixture.email, name: fixture.name, role: fixture.role });
    await ledger.put({ ...entry, legacyUserId: mapped.legacyUserId, state: STATES.DATABASE_MAPPED });
    const verified = await database.verify(authUserId, mapped.legacyUserId, fixture.role);
    if (!verified) throw new Error("Database identity verification failed");
    const ready = { ...entry, legacyUserId: mapped.legacyUserId, state: STATES.READY }; await ledger.put(ready); return ready;
  } catch (error) {
    const state = entry.authUserId && !entry.legacyUserId ? STATES.NEEDS_RECONCILIATION : (error?.uncertain || error?.code === "AUTH_CREATE_UNCERTAIN" ? STATES.NEEDS_RECONCILIATION : STATES.FAILED);
    await ledger.put({ ...entry, state, error: String(error.message ?? "failure").slice(0, 200) });
    throw error;
  }
}
