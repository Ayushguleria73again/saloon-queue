import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/formatters";

export interface InputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "prefix"
> {
  label?: string;
  error?: string;
  hint?: string;
  prefix?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, prefix, id, className, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1.5">
      {label ? (
        <label htmlFor={inputId} className="block text-sm font-medium text-ink">
          {label}
        </label>
      ) : null}

      <div
        className={cn(
          "flex min-h-12 items-center overflow-hidden rounded-control border bg-surface transition focus-within:ring-2",
          error
            ? "border-status-cancelled-fg focus-within:ring-status-cancelled-fg/20"
            : "border-subtle focus-within:border-brand-primary focus-within:ring-brand-primary/20",
        )}
      >
        {prefix ? (
          <span className="flex min-h-12 items-center border-r border-subtle bg-muted px-3.5 text-base font-medium text-ink-secondary">
            {prefix}
          </span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "min-h-12 w-full bg-transparent px-3.5 py-2.5 text-base text-ink placeholder:text-ink-secondary/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60",
            className,
          )}
          {...rest}
        />
      </div>

      {hint && !error ? (
        <p id={hintId} className="text-xs text-ink-secondary">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-xs font-medium text-status-cancelled-fg"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
});
