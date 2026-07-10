import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/** Shared field look for Input, Textarea, and the Select/Combobox triggers. */
export const fieldLook = cn(
  'h-10 rounded-lg border border-border bg-surface px-3 text-sm transition-colors',
  'placeholder:text-text-muted/60 hover:border-border-strong',
  'focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:outline-none',
  'aria-invalid:border-danger',
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(fieldLook, 'w-full text-text', className)} {...props} />
  ),
);
Input.displayName = 'Input';
