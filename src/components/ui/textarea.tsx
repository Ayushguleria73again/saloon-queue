import { forwardRef, useId, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/formatters";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, hint, id, className, rows = 3, ...rest },
  ref,
) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const errorId = `${textareaId}-error`;
  const hintId = `${textareaId}-hint`;

  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1.5">
      {label ? (
        <label htmlFor={textareaId} className="block text-sm font-medium text-ink">
          {label}
        </label>
      ) : null}

      <textarea
        ref={ref}
        id={textareaId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "w-full rounded-control border bg-surface px-3.5 py-2.5 text-base text-ink placeholder:text-ink-secondary/60 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60",
          error
            ? "border-status-cancelled-fg focus:ring-status-cancelled-fg/20"
            : "border-subtle focus:border-brand-primary focus:ring-brand-primary/20",
          className,
        )}
        {...rest}
      />

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
