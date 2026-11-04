import pg from "pg";

export function createOwnershipRegistryAdapter({ connectionString, clientFactory } = {}) {
  const make = clientFactory ?? (() => new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } }));
  return {
    async recordPlanned(tx, entry) {
      if (!entry?.projectRef || !entry.runId || !entry.resourceType || !entry.resourceKey) throw new Error("Incomplete registry intent");
      await tx.query(`INSERT INTO private.phase3_fixture_resources (project_ref,run_id,resource_type,resource_key,resource_id,owner_auth_user_id,owner_legacy_user_id,parent_refs,state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PLANNED')`, [entry.projectRef, entry.runId, entry.resourceType, entry.resourceKey, entry.resourceId, entry.ownerAuthUserId, entry.ownerLegacyUserId, entry.parentRefs ?? {}]);
    },
    async reconcile(entry, verifyBusinessRecord) {
      const client = make(); await client.connect();
      try {
        const found = await client.query(`SELECT * FROM private.phase3_fixture_resources WHERE project_ref=$1 AND resource_type=$2 AND resource_id=$3`, [entry.projectRef, entry.resourceType, entry.resourceId]);
        if (found.rows.length !== 1 || found.rows[0].state !== "VERIFIED") return { status: "INCOMPLETE" };
        const row = found.rows[0];
        if (row.run_id !== entry.runId || row.owner_legacy_user_id !== entry.ownerLegacyUserId) return { status: "CONFLICT" };
        if (!(await verifyBusinessRecord(row))) return { status: "CONFLICT" };
        return { status: "VERIFIED" };
      } finally { await client.end(); }
    },
    async authorizeCleanup(entry, verifyBusinessRecord) {
      const result = await this.reconcile(entry, verifyBusinessRecord);
      if (result.status !== "VERIFIED") throw new Error("Cleanup authorization rejected");
      return true;
    },
  };
}
