import { cn } from "@/lib/cn";

type Size = "xs" | "sm" | "md" | "lg";

const SIZES: Record<Size, string> = {
  xs: "h-3.5 w-3.5 border-2",
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-10 w-10 border-[3px]",
};

/**
 * The one loading spinner (ADR-077). It draws in `currentColor`, so it takes the
 * colour of the text around it — white on a filled button, accent on a page.
 * Decorative by default; pass `label` when the spinner is the only signal.
 */
export function Spinner({
  size = "sm",
  label,
  className,
}: {
  size?: Size;
  label?: string;
  className?: string;
}) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        "inline-block shrink-0 animate-spin rounded-full border-current border-t-transparent motion-reduce:animate-[spin_2.5s_linear_infinite]",
        SIZES[size],
        className,
      )}
    />
  );
}
