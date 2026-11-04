import { cn } from "@/lib/cn";

export type StatusTone = "success" | "warning" | "danger" | "neutral" | "brand";

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  danger: "bg-danger/15 text-danger border-danger/30",
  neutral: "bg-surface text-secondary border-line",
  brand: "bg-brand/15 text-brand border-brand/30",
};

export function mapStatusToTone(status: string): StatusTone {
  const upper = status.toUpperCase();
  if (["APPROVED", "LIVE", "COMPLETED", "ACTIVE", "CONFIRMED"].includes(upper)) {
    return "success";
  }
  if (["PENDING", "PENDING_REVIEW", "SUBMITTED", "IN_PROGRESS", "REQUESTED"].includes(upper)) {
    return "warning";
  }
  if (["REJECTED", "DEACTIVATED", "SUSPENDED", "CANCELLED", "DECLINED", "WITHDRAWN"].includes(upper)) {
    return "danger";
  }
  return "neutral";
}

export interface StatusBadgeProps {
  status: string;
  label?: string;
  tone?: StatusTone;
  className?: string;
}

export function StatusBadge({ status, label, tone, className }: StatusBadgeProps) {
  const resolvedTone = tone ?? mapStatusToTone(status);
  const displayText = label ?? status.replace(/_/g, " ");

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider transition-colors",
        TONE_CLASSES[resolvedTone],
        className,
      )}
    >
      {displayText}
    </span>
  );
}
