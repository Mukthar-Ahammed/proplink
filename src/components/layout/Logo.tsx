import { cn } from "@/lib/cn";

/**
 * The PropLink UK wordmark: a simple house-outline mark beside the name.
 * Colour comes from `currentColor`, so the parent decides ink or white.
 * `mark={false}` drops the house icon and leaves the name alone.
 */
export function Logo({ className, mark = true }: { className?: string; mark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {mark ? (
        <svg
          aria-hidden
          viewBox="0 0 28 28"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinejoin="round"
          className="h-7 w-7"
        >
          <path d="M4.5 12.5 14 4.5l9.5 8V23a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V12.5Z" />
          <path d="M11 23.5v-6.5h6v6.5" />
        </svg>
      ) : null}
      <span className="text-lg font-bold tracking-tight whitespace-nowrap">
        PropLink<span className="font-normal"> UK</span>
      </span>
    </span>
  );
}
