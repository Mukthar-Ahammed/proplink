import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function validateHistory(rows, repositoryMigrations, root, expectedApplied) {
  const active = rows.filter((row) => !row.rolled_back_at);
  if (rows.some((row) => !row.finished_at && !row.rolled_back_at)) throw new Error("Migration history contains an unresolved failed migration");
  if (active.length !== expectedApplied) throw new Error(`Expected ${expectedApplied} applied migrations, found ${active.length}`);
  if (active.some((row, i) => row.migration_name !== repositoryMigrations[i])) throw new Error("Applied migration order does not match repository");
  const activeNames = new Set();
  for (const row of active) {
    if (activeNames.has(row.migration_name)) throw new Error(`Duplicate active migration: ${row.migration_name}`);
    activeNames.add(row.migration_name);
    const sql = fs.readFileSync(path.join(root, "prisma", "migrations", row.migration_name, "migration.sql"));
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    if (checksum !== row.checksum) throw new Error(`Checksum mismatch for ${row.migration_name}`);
  }
  return active;
}
