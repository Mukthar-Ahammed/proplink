import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui/spinner";

/**
 * The route-level loading screen used by every `loading.tsx` (ADR-077). It
 * fills the content area while a page's server data streams in; the site
 * header and any portal frame above it stay on screen and interactive.
 */
export function PageLoader({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="page-loader"
      className={cn(
        "flex min-h-[40vh] w-full flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-accent",
        className,
      )}
    >
      <Spinner size="lg" />
      <p className="text-sm font-medium text-muted">{label}</p>
    </div>
  );
}
