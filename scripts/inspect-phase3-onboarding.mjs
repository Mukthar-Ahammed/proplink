import fs from "node:fs";
import dotenv from "dotenv";
import pg from "pg";
import { assertConfiguredSupabaseProject } from "./lib/supabase-project-guard.mjs";

const expectedProjectRef = "onhdlxxbdcfwujhtphaj";
const loadedEnv = {
  ...dotenv.parse(fs.readFileSync(".env.local")),
  ...process.env,
};
if (loadedEnv.PROPLINK_ENV && loadedEnv.PROPLINK_ENV !== "development") {
  throw new Error("Refusing inspection: PROPLINK_ENV must be development.");
}
const runtimeEnv = {
  ...loadedEnv,
  PROPLINK_ENV: "development",
};
const originalLog = console.log;
let projectRef;
try {
  console.log = () => {};
  projectRef = assertConfiguredSupabaseProject(runtimeEnv);
} finally {
  console.log = originalLog;
}
if (projectRef !== expectedProjectRef) {
  throw new Error("Refusing inspection: unexpected development project.");
}
const databaseUrl = runtimeEnv.DIRECT_URL ?? runtimeEnv.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DIRECT_URL or DATABASE_URL must identify the development database.");
}

const migrationPath =
  "prisma/migrations/20261007050000_phase3_investor_onboarding/migration.sql";
const migration = fs.readFileSync(migrationPath, "utf8");
const functionBody = migration.match(/AS \$\$(.*?)\$\$;/s)?.[1];
if (!functionBody) {
  throw new Error("Could not extract expected function body from migration.");
}
const normalizeSql = (sql) => sql.replace(/\s+/g, " ").trim();
const normalizeConstraint = (sql) =>
  sql
    .toLowerCase()
    .replace(/public\./g, "")
    .replace(/["\s()]/g, "");

const migrationNames = [
  "20261007060000_phase4_kyc_submission",
  "20261007070000_phase5_admin_kyc",
  "20261007080000_phase6_flipper_acquisition",
  "20261007090000_phase7_flipper_project",
  "20261007100000_phase8_flipper_resale",
  "20261007110000_phase8_publication_remediation",
  "20261009120000_phase3_fixture_ownership_registry",
  "20261104000000_phase0_agent_invite_only",
  "20261104010000_phase0_append_only_audit",
];

const unquote = (identifier) => identifier.replace(/^"|"$/g, "");

// Mirrors PostgreSQL's ChooseIndexNameAddition (indexcmds.c): column names
// joined with "_", capped at NAMEDATALEN - 1 (63) characters. ASCII names only.
const indexNameAddition = (columns) => {
  let addition = "";
  for (const column of columns) {
    if (addition.length > 0) addition += "_";
    addition += column;
    if (addition.length >= 63) return addition.slice(0, 63);
  }
  return addition;
};

// Mirrors PostgreSQL's makeObjectName: when "name1_name2_label" exceeds 63
// characters, the longer of name1/name2 is shortened one character at a time,
// so the label suffix (e.g. "_key", "_check") always survives.
const postgresObjectName = (name1, name2, label) => {
  const overhead = (name2 ? 1 : 0) + (label ? label.length + 1 : 0);
  const available = 63 - overhead;
  let name1Chars = name1.length;
  let name2Chars = name2 ? name2.length : 0;
  while (name1Chars + name2Chars > available) {
    if (name1Chars > name2Chars) name1Chars -= 1;
    else name2Chars -= 1;
  }
  let result = name1.slice(0, name1Chars);
  if (name2) result += `_${name2.slice(0, name2Chars)}`;
  if (label) result += `_${label}`;
  return result;
};
const identifier = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)`;
const ignoredTableDefinitionWords = new Set([
  "CHECK",
  "CONSTRAINT",
  "EXCLUDE",
  "FOREIGN",
  "ON",
  "PRIMARY",
  "UNIQUE",
]);
const expectedObjects = new Map();
const addObject = (kind, schema, table, name, label) => {
  const key = [kind, schema ?? "", table ?? "", name ?? ""].join("|");
  expectedObjects.set(key, {
    kind,
    schema_name: schema ?? null,
    table_name: table ?? null,
    object_name: name ?? null,
    label,
  });
};
const tableLabel = (schema, table) => `${schema}."${table}"`;

for (const migrationName of migrationNames) {
  const sql = fs.readFileSync(`prisma/migrations/${migrationName}/migration.sql`, "utf8");

  for (const match of sql.matchAll(/CREATE SCHEMA IF NOT EXISTS\s+([\w"]+)/gi)) {
    const schema = unquote(match[1]);
    addObject("schema", schema, null, null, `schema ${schema}`);
  }

  for (const match of sql.matchAll(
    new RegExp(`CREATE TYPE\\s+(${identifier})\\.(${identifier})\\s+AS\\s+ENUM`, "gi"),
  )) {
    const schema = unquote(match[1]);
    const name = unquote(match[2]);
    addObject("enum", schema, null, name, `${schema}."${name}" enum`);
  }

  const tablePattern = new RegExp(
    `CREATE TABLE(?: IF NOT EXISTS)?\\s+(${identifier})\\.(${identifier})\\s*\\(([\\s\\S]*?)\\n\\);`,
    "gi",
  );
  for (const match of sql.matchAll(tablePattern)) {
    const schema = unquote(match[1]);
    const table = unquote(match[2]);
    const definition = match[3];
    addObject("table", schema, null, table, `table ${tableLabel(schema, table)}`);

    for (const column of definition.matchAll(
      /^\s*(?:"([^"]+)"|([A-Za-z_][\w$]*))\s+/gm,
    )) {
      const columnName = column[1] ?? column[2];
      if (ignoredTableDefinitionWords.has(columnName.toUpperCase())) continue;
      addObject(
        "column",
        schema,
        table,
        columnName,
        `column ${tableLabel(schema, table)}."${columnName}"`,
      );
    }
    for (const constraint of definition.matchAll(/CONSTRAINT\s+"([^"]+)"/gi)) {
      addObject(
        "constraint",
        schema,
        table,
        constraint[1],
        `constraint ${tableLabel(schema, table)}."${constraint[1]}"`,
      );
    }
    if (/^\s*(?:"id"|id)\s+[^,\n]+\bPRIMARY KEY\b/im.test(definition)) {
      addObject(
        "constraint",
        schema,
        table,
        `${table}_pkey`,
        `constraint ${tableLabel(schema, table)}."${table}_pkey"`,
      );
    }
    for (const inlineUnique of definition.matchAll(/^\s*UNIQUE\s*\(([^)]+)\)/gim)) {
      const columns = inlineUnique[1].split(",").map((column) => unquote(column.trim()));
      const generatedName = postgresObjectName(table, indexNameAddition(columns), "key");
      addObject(
        "constraint",
        schema,
        table,
        generatedName,
        `constraint ${tableLabel(schema, table)}."${generatedName}"`,
      );
    }
    const inlineCheck = definition.match(
      /^\s*(?:"([^"]+)"|([A-Za-z_][\w$]*))\s+[^,\n]*\bCHECK\s*\(/im,
    );
    if (inlineCheck) {
      const columnName = inlineCheck[1] ?? inlineCheck[2];
      const generatedName = postgresObjectName(table, columnName, "check");
      addObject(
        "constraint",
        schema,
        table,
        generatedName,
        `constraint ${tableLabel(schema, table)}."${generatedName}"`,
      );
    }
  }

  for (const match of sql.matchAll(
    new RegExp(`ALTER TABLE\\s+(${identifier})\\.(${identifier})([\\s\\S]*?);`, "gi"),
  )) {
    const schema = unquote(match[1]);
    const table = unquote(match[2]);
    const changes = match[3];
    for (const column of changes.matchAll(
      /ADD COLUMN(?: IF NOT EXISTS)?\s+"([^"]+)"/gi,
    )) {
      addObject(
        "column",
        schema,
        table,
        column[1],
        `column ${tableLabel(schema, table)}."${column[1]}"`,
      );
    }
    for (const constraint of changes.matchAll(/ADD CONSTRAINT\s+"([^"]+)"/gi)) {
      addObject(
        "constraint",
        schema,
        table,
        constraint[1],
        `constraint ${tableLabel(schema, table)}."${constraint[1]}"`,
      );
    }
  }

  for (const match of sql.matchAll(
    new RegExp(
      `CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(${identifier})\\s+ON\\s+(${identifier})\\.(${identifier})`,
      "gi",
    ),
  )) {
    const index = unquote(match[1]);
    const schema = unquote(match[2]);
    const table = unquote(match[3]);
    addObject(
      "index",
      schema,
      table,
      index,
      `index ${tableLabel(schema, table)}."${index}"`,
    );
  }

  for (const match of sql.matchAll(
    new RegExp(
      `CREATE POLICY\\s+(${identifier})\\s+ON\\s+(${identifier})\\.(${identifier})`,
      "gi",
    ),
  )) {
    const policy = unquote(match[1]);
    const schema = unquote(match[2]);
    const table = unquote(match[3]);
    addObject(
      "policy",
      schema,
      table,
      policy,
      `policy ${tableLabel(schema, table)}."${policy}"`,
    );
  }

  for (const match of sql.matchAll(
    new RegExp(
      `ALTER TABLE\\s+(${identifier})\\.(${identifier})\\s+ENABLE ROW LEVEL SECURITY`,
      "gi",
    ),
  )) {
    const schema = unquote(match[1]);
    const table = unquote(match[2]);
    addObject("rls", schema, null, table, `RLS ${tableLabel(schema, table)}`);
  }

  for (const match of sql.matchAll(
    new RegExp(
      `CREATE(?: OR REPLACE)? FUNCTION\\s+(${identifier})\\.(${identifier})\\s*\\(`,
      "gi",
    ),
  )) {
    const schema = unquote(match[1]);
    const functionName = unquote(match[2]);
    addObject(
      "function",
      schema,
      null,
      functionName,
      `function ${schema}."${functionName}"()`,
    );
  }

  for (const match of sql.matchAll(
    new RegExp(
      `CREATE TRIGGER\\s+(${identifier})[\\s\\S]*?\\s+ON\\s+(${identifier})\\.(${identifier})`,
      "gi",
    ),
  )) {
    const trigger = unquote(match[1]);
    const schema = unquote(match[2]);
    const table = unquote(match[3]);
    addObject(
      "trigger",
      schema,
      table,
      trigger,
      `trigger ${tableLabel(schema, table)}."${trigger}"`,
    );
  }

  for (const match of sql.matchAll(
    /INSERT INTO storage\.buckets[\s\S]*?VALUES\s*\(\s*'([^']+)'/gi,
  )) {
    addObject("bucket", "storage", null, match[1], `bucket storage."${match[1]}"`);
  }
}

const client = new pg.Client({
  connectionString: databaseUrl,
  options: "-c default_transaction_read_only=on",
});

try {
  await client.connect();
  await client.query("BEGIN READ ONLY");

  const column = await client.query(
    `SELECT EXISTS (
       SELECT 1
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_type t ON t.oid = a.atttypid
         JOIN pg_namespace tn ON tn.oid = t.typnamespace
        WHERE n.nspname = 'private'
          AND c.relname = 'auth_signup_intents'
          AND a.attname = 'investorType'
          AND tn.nspname = 'public'
          AND t.typname = 'InvestorType'
          AND a.attnum > 0
          AND NOT a.attisdropped
     ) AS present`,
  );
  console.log(
    `column private.auth_signup_intents."investorType": ${column.rows[0].present ? "PASS" : "FAIL"}`,
  );

  const constraint = await client.query(
    `SELECT pg_get_constraintdef(con.oid) AS definition
       FROM pg_constraint con
      WHERE con.conrelid = to_regclass('private.auth_signup_intents')
        AND con.conname = 'auth_signup_intents_investor_type_check'`,
  );
  const constraintDefinition = normalizeConstraint(constraint.rows[0]?.definition ?? "");
  const constraintPass =
    constraintDefinition ===
    "checkrole='investor'::roleandinvestortypeisnotnullorrole<>'investor'::roleandinvestortypeisnull";
  console.log(
    `constraint private.auth_signup_intents.auth_signup_intents_investor_type_check: ${constraintPass ? "PASS" : "FAIL"}`,
  );

  const comment = await client.query(
    `SELECT col_description(to_regclass('private.auth_signup_intents'), a.attnum)
              AS description
       FROM pg_attribute a
      WHERE a.attrelid = to_regclass('private.auth_signup_intents')
        AND a.attname = 'investorType'
        AND a.attnum > 0
        AND NOT a.attisdropped`,
  );
  const commentPass =
    comment.rows[0]?.description ===
    "Server-validated Investor subtype stored during signup intent creation.";
  console.log(
    `comment private.auth_signup_intents."investorType": ${commentPass ? "PASS" : "FAIL"}`,
  );

  const functionResult = await client.query(
    `SELECT p.prosrc AS body,
            p.prosecdef AS security_definer,
            p.proconfig AS configuration,
            has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
            has_function_privilege('authenticated', p.oid, 'EXECUTE')
              AS authenticated_execute,
            EXISTS (
              SELECT 1
                FROM aclexplode(
                  coalesce(p.proacl, acldefault('f', p.proowner))
                ) AS privilege
               WHERE privilege.grantee = 0
                 AND privilege.privilege_type = 'EXECUTE'
            ) AS public_execute
       FROM pg_proc p
      WHERE p.oid = to_regprocedure('public.proplink_create_auth_profile()')`,
  );
  const actualFunction = functionResult.rows[0];
  const functionPass =
    Boolean(actualFunction) &&
    normalizeSql(actualFunction.body) === normalizeSql(functionBody) &&
    actualFunction.security_definer === true &&
    actualFunction.configuration?.includes('search_path=""') === true &&
    actualFunction.anon_execute === false &&
    actualFunction.authenticated_execute === false &&
    actualFunction.public_execute === false;
  console.log(
    `function public.proplink_create_auth_profile(): ${functionPass ? "PASS" : "FAIL"}`,
  );
  const phase3GatePassed =
    column.rows[0].present && constraintPass && commentPass && functionPass;

  const propertySource = await client.query(
    `SELECT
       EXISTS (
         SELECT 1
           FROM pg_attribute a
          WHERE a.attrelid = to_regclass('public."Property"')
            AND a.attname = 'agentProfileId'
            AND a.attnum > 0
            AND NOT a.attisdropped
            AND NOT a.attnotnull
       ) AS nullable_agent_profile,
       EXISTS (
         SELECT 1
           FROM pg_attribute a
           JOIN pg_type t ON t.oid = a.atttypid
           JOIN pg_namespace n ON n.oid = t.typnamespace
           JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid = to_regclass('public."Property"')
            AND a.attname = 'listingSource'
            AND a.attnum > 0
            AND NOT a.attisdropped
            AND a.attnotnull
            AND n.nspname = 'public'
            AND t.typname = 'ListingSource'
            AND lower(
              replace(
                replace(pg_get_expr(d.adbin, d.adrelid), '"', ''),
                'public.',
                ''
              )
            ) = '''agent''::listingsource'
       ) AS listing_source_shape`,
  );
  const listingSourceLabels = await client.query(
    `SELECT coalesce(
          (
            SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
                     = ARRAY['AGENT', 'FLIPPER_RESALE']::text[]
              FROM pg_enum e
              JOIN pg_type t ON t.oid = e.enumtypid
              JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE n.nspname = 'public'
               AND t.typname = 'ListingSource'
          ),
          false
        ) AS match`,
  );
  console.log(
    `enum public."ListingSource" labels: ${listingSourceLabels.rows[0].match ? "PASS" : "FAIL"}`,
  );
  console.log(
    `column public."Property"."agentProfileId" nullable: ${propertySource.rows[0].nullable_agent_profile ? "PASS" : "FAIL"}`,
  );
  console.log(
    `column public."Property"."listingSource" type/default/not-null: ${propertySource.rows[0].listing_source_shape ? "PASS" : "FAIL"}`,
  );

  const expected = [...expectedObjects.values()];
  const checks = await client.query(
    `WITH expected AS (
       SELECT *
         FROM jsonb_to_recordset($1::jsonb) AS item(
           kind text,
           schema_name text,
           table_name text,
           object_name text,
           label text
         )
     )
     SELECT item.label,
       CASE item.kind
         WHEN 'schema' THEN EXISTS (
           SELECT 1 FROM pg_namespace n
            WHERE n.nspname = item.schema_name
         )
         WHEN 'table' THEN EXISTS (
           SELECT 1
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = item.schema_name
              AND c.relname = item.object_name
              AND c.relkind IN ('r', 'p')
         )
         WHEN 'column' THEN EXISTS (
           SELECT 1
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_attribute a ON a.attrelid = c.oid
            WHERE n.nspname = item.schema_name
              AND c.relname = item.table_name
              AND a.attname = item.object_name
              AND a.attnum > 0
              AND NOT a.attisdropped
         )
         WHEN 'enum' THEN EXISTS (
           SELECT 1
             FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = item.schema_name
              AND t.typname = item.object_name
              AND t.typtype = 'e'
         )
         WHEN 'index' THEN EXISTS (
           SELECT 1
             FROM pg_class i
             JOIN pg_namespace n ON n.oid = i.relnamespace
             JOIN pg_index ix ON ix.indexrelid = i.oid
             JOIN pg_class t ON t.oid = ix.indrelid
            WHERE n.nspname = item.schema_name
              AND i.relname = item.object_name
              AND t.relname = item.table_name
         )
         WHEN 'constraint' THEN EXISTS (
           SELECT 1
             FROM pg_constraint con
             JOIN pg_class t ON t.oid = con.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = item.schema_name
              AND t.relname = item.table_name
              AND con.conname = item.object_name
         )
         WHEN 'policy' THEN EXISTS (
           SELECT 1 FROM pg_policies p
            WHERE p.schemaname = item.schema_name
              AND p.tablename = item.table_name
              AND p.policyname = item.object_name
         )
         WHEN 'rls' THEN EXISTS (
           SELECT 1
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = item.schema_name
              AND c.relname = item.object_name
              AND c.relrowsecurity
         )
         WHEN 'function' THEN EXISTS (
           SELECT 1
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = item.schema_name
              AND p.proname = item.object_name
              AND p.pronargs = 0
         )
         WHEN 'trigger' THEN EXISTS (
           SELECT 1
             FROM pg_trigger tr
             JOIN pg_class c ON c.oid = tr.tgrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = item.schema_name
              AND c.relname = item.table_name
              AND tr.tgname = item.object_name
              AND NOT tr.tgisinternal
         )
         WHEN 'bucket' THEN EXISTS (
           SELECT 1 FROM storage.buckets b
            WHERE b.id = item.object_name
              AND b.public = false
         )
         ELSE false
       END AS present
       FROM expected item
      ORDER BY item.label`,
    [JSON.stringify(expected)],
  );
  for (const check of checks.rows) {
    console.log(`${check.label}: ${check.present ? "PASS" : "FAIL"}`);
  }

  if (!phase3GatePassed) {
    process.exitCode = 1;
  }
  await client.query("ROLLBACK");
} finally {
  await client.end();
}
