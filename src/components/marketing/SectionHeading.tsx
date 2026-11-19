import { cn } from "@/lib/cn";

/** The small pill label that opens a section ("How it works"). */
export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "inline-flex w-fit items-center rounded-full border border-line bg-surface px-4 py-1.5 text-[11px] font-semibold tracking-[0.18em] text-secondary uppercase",
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * Section headline in the site's pairing: semibold sans with one or two words
 * set in the italic serif (`accent`). `titleTail` continues in sans after the
 * accent ("Browse the *defect* you understand").
 */
export function SectionHeading({
  eyebrow,
  title,
  accent,
  titleTail,
  align = "left",
  as: Tag = "h2",
}: {
  eyebrow?: string;
  title: string;
  accent?: string;
  titleTail?: string;
  align?: "left" | "center";
  as?: "h1" | "h2";
}) {
  return (
    <div
      className={cn("flex flex-col", align === "center" && "items-center text-center")}
    >
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <Tag
        className={cn(
          "font-display max-w-3xl text-[clamp(2rem,4.5vw,3.5rem)] leading-[1.05] font-semibold tracking-[-0.03em] text-primary",
          eyebrow && "mt-5",
        )}
      >
        {title}
        {accent && (
          <>
            {" "}
            <span className="font-serif font-normal tracking-normal italic">
              {accent}
            </span>
          </>
        )}
        {titleTail && <> {titleTail}</>}
      </Tag>
    </div>
  );
}
