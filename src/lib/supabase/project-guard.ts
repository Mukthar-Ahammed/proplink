import projectRefs from "../../../config/supabase-projects.json";

export type PropLinkEnvironment = "development" | "staging" | "production";

export function resolvePropLinkEnvironment(
  nodeEnv: string | undefined,
  explicitEnvironment: string | undefined,
): PropLinkEnvironment {
  const environment =
    explicitEnvironment ?? (nodeEnv === "production" ? "production" : "development");
  if (
    environment !== "development" &&
    environment !== "staging" &&
    environment !== "production"
  ) {
    throw new Error("PROPLINK_ENV must be development, staging, or production.");
  }
  if (
    (nodeEnv === "production" && environment !== "production") ||
    (nodeEnv !== "production" && environment === "production")
  ) {
    throw new Error(
      "PROPLINK_ENV must agree with NODE_ENV; production cannot run as a development environment.",
    );
  }
  return environment;
}

export function getSupabaseProjectRef(urlValue: string): string {
  let url: URL;
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

export function assertExpectedSupabaseProject(input: {
  url: string;
  environment: PropLinkEnvironment;
  localProjectRef?: string;
  databaseUrls?: Array<[string, string | undefined]>;
}): string {
  const projectRef = getSupabaseProjectRef(input.url);
  console.info(`Supabase project ref: ${projectRef} (${input.environment})`);

  let expectedRef: string | null | undefined;
  if (input.environment === "staging") expectedRef = projectRefs.staging;
  if (input.environment === "production") expectedRef = projectRefs.production;
  if (input.environment === "development") {
    expectedRef = projectRefs.development;
    if (input.localProjectRef !== expectedRef) {
      throw new Error(
        "PROPLINK_LOCAL_SUPABASE_PROJECT_REF must match the approved development project.",
      );
    }
  }

  if (!expectedRef) {
    throw new Error(
      input.environment === "development"
        ? "No approved development Supabase project is configured."
        : `No approved Supabase project reference is configured for ${input.environment}.`,
    );
  }
  if (projectRef !== expectedRef) {
    throw new Error(
      `Refusing ${input.environment} operations: Supabase project ref does not match the approved ${input.environment} project.`,
    );
  }
  for (const [name, value] of input.databaseUrls ?? []) {
    if (!value) continue;
    let databaseUrl: URL;
    try {
      databaseUrl = new URL(value);
    } catch {
      throw new Error(`${name} is invalid.`);
    }
    const username = decodeURIComponent(databaseUrl.username);
    const isLocalDatabase = ["localhost", "127.0.0.1", "::1"].includes(
      databaseUrl.hostname,
    );
    const identifiesProject =
      username === `postgres.${projectRef}` ||
      databaseUrl.hostname === `db.${projectRef}.supabase.co`;
    if (!isLocalDatabase && !identifiesProject) {
      throw new Error(`${name} does not identify the approved Supabase project.`);
    }
  }
  return projectRef;
}
