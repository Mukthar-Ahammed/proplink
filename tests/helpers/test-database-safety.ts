const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Set by tests/setup/env.ts when no database is configured; never connected to. */
export const NO_DATABASE_PLACEHOLDER = "postgresql://no-database@127.0.0.1:9/no_database";

export function assertSafeIntegrationDatabase(
  connectionString: string | undefined,
): boolean {
  if (!connectionString) return false;
  // tests/setup/env.ts placeholder: no database for this run, so skip.
  if (connectionString === NO_DATABASE_PLACEHOLDER) return false;

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(
      "Refusing integration tests: DATABASE_URL must be a valid local test database URL. No database connection was attempted.",
    );
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !LOCAL_DATABASE_HOSTS.has(url.hostname.toLowerCase()) ||
    !databaseName.toLowerCase().includes("test")
  ) {
    throw new Error(
      "Refusing integration tests: DATABASE_URL must use a localhost host and a database name containing 'test'. No database connection was attempted.",
    );
  }

  return true;
}
