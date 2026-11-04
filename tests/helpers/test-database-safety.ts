const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function assertSafeIntegrationDatabase(
  connectionString: string | undefined,
): boolean {
  if (!connectionString) return false;

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
