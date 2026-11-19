import { cn } from "@/lib/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, id, className, ...props }: InputProps) {
  return (
    <div>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-body">
          {label}
        </label>
      )}
      <input
        id={id}
        className={cn(
          "mt-1.5 w-full rounded-xl border bg-white px-4 py-2.5 text-sm text-primary transition-colors placeholder:text-muted/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/20",
          error ? "border-danger" : "border-line focus:border-accent",
          className,
        )}
        aria-invalid={!!error}
        {...props}
      />
      {error && (
        <p role="alert" className="mt-1 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
