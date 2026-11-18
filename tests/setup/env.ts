import { config } from "dotenv";

import { NO_DATABASE_PLACEHOLDER } from "../helpers/test-database-safety";

// `tests/integration/**` talks to the real database, so it needs the same
// `.env.local` the app reads. Harmless for `tests/unit/**`, which mock
// `@/lib/db` and never open a connection.
config({ path: ".env.local", quiet: true });

/**
 * Without any database configured (CI, a fresh checkout), some modules still
 * import the Prisma client, which refuses to load without DATABASE_URL. Give
 * them a placeholder that is never connected to; integration tests recognise
 * it and skip themselves (tests/helpers/test-database-safety.ts).
 */
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = NO_DATABASE_PLACEHOLDER;
}
