import { day } from "@/components/projects/format";
import { formatPence } from "@/services/projects/common";

type Row = {
  id: string;
  amountGBP: bigint;
  status: string;
  createdAt: Date;
  share: string;
  investor: { name: string | null };
};

const STATUS: Record<string, string> = {
  PLEDGED: "Expression of interest",
  BINDING: "Binding (signed)",
  CANCELLED: "Cancelled",
  RELEASED: "Released",
};

/** Pledges for the project's Agent and Admin (Phase 4 Task 4). */
export function PledgeTable({ pledges }: { pledges: Row[] }) {
  if (pledges.length === 0) {
    return <p className="text-sm text-muted">No pledges yet.</p>;
  }
  return (
    <table className="w-full text-left text-sm" data-testid="pledge-table">
      <thead className="text-xs text-muted uppercase">
        <tr>
          <th className="py-2">Investor</th>
          <th>Amount</th>
          <th>Share</th>
          <th>Status</th>
          <th>Date</th>
        </tr>
      </thead>
      <tbody>
        {pledges.map((pledge) => (
          <tr key={pledge.id} className="border-t border-line">
            <td className="py-2">{pledge.investor.name ?? "Investor"}</td>
            <td>{formatPence(pledge.amountGBP)}</td>
            <td>{pledge.share}</td>
            <td>{STATUS[pledge.status] ?? pledge.status}</td>
            <td>{day(pledge.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
