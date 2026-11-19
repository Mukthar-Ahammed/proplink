"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";

export interface DropdownOption {
  value: string;
  label: string;
}

/**
 * A styled single-select (ADR-071) for places where the native `<select>`
 * popup clashes with the rounded UI — the buyer search bar's sort, type and
 * bedrooms. Follows the WAI-ARIA "select-only combobox" pattern: a button with
 * `aria-haspopup="listbox"` opens a listbox that takes focus and handles
 * ↑/↓/Home/End/Enter/Space/Escape/Tab; clicking outside closes it.
 *
 * Forms that need a native control (or `selectOption` in tests) keep using
 * `<Select>`.
 */
export function Dropdown({
  id,
  label,
  hideLabel = false,
  prefix,
  options,
  value,
  onChange,
  className,
  align = "left",
}: {
  id: string;
  label: string;
  /** Keep the label for assistive tech only (e.g. "Sort by" on the bar). */
  hideLabel?: boolean;
  /** Muted text inside the button before the value, e.g. "Sort:". */
  prefix?: string;
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const labelId = useId();
  const listId = useId();
  const reduceMotion = useReducedMotion();

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const selected = options[selectedIndex];

  function openList() {
    setActive(selectedIndex);
    setOpen(true);
  }

  function close(focusButton = true) {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  }

  function choose(index: number) {
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
    close();
  }

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function onListKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(options.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(active);
        break;
      case "Escape":
        // Stop here so an enclosing panel's Escape handler doesn't also close.
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case "Tab":
        close(false);
        break;
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <span
        id={labelId}
        className={cn(
          hideLabel ? "sr-only" : "mb-1.5 block text-sm font-medium text-body",
        )}
      >
        {label}
      </span>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={`${labelId} ${id}`}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(e) => {
          if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
            e.preventDefault();
            openList();
          }
        }}
        className={cn(
          "flex h-12 w-full items-center gap-1.5 rounded-full border bg-white pr-4 pl-5 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
          open ? "border-accent" : "border-line hover:border-accent",
        )}
      >
        {prefix ? <span className="text-muted">{prefix}</span> : null}
        <span className="min-w-0 flex-1 truncate font-semibold text-primary">
          {selected?.label}
        </span>
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          fill="none"
          className={cn(
            "size-3.5 shrink-0 text-muted transition-transform",
            open && "rotate-180",
          )}
        >
          <path
            d="m5 8 5 5 5-5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={labelId}
            aria-activedescendant={`${listId}-${active}`}
            onKeyDown={onListKeyDown}
            initial={reduceMotion ? false : { opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className={cn(
              "absolute top-full z-30 mt-2 max-h-72 min-w-full overflow-y-auto rounded-2xl border border-line bg-white p-1.5 shadow-xl shadow-primary/10 focus:outline-none",
              align === "right" ? "right-0 origin-top-right" : "left-0 origin-top-left",
            )}
          >
            {options.map((option, index) => {
              const isSelected = option.value === value;
              return (
                <li
                  key={option.value}
                  id={`${listId}-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={isSelected}
                  onPointerEnter={() => setActive(index)}
                  onClick={() => choose(index)}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-4 rounded-xl px-3.5 py-2.5 text-sm whitespace-nowrap transition-colors",
                    index === active ? "bg-surface" : "",
                    isSelected ? "font-semibold text-accent" : "text-primary",
                  )}
                >
                  {option.label}
                  <svg
                    aria-hidden
                    viewBox="0 0 20 20"
                    fill="none"
                    className={cn("size-4 shrink-0", isSelected ? "" : "invisible")}
                  >
                    <path
                      d="m4.5 10.5 3.5 3.5 7.5-8"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </li>
              );
            })}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
