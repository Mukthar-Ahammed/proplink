import { cn } from "@/lib/cn";

/** First letters of up to two words: "Alice Agent" → "AA". */
export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("");
  return (letters || "?").toUpperCase();
}

/**
 * Person avatar: their profile photo when the server issued a link for it
 * (signed, short-lived `/api/profiles/photo` URLs only; visibility is decided
 * server-side by `photoUrlsFor`), otherwise their initials. Decorative by
 * default, because the name is always shown next to it.
 */
export function Avatar({
  name,
  src,
  tone = "neutral",
  size = "md",
  className,
}: {
  name: string;
  src?: string | null;
  tone?: "neutral" | "accent";
  size?: "sm" | "md";
  className?: string;
}) {
  const box = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- signed, sandboxed image route
      <img
        src={src}
        alt=""
        aria-hidden
        className={cn(
          "shrink-0 rounded-full border border-line bg-pale object-cover",
          box,
          className,
        )}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold",
        box,
        size === "sm" ? "text-xs" : "text-sm",
        tone === "accent" ? "bg-accent text-white" : "bg-pale text-accent",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
