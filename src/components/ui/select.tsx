import { cn } from "@/lib/cn";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: SelectOption[];
  placeholder?: string;
}

export function Select({
  label,
  options,
  placeholder,
  id,
  className,
  ...props
}: SelectProps) {
  return (
    <div>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-body">
          {label}
        </label>
      )}
      <select
        id={id}
        className={cn(
          "mt-1.5 w-full rounded-xl border border-line bg-white px-4 py-2.5 text-sm text-primary transition-colors focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/20",
          className,
        )}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
