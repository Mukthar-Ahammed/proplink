import { ReactNode } from "react";
import { cn } from "@/lib/cn";

type BadgeTone = "success" | "warning" | "danger" | "neutral";

const BADGE_TONE_CLASSES: Record<BadgeTone, string> = {
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  danger: "bg-danger/15 text-danger border-danger/30",
  neutral: "bg-surface text-secondary border-line",
};

export interface AdminPageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
  badge?: { label: string; tone?: BadgeTone };
}

export function AdminPageHeader({ title, description, action, badge }: AdminPageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 pb-6 border-b border-line sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-bold tracking-tight text-primary sm:text-2xl">{title}</h1>
          {badge && (
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider",
                BADGE_TONE_CLASSES[badge.tone ?? "neutral"],
              )}
            >
              {badge.label}
            </span>
          )}
        </div>
        {description && <p className="mt-1 text-xs text-muted sm:text-sm">{description}</p>}
      </div>
      {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
    </div>
  );
}
