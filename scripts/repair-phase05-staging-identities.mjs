import { createHash } from "node:crypto";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "DIRECT_URL",
  "PHASE2_TEST_EMAIL",
  "PHASE2_OTHER_USER_ID",
];
for (const name of required) {
  if (!process.env[name])
    throw new Error(`Missing required environment variable: ${name}`);
}

const apply = process.argv.includes("--apply");
const stagingConfirmed = process.argv.includes("--confirm-staging");
if (apply && !stagingConfirmed) {
  throw new Error("Applying requires --confirm-staging");
}

const appOrigin = new URL(
  process.env.APP_ORIGIN ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000",
);
if (!["localhost", "127.0.0.1"].includes(appOrigin.hostname)) {
  throw new Error(
    "Staging guard failed: Phase 0.5 repair requires the local staging origin",
  );
}

const projectUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
const databaseUrl = new URL(process.env.DIRECT_URL);
const apiRef = projectUrl.hostname.endsWith(".supabase.co")
  ? projectUrl.hostname.split(".")[0]
  : undefined;
const databaseUsername = decodeURIComponent(databaseUrl.username);
const databaseRef = databaseUsername.startsWith("postgres.")
  ? databaseUsername.slice("postgres.".length)
  : databaseUrl.hostname.startsWith("db.")
    ? databaseUrl.hostname.split(".")[1]
    : undefined;
if (!apiRef || apiRef !== databaseRef) {
  throw new Error("Staging guard failed: API and database project refs do not match");
}

const fingerprint = (value) =>
  createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
const legacyIdFor = (authUserId) => `phase05_${authUserId.replaceAll("-", "")}`;
const auditIdFor = (authUserId) => `phase05audit_${authUserId.replaceAll("-", "")}`;

const database = new pg.Client({ connectionString: process.env.DIRECT_URL });
await database.connect();

try {
  await database.query("BEGIN ISOLATION LEVEL SERIALIZABLE");

  const targetResult = await database.query(
    `SELECT CASE WHEN lower(a.email) = lower($1)
                   THEN 'phase2_primary'
                   ELSE 'phase2_other'
                 END AS label,
            p.*, a.email, a.email_confirmed_at,
            a.created_at AS auth_created_at
       FROM auth.users AS a
       JOIN public.profiles AS p ON p.id = a.id
      WHERE lower(a.email) = lower($1) OR a.id = $2::uuid
     ORDER BY label
     FOR UPDATE OF p, a`,
    [process.env.PHASE2_TEST_EMAIL, process.env.PHASE2_OTHER_USER_ID],
  );

  const targets = targetResult.rows;
  if (targets.length !== 2 || new Set(targets.map((row) => row.id)).size !== 2) {
    throw new Error("Expected exactly two distinct configured Phase 2 staging profiles");
  }

  for (const target of targets) {
    if (!target.email_confirmed_at)
      throw new Error(`${target.label}: auth email is unconfirmed`);
    if (!target.active || target.role !== "BUYER" || target.kycStatus !== "NOT_STARTED") {
      throw new Error(`${target.label}: profile security state changed since the audit`);
    }

    await database.query(`SELECT pg_advisory_xact_lock(hashtextextended(lower($1), 0))`, [
      target.email,
    ]);

    const expectedLegacyId = legacyIdFor(target.id);
    const collision = await database.query(
      `SELECT id, email, role::text AS role, active, "kycStatus"::text AS "kycStatus"
         FROM public."User"
        WHERE id = $1 OR lower(email) = lower($2)
        FOR UPDATE`,
      [expectedLegacyId, target.email],
    );

    if (target.legacyUserId) {
      if (target.legacyUserId !== expectedLegacyId || collision.rows.length !== 1) {
        throw new Error(`${target.label}: profile is mapped outside this repair`);
      }
      const existing = collision.rows[0];
      if (
        existing.email.toLowerCase() !== target.email.toLowerCase() ||
        existing.role !== target.role ||
        existing.active !== target.active ||
        existing.kycStatus !== target.kycStatus
      ) {
        throw new Error(`${target.label}: existing repair mapping is inconsistent`);
      }
      console.log(
        `${target.label}=ALREADY_REPAIRED profile=${fingerprint(target.id)} legacy=${fingerprint(expectedLegacyId)}`,
      );
      continue;
    }

    if (collision.rows.length > 0) {
      throw new Error(`${target.label}: legacy ID or email collision detected`);
    }

    const relatedStorage = await database.query(
      `SELECT count(*)::int AS count
         FROM storage.objects
        WHERE name = $1 OR name LIKE $1 || '/%'`,
      [target.id],
    );
    if (relatedStorage.rows[0].count !== 0) {
      throw new Error(`${target.label}: unexpected Storage data exists`);
    }

    await database.query(
      `INSERT INTO public."User"
         (id, email, "passwordHash", name, role, "emailVerified", "kycStatus",
          "complianceCode", "avatarUrl", "gdprConsentAt", active, "createdAt")
       VALUES
         ($1, lower($2), NULL, $3, $4::public."Role", $5,
          $6::public."KycStatus", $7, $8, $9, $10, now())`,
      [
        expectedLegacyId,
        target.email,
        target.name ?? target.email,
        target.role,
        target.email_confirmed_at,
        target.kycStatus,
        target.complianceCode,
        target.avatarUrl,
        target.gdprConsentAt,
        target.active,
      ],
    );
    await database.query(
      `UPDATE public.profiles
          SET "legacyUserId" = $1, "updatedAt" = now()
        WHERE id = $2::uuid AND "legacyUserId" IS NULL`,
      [expectedLegacyId, target.id],
    );
    await database.query(
      `INSERT INTO public."AuditLog"
         (id, "actorUserId", action, entity, "entityId", "metaJson", "createdAt")
       VALUES ($1, $2, 'IDENTITY_MAPPING_REPAIRED', 'Profile', $3,
               $4::jsonb, now())
       ON CONFLICT (id) DO NOTHING`,
      [
        auditIdFor(target.id),
        expectedLegacyId,
        target.id,
        JSON.stringify({ source: "phase-0.5-staging-repair" }),
      ],
    );

    console.log(
      `${target.label}=${apply ? "REPAIRED" : "WOULD_REPAIR"} profile=${fingerprint(target.id)} legacy=${fingerprint(expectedLegacyId)}`,
    );
  }

  await database.query("SET CONSTRAINTS ALL IMMEDIATE");
  if (apply) {
    await database.query("COMMIT");
    console.log("phase05_staging_repair=APPLIED targets=2");
  } else {
    await database.query("ROLLBACK");
    console.log("phase05_staging_repair=DRY_RUN_ROLLED_BACK targets=2");
  }
} catch (error) {
  await database.query("ROLLBACK").catch(() => {});
  console.error(
    `phase05_staging_repair=FAIL ${error instanceof Error ? error.message : "unknown"}`,
  );
  process.exitCode = 1;
} finally {
  await database.end();
}
