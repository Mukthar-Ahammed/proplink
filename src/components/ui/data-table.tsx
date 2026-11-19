import { cn } from "@/lib/cn";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
  className?: string;
  /** Names the scrollable region for screen readers (default "Table"). */
  label?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyMessage = "No results",
  className,
  label = "Table",
}: DataTableProps<T>) {
  return (
    // `relative`: absolutely positioned descendants (sr-only labels) stay inside
    // the scroll box instead of widening the page on small screens (Phase 6).
    // Focusable named region: on a phone the table scrolls sideways, and a
    // keyboard user must be able to reach it (axe: scrollable-region-focusable).
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(
        "relative overflow-x-auto rounded-2xl border border-line bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className,
      )}
    >
      <table className="w-full min-w-max text-left text-sm">
        <thead className="bg-surface text-xs font-medium tracking-wide text-muted uppercase">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cn("px-4 py-3 font-semibold", c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line bg-white">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-muted">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="hover:bg-surface/60">
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-4 py-3", c.className)}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
