import { config } from "dotenv";
import { defineConfig } from "prisma/config";

if (process.env.PROPLINK_ENV === "staging") {
  config({ path: ".env.staging.local", override: true });
} else {
  config({ path: ".env.local" });
  config();
}

if (process.env.PROPLINK_ENV === "staging" && !process.env.PROPLINK_STAGING_PROJECT_REF) {
  throw new Error("Staging Prisma commands require PROPLINK_STAGING_PROJECT_REF");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  // CLI (migrate/seed) uses the DIRECT Supabase connection; the app runtime
  // uses the pooled DATABASE_URL via the pg driver adapter (src/lib/db.ts).
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
