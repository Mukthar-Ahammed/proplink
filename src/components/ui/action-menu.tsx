"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

export type ActionMenuItem = {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  tone?: "default" | "danger";
};

/**
 * A small "more actions" menu (WAI-ARIA menu button): the trigger opens a
 * list of actions; ↑/↓/Home/End move, Enter/Space choose, Escape or a click
 * outside closes and returns focus to the trigger.
 */
export function ActionMenu({
  label,
  items,
  trigger,
  align = "right",
  triggerClassName,
}: {
  /** Accessible name of the trigger, e.g. "Chat actions". */
  label: string;
  items: ActionMenuItem[];
  /** Icon shown in the trigger. */
  trigger: ReactNode;
  align?: "left" | "right";
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  function close(focusTrigger = true) {
    setOpen(false);
    if (focusTrigger) buttonRef.current?.focus();
  }

  function focusItem(index: number) {
    const nodes =
      rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    if (!nodes || nodes.length === 0) return;
    nodes[(index + nodes.length) % nodes.length]?.focus();
  }

  useEffect(() => {
    if (!open) return;
    focusItem(0);
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function onMenuKeyDown(event: React.KeyboardEvent) {
    const nodes = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    const current = nodes.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") focusItem(current + 1);
    else if (event.key === "ArrowUp") focusItem(current - 1);
    else if (event.key === "Home") focusItem(0);
    else if (event.key === "End") focusItem(nodes.length - 1);
    else if (event.key === "Escape") close();
    else if (event.key === "Tab") setOpen(false);
    else return;
    if (event.key !== "Tab") event.preventDefault();
  }

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "inline-flex items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          triggerClassName ?? "h-9 w-9 border border-line bg-white",
        )}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={cn(
            "absolute top-full z-30 mt-1 min-w-44 rounded-xl border border-line bg-white p-1 shadow-lg",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close();
                item.onSelect();
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium hover:bg-surface focus:bg-surface focus:outline-none",
                item.tone === "danger" ? "text-danger" : "text-body",
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
