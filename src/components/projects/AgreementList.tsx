import { day } from "@/components/projects/format";
import { formatPence } from "@/services/projects/common";
import type { AgreementView } from "@/services/projects/agreements";

const STATUS: Record<string, string> = {
  DRAFT: "Draft (not sent)",
  SENT: "Out for signature",
  SIGNED: "Signed",
  DECLINED: "Declined",
  EXPIRED: "Expired",
  VOIDED: "Voided",
};

const ROLE: Record<string, string> = {
  INVESTOR: "Investor",
  LANDLORD: "Landlord",
  AGENT: "Agent",
};

/**
 * Project agreements (Phase 4 Task 6). Loss allocation and cancellation
 * terms are shown exactly as the agreement states them (OD-06).
 * `renderActions` adds the viewer's own controls.
 */
export function AgreementList({
  agreements,
  renderActions,
}: {
  agreements: AgreementView[];
  renderActions?: (agreement: AgreementView) => React.ReactNode;
}) {
  if (agreements.length === 0) {
    return <p className="text-sm text-muted">No agreements yet.</p>;
  }
  return (
    <ul className="space-y-4" data-testid="agreements">
      {agreements.map((agreement) => (
        <li key={agreement.id} className="rounded-lg border border-line bg-white p-4">
          <p className="font-semibold text-primary">
            {agreement.title} · version {agreement.version}
          </p>
          <p className="text-sm text-muted" data-testid="agreement-status">
            {STATUS[agreement.status]}
            {agreement.status === "SENT" &&
              ` · ${agreement.signedCount} of ${agreement.partyCount} signed`}
            {agreement.sentAt && ` · sent ${day(agreement.sentAt)}`}
            {agreement.completedAt && ` · ${day(agreement.completedAt)}`}
            {agreement.testMode && agreement.status !== "DRAFT" && " · test mode"}
            {agreement.endedReason && ` · ${agreement.endedReason}`}
          </p>
          {agreement.mine && (
            <p className="mt-1 text-sm text-body">
              Your signature:{" "}
              {agreement.mine.signerStatus === "SIGNED"
                ? "signed"
                : agreement.mine.signerStatus === "DECLINED"
                  ? "declined"
                  : "waiting for you"}
            </p>
          )}
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-muted uppercase">
                Loss allocation (as written in the agreement)
              </dt>
              <dd className="whitespace-pre-line text-body">
                {agreement.lossAllocation}
              </dd>
            </div>
            {(agreement.cancellationPaymentGBP !== null ||
              agreement.cancellationTerms) && (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium text-muted uppercase">
                  Cancellation (handled by the Solicitor outside PropLink)
                </dt>
                <dd className="whitespace-pre-line text-body">
                  {agreement.cancellationPaymentGBP !== null &&
                    `Cancellation payment: ${formatPence(agreement.cancellationPaymentGBP)}. `}
                  {agreement.cancellationTerms}
                </dd>
              </div>
            )}
            {agreement.otherTerms && (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium text-muted uppercase">Other terms</dt>
                <dd className="whitespace-pre-line text-body">{agreement.otherTerms}</dd>
              </div>
            )}
          </dl>
          {agreement.parties.length > 0 && (
            <table className="mt-3 w-full text-left text-sm">
              <thead className="text-xs text-muted uppercase">
                <tr>
                  <th className="py-1">Party</th>
                  <th>Role</th>
                  <th>Share</th>
                  <th>Signature</th>
                </tr>
              </thead>
              <tbody>
                {agreement.parties.map((party) => (
                  <tr key={party.profileId} className="border-t border-line">
                    <td className="py-1">{party.name}</td>
                    <td>{ROLE[party.partyRole]}</td>
                    <td>{party.share}</td>
                    <td>
                      {party.signerStatus === "SIGNED"
                        ? `Signed ${day(party.signedAt)}`
                        : party.signerStatus === "DECLINED"
                          ? "Declined"
                          : "Pending"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            {agreement.draftUrl && (
              <a href={agreement.draftUrl} className="text-primary underline">
                Agreement document
              </a>
            )}
            {agreement.signedUrl && (
              <a
                href={agreement.signedUrl}
                className="font-semibold text-primary underline"
              >
                Signed agreement (PDF)
              </a>
            )}
          </div>
          {agreement.signedSha256 && (
            <p className="mt-1 font-mono text-xs break-all text-muted">
              SHA-256 {agreement.signedSha256}
            </p>
          )}
          {renderActions && <div className="mt-3">{renderActions(agreement)}</div>}
        </li>
      ))}
    </ul>
  );
}
