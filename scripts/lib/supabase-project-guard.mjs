import { readFileSync } from "node:fs";

const projectRefs = JSON.parse(
  readFileSync(new URL("../../config/supabase-projects.json", import.meta.url), "utf8"),
);

function getProjectRef(urlValue) {
  let url;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is invalid.");
  }
  const match = /^([a-z0-9]+)\.supabase\.co$/i.exec(url.hostname);
  if (url.protocol !== "https:" || !match) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must identify a hosted Supabase project.");
  }
  return match[1];
}

/**
 * @param {{
 *   url: string,
 *   environment: "development" | "staging" | "production",
 *   localProjectRef?: string,
 *   databaseUrl?: string
 * }} input
 */
export function assertExpectedSupabaseProject({
  url,
  environment,
  localProjectRef,
  databaseUrl,
}) {
  const projectRef = getProjectRef(url);
  console.log(`Supabase project ref: ${projectRef} (${environment})`);

  let expectedRef;
  if (environment === "staging") expectedRef = projectRefs.staging;
  if (environment === "production") expectedRef = projectRefs.production;
  if (environment === "development") {
    expectedRef = projectRefs.development;
    if (localProjectRef !== expectedRef) {
      throw new Error(
        "PROPLINK_LOCAL_SUPABASE_PROJECT_REF must match the approved development project.",
      );
    }
  }

  if (!expectedRef) {
    throw new Error(
      environment === "development"
        ? "No approved development Supabase project is configured."
        : `No approved Supabase project reference is configured for ${environment}.`,
    );
  }
  if (projectRef !== expectedRef) {
    throw new Error(
      `Refusing ${environment} operations: Supabase project ref does not match the approved ${environment} project.`,
    );
  }

  if (databaseUrl) {
    let db;
    try {
      db = new URL(databaseUrl);
    } catch {
      throw new Error("Database connection URL is invalid.");
    }
    const username = decodeURIComponent(db.username);
    const isLocalDatabase = ["localhost", "127.0.0.1", "::1"].includes(db.hostname);
    const identifiesProject =
      username === `postgres.${projectRef}` ||
      db.hostname === `db.${projectRef}.supabase.co`;
    if (!isLocalDatabase && !identifiesProject) {
      throw new Error(
        "Database connection does not identify the approved Supabase project.",
      );
    }
  }

  return projectRef;
}

export function assertConfiguredSupabaseProject(env = process.env) {
  const environment =
    env.PROPLINK_ENV ?? (env.NODE_ENV === "production" ? "production" : "development");
  if (!["development", "staging", "production"].includes(environment)) {
    throw new Error("PROPLINK_ENV must be development, staging, or production.");
  }
  const projectRef = assertExpectedSupabaseProject({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    environment,
    localProjectRef: env.PROPLINK_LOCAL_SUPABASE_PROJECT_REF,
    databaseUrl: env.DIRECT_URL ?? env.DATABASE_URL,
  });
  if (environment === "staging" && env.PROPLINK_STAGING_PROJECT_REF !== projectRef) {
    throw new Error(
      "Configured staging project reference does not match the approved staging project.",
    );
  }
  return projectRef;
}

export { projectRefs };
