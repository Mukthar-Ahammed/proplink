import { describe, expect, it, vi } from "vitest";
import { createAuthAdapter } from "../../scripts/phase3-service-adapters.mjs";
import projectRefs from "../../config/supabase-projects.json";
// The project guard only accepts the approved staging ref; the admin client is
// mocked, so no request reaches that project.
const stagingRef = projectRefs.staging;
const env = {
  PROPLINK_STAGING_PROJECT_REF: stagingRef,
  NEXT_PUBLIC_SUPABASE_URL: `https://${stagingRef}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: "secret",
};
const input = {
  email: "phase3-test-agent@example.test",
  password: "hidden",
  app_metadata: { phase3_disposable: true, proplink_fixture_marker: "m" },
};
function admin() {
  return {
    auth: { admin: { createUser: vi.fn(), getUserById: vi.fn(), listUsers: vi.fn() } },
  };
}
describe("Auth adapter uncertainty", () => {
  it("marks thrown errors uncertain", async () => {
    const a = admin();
    a.auth.admin.createUser.mockRejectedValue(new Error("network"));
    await expect(createAuthAdapter(env, a).createUser(input)).rejects.toMatchObject({
      uncertain: true,
    });
  });
  it("marks API errors uncertain", async () => {
    const a = admin();
    a.auth.admin.createUser.mockResolvedValue({ error: new Error("api") });
    await expect(createAuthAdapter(env, a).createUser(input)).rejects.toMatchObject({
      uncertain: true,
    });
  });
  it("accepts valid response", async () => {
    const a = admin();
    a.auth.admin.createUser.mockResolvedValue({
      data: { user: { id: "1", email: input.email, app_metadata: input.app_metadata } },
    });
    await expect(createAuthAdapter(env, a).createUser(input)).resolves.toEqual({
      id: "1",
      email: input.email,
    });
  });
  it("rejects ambiguous marker matches", async () => {
    const a = admin();
    a.auth.admin.listUsers.mockResolvedValue({
      data: {
        users: [
          { id: "1", email: input.email, app_metadata: input.app_metadata },
          { id: "2", email: input.email, app_metadata: input.app_metadata },
        ],
      },
    });
    await expect(
      createAuthAdapter(env, a).discover("m", input.email),
    ).resolves.toHaveLength(2);
  });
  it("classifies malformed response as uncertain", async () => {
    const a = admin();
    a.auth.admin.createUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(createAuthAdapter(env, a).createUser(input)).rejects.toMatchObject({
      uncertain: true,
    });
  });
  it("keeps pre-request validation deterministic", async () => {
    const a = admin();
    await expect(
      createAuthAdapter(env, a).createUser({ ...input, email: "real@example.test" }),
    ).rejects.toThrow(/Non-disposable/);
    expect(a.auth.admin.createUser).not.toHaveBeenCalled();
  });
  it("classifies thrown timeout as uncertain", async () => {
    const a = admin();
    const error = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    a.auth.admin.createUser.mockRejectedValue(error);
    await expect(createAuthAdapter(env, a).createUser(input)).rejects.toMatchObject({
      uncertain: true,
    });
  });
});
