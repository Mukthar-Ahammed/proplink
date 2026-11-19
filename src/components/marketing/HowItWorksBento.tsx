import { cn } from "@/lib/cn";

export interface PipelineStep {
  title: string;
  desc: string;
}

/**
 * "How it works" as a bento grid (ADR-071; layout adapted from an
 * owner-supplied features block). Three illustrated cards for the first three
 * pipeline steps, then a wide card for the last step that draws the whole
 * chain of roles ending at the Buyer, set on a dark card as the pipeline's pay-off. Every word comes from the page's existing
 * `STEPS` and audience titles — the illustrations are decorative and
 * `aria-hidden`, so screen readers get an ordered list of steps.
 */
export function HowItWorksBento({
  steps,
  roles,
}: {
  steps: PipelineStep[];
  /** Pipeline roles in order, e.g. Landlords → Agents → Investors → Buyers. */
  roles: string[];
}) {
  const [first, second, third, last] = steps;
  if (!first || !second || !third || !last) return null;

  return (
    <ol className="grid grid-cols-6 gap-3 rounded-[2rem] bg-gradient-to-b from-pale/80 to-surface p-3 ring-1 ring-line/70">
      <StepCard
        index={0}
        step={first}
        className="lg:col-span-2"
        visual={<PrivateVisual />}
      />
      <StepCard
        index={1}
        step={second}
        className="sm:col-span-3 lg:col-span-2"
        visual={<MandateVisual />}
      />
      <StepCard
        index={2}
        step={third}
        className="sm:col-span-3 lg:col-span-2"
        visual={<WorksVisual />}
      />

      {/* Final step is the pipeline's pay-off, so it gets the dark brand card
          (`step-finale`, globals.css): text left, the full chain right. */}
      <li className="step-finale relative isolate col-span-full min-w-0 overflow-hidden rounded-3xl text-white">
        <span
          aria-hidden
          className="pointer-events-none absolute -right-4 -bottom-16 -z-10 font-serif text-[14rem] leading-none text-white/[0.05] italic select-none"
        >
          04
        </span>
        <div className="grid min-w-0 items-center gap-8 p-6 sm:p-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="space-y-6">
            <RingIcon dark>
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
              >
                <path d="M3 10.5 12 3l9 7.5" />
                <path d="M5 9.5V21h14V9.5" />
                <path d="M10 21v-6h4v6" />
              </svg>
            </RingIcon>
            <StepText index={3} step={last} dark />
          </div>
          <Chain roles={roles} />
        </div>
      </li>
    </ol>
  );
}

function StepCard({
  index,
  step,
  visual,
  className,
}: {
  index: number;
  step: PipelineStep;
  visual: React.ReactNode;
  className?: string;
}) {
  return (
    <li
      className={cn(
        "group col-span-full flex min-w-0 flex-col overflow-hidden rounded-3xl border border-line bg-white p-3 transition duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-accent/10 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        className,
      )}
    >
      {/* Tinted stage (`step-stage`, globals.css) with a large serif step
          number, so each illustration reads as a scene, not a floating icon. */}
      <div
        aria-hidden
        className="step-stage relative flex h-52 items-center justify-center overflow-hidden rounded-2xl"
      >
        <span className="absolute top-3 left-5 font-serif text-5xl leading-none text-accent/20 italic">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100">
          {visual}
        </div>
      </div>
      <div className="px-4 pt-6 pb-5">
        <StepText index={index} step={step} />
      </div>
    </li>
  );
}

function StepText({
  index,
  step,
  dark = false,
}: {
  index: number;
  step: PipelineStep;
  dark?: boolean;
}) {
  return (
    <div className="space-y-2">
      <span
        className={cn(
          "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
          dark ? "bg-white/10 text-white ring-1 ring-white/15" : "bg-pale text-accent",
        )}
      >
        Step {String(index + 1).padStart(2, "0")}
      </span>
      <h3
        className={cn(
          "font-semibold tracking-tight",
          dark ? "text-2xl text-white" : "text-lg text-primary",
        )}
      >
        {step.title}
      </h3>
      <p
        className={cn(
          "text-sm leading-relaxed",
          dark ? "max-w-sm text-white/75" : "text-muted",
        )}
      >
        {step.desc}
      </p>
    </div>
  );
}

/** Icon in a double hairline ring — the features block's signature motif. */
function RingIcon({
  children,
  large = false,
  dark = false,
}: {
  children: React.ReactNode;
  large?: boolean;
  dark?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative flex aspect-square items-center justify-center rounded-full border before:absolute before:-inset-2 before:rounded-full before:border",
        dark
          ? "border-white/20 bg-white/10 text-white before:border-white/10"
          : "border-line text-accent before:border-line/60",
        large
          ? "size-28 bg-gradient-to-b from-white to-pale shadow-lg shadow-accent/10"
          : "size-12",
      )}
    >
      {children}
    </div>
  );
}

/* --------------------------------------------------------------- visuals */

/** Step 1 — a locked house inside a loose hand-drawn loop: private. */
function PrivateVisual() {
  return (
    <div className="relative flex h-24 w-56 items-center justify-center">
      <svg
        className="absolute inset-0 size-full text-accent/15"
        viewBox="0 0 254 104"
        fill="none"
      >
        <path
          d="M112.891 97.7022C140.366 97.0802 171.004 94.6715 201.087 87.5116C210.43 85.2881 219.615 82.6412 228.284 78.2473C232.198 76.3179 235.905 73.9942 239.348 71.3124C241.85 69.2557 243.954 66.7571 245.555 63.9408C249.34 57.3235 248.281 50.5341 242.498 45.6109C239.033 42.7237 235.228 40.2703 231.169 38.3054C219.443 32.7209 207.141 28.4382 194.482 25.534C184.013 23.1927 173.358 21.7755 162.64 21.2989C161.376 21.3512 160.113 21.181 158.908 20.796C158.034 20.399 156.857 19.1682 156.962 18.4535C157.115 17.8927 157.381 17.3689 157.743 16.9139C158.104 16.4588 158.555 16.0821 159.067 15.8066C160.14 15.4683 161.274 15.3733 162.389 15.5286C179.805 15.3566 196.626 18.8373 212.998 24.462C220.978 27.2494 228.798 30.4747 236.423 34.1232C240.476 36.1159 244.202 38.7131 247.474 41.8258C254.342 48.2578 255.745 56.9397 251.841 65.4892C249.793 69.8582 246.736 73.6777 242.921 76.6327C236.224 82.0192 228.522 85.4602 220.502 88.2924C205.017 93.7847 188.964 96.9081 172.738 99.2109C153.442 101.949 133.993 103.478 114.506 103.79C91.1468 104.161 67.9334 102.97 45.1169 97.5831C36.0094 95.5616 27.2626 92.1655 19.1771 87.5116C13.839 84.5746 9.1557 80.5802 5.41318 75.7725C-0.54238 67.7259 -1.13794 59.1763 3.25594 50.2827C5.82447 45.3918 9.29572 41.0315 13.4863 37.4319C24.2989 27.5721 37.0438 20.9681 50.5431 15.7272C68.1451 8.8849 86.4883 5.1395 105.175 2.83669C129.045 0.0992292 153.151 0.134761 177.013 2.94256C197.672 5.23215 218.04 9.01724 237.588 16.3889C240.089 17.3418 242.498 18.5197 244.933 19.6446C246.627 20.4387 247.725 21.6695 246.997 23.615C246.455 25.1105 244.814 25.5605 242.63 24.5811C230.322 18.9961 217.233 16.1904 204.117 13.4376C188.761 10.3438 173.2 8.36665 157.558 7.52174C129.914 5.70776 102.154 8.06792 75.2124 14.5228C60.6177 17.8788 46.5758 23.2977 33.5102 30.6161C26.6595 34.3329 20.4123 39.0673 14.9818 44.658C12.9433 46.8071 11.1336 49.1622 9.58207 51.6855C4.87056 59.5336 5.61172 67.2494 11.9246 73.7608C15.2064 77.0494 18.8775 79.925 22.8564 82.3236C31.6176 87.7101 41.3848 90.5291 51.3902 92.5804C70.6068 96.5773 90.0219 97.7419 112.891 97.7022Z"
          fill="currentColor"
        />
      </svg>
      <div className="relative flex size-16 items-center justify-center rounded-2xl bg-white text-accent shadow-lg shadow-accent/15 ring-1 ring-line">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-7 w-7"
        >
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
        </svg>
        <span className="absolute -right-2 -bottom-2 flex size-7 items-center justify-center rounded-full bg-accent text-white ring-4 ring-white">
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z" />
          </svg>
        </span>
      </div>
    </div>
  );
}

/** Step 2 — proposals fan out behind one chosen, ticked mandate. */
function MandateVisual() {
  return (
    <div className="relative flex items-center justify-center">
      <span className="absolute h-24 w-20 -translate-x-12 -rotate-12 rounded-xl border border-white bg-white/70 shadow-sm" />
      <span className="absolute h-24 w-20 translate-x-12 rotate-12 rounded-xl border border-white bg-white/70 shadow-sm" />
      <RingIcon large>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-10 w-10"
        >
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
          <path d="M14 3v5h5" />
          <path d="m9 14 2 2 4-4" />
        </svg>
      </RingIcon>
    </div>
  );
}

/** Step 3 — a works tracker: done, in progress, to come. */
function WorksVisual() {
  const rows = [
    { fill: "w-full", done: true },
    { fill: "w-3/5", done: false },
    { fill: "w-0", done: false },
  ];
  return (
    <div className="relative w-60 max-w-full rounded-2xl border border-line bg-white p-4 pt-8 shadow-lg shadow-accent/10">
      <div className="absolute top-3 left-3.5 flex gap-1">
        <span className="block size-2 rounded-full border border-line" />
        <span className="block size-2 rounded-full border border-line" />
        <span className="block size-2 rounded-full border border-line" />
      </div>
      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-3">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full",
                row.done ? "bg-accent text-white" : "border border-line",
              )}
            >
              {row.done && (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3 w-3"
                >
                  <path d="m5 12 5 5 9-10" />
                </svg>
              )}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
              <span
                className={cn(
                  "block h-full rounded-full bg-gradient-to-r from-accent to-intel",
                  row.fill,
                )}
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Step 4 — the whole chain, ending (highlighted) at the Buyer. */
function Chain({ roles }: { roles: string[] }) {
  return (
    <div
      aria-hidden
      className="relative min-w-0 rounded-2xl bg-white/[0.06] px-2 py-8 ring-1 ring-white/10 backdrop-blur-sm sm:px-8"
    >
      {/* Connector runs through the centre of the numbered circles (py-8 + half of size-11). */}
      <div className="absolute top-[54px] right-8 left-8 h-px bg-gradient-to-r from-white/15 via-white/40 to-white sm:right-14 sm:left-14" />
      <div className="relative flex items-center justify-between gap-2">
        {roles.map((role, i) => {
          const isLast = i === roles.length - 1;
          return (
            <div key={role} className="flex flex-col items-center gap-2">
              <span
                className={cn(
                  "flex size-11 items-center justify-center rounded-full text-sm font-semibold",
                  isLast
                    ? "bg-white text-accent shadow-lg shadow-white/20 ring-4 ring-white/15"
                    : "bg-brand text-white ring-1 ring-white/25",
                )}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                className={cn(
                  "rounded-full border px-2 py-1 text-[11px] font-medium sm:px-2.5 sm:text-xs",
                  isLast
                    ? "border-white bg-white text-accent"
                    : "border-white/15 bg-white/5 text-white/80",
                )}
              >
                {role}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
