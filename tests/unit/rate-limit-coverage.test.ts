import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { getRateLimitRule } from "@/lib/security/rate-limit";

vi.mock("server-only", () => ({}));

const apiRoot = resolve(process.cwd(), "src/app/api");

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.isFile() && entry.name === "route.ts" ? [path] : [];
  });
}

const routes = routeFiles(apiRoot).map((file) => {
  const source = readFileSync(file, "utf8");
  const routePath = `/api/${relative(apiRoot, file)
    .replace(/\\/g, "/")
    .replace(/\/route\.ts$/, "")
    .replace(/\[[^\]]+\]/g, "test-id")}`;
  const methods = [
    ...source.matchAll(/export\s+async\s+function\s+(GET|HEAD|POST|PUT|PATCH|DELETE)\b/g),
  ].map((match) => match[1]);
  return { file, routePath, methods };
});

describe("global API rate-limit coverage", () => {
  it("applies the proxy limiter to every API route module", () => {
    const proxy = readFileSync(resolve(process.cwd(), "src/proxy.ts"), "utf8");

    expect(proxy).toContain("enforceRequestRateLimit(request, user?.id)");
    expect(proxy).toContain("matcher: [");
    expect(proxy).toContain("!_next/static");
    expect(routes.length).toBeGreaterThan(0);

    for (const route of routes) {
      expect(route.methods, route.file).not.toHaveLength(0);
    }
  });

  it.each(
    routes.flatMap((route) =>
      route.methods.map((method) => [route.routePath, method] as const),
    ),
  )(
    "%s %s has a rate-limit rule for anonymous and authenticated callers",
    (path, method) => {
      expect(getRateLimitRule(path, method, false)).not.toBeNull();
      expect(getRateLimitRule(path, method, true)).not.toBeNull();
    },
  );
});
