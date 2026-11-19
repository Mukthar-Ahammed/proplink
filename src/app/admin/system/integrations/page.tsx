import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { requireAdminPagePermission } from "@/lib/authz";
import {
  databaseLatencyMs,
  integrationStatus,
  safetyFlags,
} from "@/services/admin/systemHealth";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Admin — Integrations | PropLink",
  robots: { index: false },
};

const MODE: Record<string, string> = { live: "Live", mock: "Mock", off: "Off" };

/**
 * Integrations health (Phase 6 Task 4, ADR-061; Phase 0 carry-over). Admin
 * with MFA and the system-integrations permission. Shows which provider each
 * integration uses and whether its settings are present, never their values.
 */
export default async function AdminIntegrationsPage() {
  await requireAdminPagePermission("SYSTEM_INTEGRATIONS");
  const [rows, latency] = [integrationStatus(), await databaseLatencyMs()];
  const flags = safetyFlags();
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Integrations health"
        description="Which provider each integration uses and whether its settings are present. Values are never shown."
      />
      <Card>
        <CardTitle>Database</CardTitle>
        <CardBody>
          <p className="text-sm text-body" data-testid="db-latency">
            {latency === null ? "Unreachable" : `Reachable, ${latency} ms round trip`}
          </p>
        </CardBody>
      </Card>
      <Card>
        <CardTitle>Providers</CardTitle>
        <CardBody>
          <table className="w-full text-left text-sm" data-testid="integrations">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 font-semibold">Integration</th>
                <th className="py-1 font-semibold">Mode</th>
                <th className="py-1 font-semibold">Settings</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name} className="border-t border-line align-top">
                  <td className="py-2">
                    <span className="text-body">{row.name}</span>
                    <span className="block text-xs text-muted">{row.purpose}</span>
                  </td>
                  <td className="py-2 text-body">{MODE[row.mode]}</td>
                  <td className="py-2">
                    {row.configured ? (
                      <span className="text-success">Set</span>
                    ) : (
                      <span className="text-danger">
                        Missing: {row.missing.join(", ")}
                      </span>
                    )}
                    {row.note && (
                      <span className="block text-xs text-muted">{row.note}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
      <Card>
        <CardTitle>
          Compliance switches (must stay off without written sign-off)
        </CardTitle>
        <CardBody>
          <ul className="space-y-1 text-sm" data-testid="safety-flags">
            {flags.map(({ flag, on }) => (
              <li key={flag} className={on ? "font-semibold text-danger" : "text-body"}>
                {flag}: {on ? "ON" : "off"}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
