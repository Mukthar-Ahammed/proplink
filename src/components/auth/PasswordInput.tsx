"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/cn";

type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

/**
 * Password field with a show/hide toggle. A drop-in for
 * `<input type="password">`: every prop (id, autoComplete, minLength, value,
 * className...) passes straight through to the input.
 *
 * The toggle is a real `<button type="button">` (never submits the form) with
 * `aria-pressed` and a label that names the action ("Show password" / "Hide
 * password"), so it works by keyboard and screen reader. It keeps focus in the
 * field on mouse click, so the caret is not lost while typing.
 *
 * Animation: the eye "blinks" (squashes shut and opens) on every toggle, the
 * pupil widens while the password is visible, and the slash draws itself across
 * the eye when the password is shown (the icon names the next action: open eye
 * = show, slashed eye = hide). All motion is off under reduced motion.
 */
export function PasswordInput({ className, id, ...props }: PasswordInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);
  // Bumped on each toggle and used as the icon's key, so the blink replays on
  // every click but never runs on first paint.
  const [blinks, setBlinks] = useState(0);

  return (
    <div className="relative">
      <input
        {...props}
        id={inputId}
        type={visible ? "text" : "password"}
        className={cn(className, "pr-12")}
      />
      <button
        type="button"
        aria-controls={inputId}
        aria-pressed={visible}
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setVisible((v) => !v);
          setBlinks((n) => n + 1);
        }}
        // `top: 50% + 3px` offsets half of AUTH_INPUT's `mt-1.5`, so the button
        // centres on the field rather than on the field plus its top margin.
        className="group/eye absolute top-[calc(50%+0.1875rem)] right-1.5 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted transition-colors hover:bg-pale hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <svg
          key={blinks}
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn(
            "h-5 w-5 origin-center transition-transform duration-200 group-hover/eye:scale-110 motion-reduce:transition-none motion-reduce:group-hover/eye:scale-100",
            blinks > 0 && "animate-blink motion-reduce:animate-none",
          )}
        >
          {/* Eye outline */}
          <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
          {/* Pupil: widens while the password is visible. */}
          <circle
            cx="12"
            cy="12"
            r="3"
            className={cn(
              "origin-center transition-transform duration-300 ease-out [transform-box:fill-box] motion-reduce:transition-none",
              visible ? "scale-110" : "scale-90",
            )}
          />
          {/* Slash: drawn across the eye while the password is visible. */}
          <path
            d="M4 4l16 16"
            pathLength={1}
            strokeDasharray={1}
            className={cn(
              "transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none",
              visible ? "[stroke-dashoffset:0]" : "[stroke-dashoffset:1]",
            )}
          />
        </svg>
      </button>
    </div>
  );
}
