"use client";

import { useFormStatus } from "react-dom";

import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui/spinner";

export interface SubmitButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Text shown while the form is submitting; defaults to the normal children. */
  pendingLabel?: React.ReactNode;
}

/**
 * A submit button that shows a spinner while its form is submitting
 * (ADR-077). It reads the parent form's status with `useFormStatus`, so it
 * works inside plain server-component forms (`<form action={serverAction}>`)
 * and `next/form` GET forms alike — no client wrapper needed around the form.
 *
 * Every button in the form is disabled while it submits, so nothing is sent
 * twice. When a form has several named buttons (`name`/`value`), only the one
 * that was pressed shows the spinner — the browser puts the submitter's
 * name/value in the submitted form data.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className,
  disabled,
  name,
  value,
  ...props
}: SubmitButtonProps) {
  const { pending, data } = useFormStatus();
  const pressed =
    pending &&
    (name === undefined || data === null || data.get(name) === String(value ?? ""));
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={disabled || pending}
      aria-busy={pressed || undefined}
      className={cn("inline-flex items-center justify-center gap-2", className)}
      {...props}
    >
      {pressed && <Spinner size="sm" />}
      {pressed && pendingLabel !== undefined ? pendingLabel : children}
    </button>
  );
}
