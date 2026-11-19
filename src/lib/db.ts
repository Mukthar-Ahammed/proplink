import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Single Prisma instance per process; hot-reload in dev reuses the global.
// Runtime uses the POOLED Supabase URL; migrations use DIRECT_URL (prisma.config.ts).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // An empty string is falsy to `pg`, which then silently connects to
    // 127.0.0.1:5432 instead of erroring — surface the real problem instead.
    throw new Error(
      "DATABASE_URL is not set — cannot create a Prisma client. Check the environment variables for this deploy context.",
    );
  }
  // Optional pool cap (the test suite sets it so parallel test files stay
  // within the database's connection limit); unset means pg's default.
  const max = Number(process.env.DATABASE_POOL_MAX) || undefined;
  const adapter = new PrismaPg({ connectionString, ...(max ? { max } : {}) });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
