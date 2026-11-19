import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Creates the Supabase Auth account for an invited Agent (Phase 1 Task 3,
 * ADR-023).
 *
 * The invite link already proves the Agent controls the invited inbox, so the
 * account is created with its email confirmed and the Agent can sign in
 * straight away. That needs Supabase's Admin API, which needs the
 * server-only service-role key. Without the key the provisioner fails closed:
 * invites can still be created and sent, but not accepted (BLOCKERS.md).
 *
 * The `signupNonce` goes into user metadata, where the profile trigger matches
 * it against the server-written invite claim. Metadata alone grants nothing.
 */
export type ProvisionResult =
  { ok: true; authUserId: string } | { ok: false; reason: "exists" | "unavailable" };

export interface AgentAccountProvisioner {
  createConfirmedUser(input: {
    email: string;
    password: string;
    signupNonce: string;
  }): Promise<ProvisionResult>;
}

/** Real adapter: Supabase Admin API with the service-role key (server only). */
export class SupabaseAdminProvisioner implements AgentAccountProvisioner {
  constructor(
    private readonly url: string,
    private readonly serviceRoleKey: string,
  ) {}

  async createConfirmedUser(input: {
    email: string;
    password: string;
    signupNonce: string;
  }): Promise<ProvisionResult> {
    const admin = createClient(this.url, this.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { proplink_signup_nonce: input.signupNonce },
    });
    if (error) {
      if (error.code === "email_exists" || error.status === 422) {
        return { ok: false, reason: "exists" };
      }
      console.warn(
        JSON.stringify({
          event: "auth.agent_provision_failed",
          code: error.code ?? null,
          status: error.status ?? null,
        }),
      );
      return { ok: false, reason: "unavailable" };
    }
    if (!data.user?.id) return { ok: false, reason: "unavailable" };
    return { ok: true, authUserId: data.user.id };
  }
}

/** Used when the service-role key is not configured: never creates anything. */
export class UnavailableProvisioner implements AgentAccountProvisioner {
  async createConfirmedUser(): Promise<ProvisionResult> {
    return { ok: false, reason: "unavailable" };
  }
}

let override: AgentAccountProvisioner | null = null;

/** Test seam: replace the provisioner (pass null to restore the default). */
export function setAgentAccountProvisionerForTests(
  provisioner: AgentAccountProvisioner | null,
): void {
  override = provisioner;
}

export function getAgentAccountProvisioner(): AgentAccountProvisioner {
  if (override) return override;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return new UnavailableProvisioner();
  return new SupabaseAdminProvisioner(url, key);
}
