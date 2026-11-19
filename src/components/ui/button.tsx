import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui/spinner";

type Variant = "primary" | "secondary" | "outline" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

/**
 * Pill buttons (ADR-071). `primary` is the deep-teal `accent` fill — the one
 * brand hue, used for the main action on every screen. `secondary` is the soft
 * teal-mist variant, `outline` the hairline one. `danger` stays red, so the main
 * and destructive actions are never in the same colour family.
 */
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-strong",
  secondary: "bg-pale text-accent hover:bg-accent hover:text-white",
  outline:
    "border border-line bg-white text-primary hover:border-accent hover:text-accent",
  danger: "bg-danger text-white hover:opacity-90",
  ghost: "text-secondary hover:bg-surface hover:text-primary",
};

const SIZES: Record<Size, string> = {
  sm: "px-3.5 py-1.5 text-sm",
  md: "px-5 py-2.5 text-sm",
  lg: "px-7 py-3.5 text-base",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner and disables the button (ADR-077). */
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  );
}
