"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import { cn } from "@/lib/cn";

export interface LocationMapProps {
  /** Headline on the card, e.g. "12 Example Road, Manchester". */
  location: string;
  /** Shown under the location once expanded, e.g. "53.4808° N, 2.2426° W". */
  coordinates?: string;
  /** Small pill in the collapsed card's corner. */
  status?: string;
  /** Accessible name of the expand control. */
  expandLabel?: string;
  /** The expanded map itself. It fills the card (position it `absolute inset-0`). */
  children: ReactNode;
  className?: string;
}

const COLLAPSED = { width: 288, height: 148 };
const EXPANDED = { width: "100%", height: 340 };

/**
 * Compact location card that tilts toward the pointer and springs open into a
 * full-width map on click (ADR-071; adapted from the owner-supplied
 * "expand-map" component). Changes from that source: project tokens instead of
 * shadcn/emerald colours, the expanded view is real content passed as
 * `children` rather than a drawn street plan, the toggle is a real `<button>`
 * (keyboard and screen-reader operable, with focus handed across on open and
 * close), and the tilt is off when expanded or under `prefers-reduced-motion`.
 */
export function LocationMap({
  location,
  coordinates,
  status = "Live",
  expandLabel = "Show map",
  children,
  className,
}: LocationMapProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const toggled = useRef(false);
  const patternId = useId();
  const reduceMotion = useReducedMotion();

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const rotateX = useSpring(useTransform(mouseY, [-50, 50], [8, -8]), {
    stiffness: 300,
    damping: 30,
  });
  const rotateY = useSpring(useTransform(mouseX, [-50, 50], [-8, 8]), {
    stiffness: 300,
    damping: 30,
  });

  const tilt = !isExpanded && !reduceMotion;

  // Move focus to whichever control replaced the one just pressed.
  useEffect(() => {
    if (!toggled.current) return;
    (isExpanded ? collapseRef : expandRef).current?.focus();
  }, [isExpanded]);

  const toggle = (next: boolean) => {
    toggled.current = true;
    mouseX.set(0);
    mouseY.set(0);
    setIsExpanded(next);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!tilt || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    mouseX.set(e.clientX - (rect.left + rect.width / 2));
    mouseY.set(e.clientY - (rect.top + rect.height / 2));
  };

  const handleMouseLeave = () => {
    mouseX.set(0);
    mouseY.set(0);
    setIsHovered(false);
  };

  const spring = reduceMotion
    ? { duration: 0 }
    : ({ type: "spring", stiffness: 400, damping: 35 } as const);

  return (
    <div
      ref={containerRef}
      className={cn("relative pb-6 select-none", className)}
      style={{ perspective: 1000 }}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
    >
      <motion.div
        className="relative max-w-full overflow-hidden rounded-3xl border border-line bg-white"
        style={{
          rotateX: tilt ? rotateX : 0,
          rotateY: tilt ? rotateY : 0,
          transformStyle: "preserve-3d",
        }}
        initial={false}
        animate={isExpanded ? EXPANDED : COLLAPSED}
        transition={spring}
      >
        {/* Soft wash + faint grid while collapsed. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-pale/60 via-transparent to-surface"
        />
        <motion.svg
          aria-hidden
          className="absolute inset-0 h-full w-full text-primary"
          initial={false}
          animate={{ opacity: isExpanded ? 0 : 0.06 }}
          transition={{ duration: 0.3 }}
        >
          <defs>
            <pattern id={patternId} width="20" height="20" patternUnits="userSpaceOnUse">
              <path
                d="M 20 0 L 0 0 0 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.5"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${patternId})`} />
        </motion.svg>

        {/* Expanded map content. */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              className="absolute inset-0"
              initial={{ opacity: 0, scale: reduceMotion ? 1 : 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{
                duration: reduceMotion ? 0 : 0.4,
                delay: reduceMotion ? 0 : 0.1,
              }}
            >
              {children}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-white via-white/70 to-transparent"
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Card content. */}
        <div className="pointer-events-none relative z-10 flex h-full flex-col justify-between p-5">
          <div className="flex items-start justify-between">
            <motion.svg
              aria-hidden
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-accent"
              initial={false}
              animate={{ opacity: isExpanded ? 0 : 1, scale: isHovered ? 1.1 : 1 }}
              transition={{ duration: 0.25 }}
            >
              <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
              <line x1="9" x2="9" y1="3" y2="18" />
              <line x1="15" x2="15" y1="6" y2="21" />
            </motion.svg>

            {!isExpanded && (
              <motion.span
                className="flex items-center gap-1.5 rounded-full bg-pale px-2.5 py-1"
                animate={{ scale: isHovered ? 1.05 : 1 }}
                transition={{ duration: 0.2 }}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                <span className="text-[10px] font-semibold tracking-wide text-accent uppercase">
                  {status}
                </span>
              </motion.span>
            )}
          </div>

          <div className="space-y-1">
            <motion.h3
              className="text-sm font-semibold tracking-tight text-primary"
              animate={{ x: isHovered && !isExpanded ? 4 : 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
            >
              {location}
            </motion.h3>

            <AnimatePresence>
              {isExpanded && coordinates && (
                <motion.p
                  className="font-mono text-xs text-muted"
                  initial={{ opacity: 0, y: -10, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: "auto" }}
                  exit={{ opacity: 0, y: -10, height: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  {coordinates}
                </motion.p>
              )}
            </AnimatePresence>

            <motion.div
              aria-hidden
              className="h-px origin-left bg-gradient-to-r from-accent/60 via-accent/30 to-transparent"
              initial={false}
              animate={{ scaleX: isHovered || isExpanded ? 1 : 0.3 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </div>
        </div>

        {/* Controls sit above the content so the card stays one tab stop. */}
        {isExpanded ? (
          <button
            ref={collapseRef}
            type="button"
            aria-expanded
            aria-label="Collapse map"
            onClick={() => toggle(false)}
            className="absolute top-4 right-4 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-primary shadow-sm backdrop-blur-sm transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              className="h-4 w-4"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        ) : (
          <button
            ref={expandRef}
            type="button"
            aria-expanded={false}
            aria-label={expandLabel}
            onClick={() => toggle(true)}
            className="absolute inset-0 z-20 cursor-pointer rounded-3xl focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
          />
        )}
      </motion.div>

      <motion.p
        aria-hidden
        className="absolute bottom-0 left-36 text-[10px] whitespace-nowrap text-muted"
        style={{ x: "-50%" }}
        initial={false}
        animate={{ opacity: isHovered && !isExpanded ? 1 : 0, y: isHovered ? 0 : 4 }}
        transition={{ duration: 0.2 }}
      >
        Click to expand
      </motion.p>
    </div>
  );
}
