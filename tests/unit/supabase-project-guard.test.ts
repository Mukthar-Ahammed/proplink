import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertExpectedSupabaseProject,
  resolvePropLinkEnvironment,
} from "@/lib/supabase/project-guard";
import { assertExpectedSupabaseProject as assertScriptProject } from "../../scripts/lib/supabase-project-guard.mjs";

describe("Supabase project guard", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resolves staging explicitly and production from NODE_ENV", () => {
    expect(resolvePropLinkEnvironment("development", "staging")).toBe("staging");
    expect(resolvePropLinkEnvironment("production", undefined)).toBe("production");
    expect(resolvePropLinkEnvironment("development", undefined)).toBe("development");
    expect(() => resolvePropLinkEnvironment("development", "production")).toThrow(
      /must agree with NODE_ENV/,
    );
    // Phase 7 Task 7: deployed staging is a production build.
    expect(resolvePropLinkEnvironment("production", "staging")).toBe("staging");
    expect(() => resolvePropLinkEnvironment("production", "development")).toThrow(
      /must agree with NODE_ENV/,
    );
  });

  it("accepts only the approved project for the selected environment", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect(
      assertExpectedSupabaseProject({
        url: "https://jqmgfdjbfvcyivtquufn.supabase.co",
        environment: "staging",
      }),
    ).toBe("jqmgfdjbfvcyivtquufn");
    expect(() =>
      assertExpectedSupabaseProject({
        url: "https://onhdlxxbdcfwujhtphaj.supabase.co",
        environment: "staging",
      }),
    ).toThrow(/does not match the approved staging project/);
  });

  it("uses the same project mapping in scripts", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(
      assertScriptProject({
        url: "https://jqmgfdjbfvcyivtquufn.supabase.co",
        environment: "staging",
      }),
    ).toBe("jqmgfdjbfvcyivtquufn");
    expect(() =>
      assertScriptProject({
        url: "https://onhdlxxbdcfwujhtphaj.supabase.co",
        environment: "staging",
      }),
    ).toThrow(/does not match the approved staging project/);
  });

  it("allows only the approved development project", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect(
      assertExpectedSupabaseProject({
        url: "https://onhdlxxbdcfwujhtphaj.supabase.co",
        environment: "development",
        localProjectRef: "onhdlxxbdcfwujhtphaj",
      }),
    ).toBe("onhdlxxbdcfwujhtphaj");
    expect(() =>
      assertExpectedSupabaseProject({
        url: "https://jqmgfdjbfvcyivtquufn.supabase.co",
        environment: "development",
        localProjectRef: "jqmgfdjbfvcyivtquufn",
      }),
    ).toThrow(/must match the approved development project/);
    expect(() =>
      assertExpectedSupabaseProject({
        url: "https://onhdlxxbdcfwujhtphaj.supabase.co",
        environment: "development",
        localProjectRef: "some-other-ref",
      }),
    ).toThrow(/must match the approved development project/);
  });

  it("fails closed for production until a distinct project ref is configured", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect(() =>
      assertExpectedSupabaseProject({
        url: "https://onhdlxxbdcfwujhtphaj.supabase.co",
        environment: "production",
      }),
    ).toThrow(/No approved Supabase project reference is configured/);
  });

  it("rejects database URLs for a different hosted project", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect(() =>
      assertExpectedSupabaseProject({
        url: "https://jqmgfdjbfvcyivtquufn.supabase.co",
        environment: "staging",
        databaseUrls: [
          [
            "DIRECT_URL",
            "postgresql://postgres.otherproject@db.otherproject.supabase.co/postgres",
          ],
        ],
      }),
    ).toThrow(/DIRECT_URL does not identify the approved Supabase project/);
  });
});
