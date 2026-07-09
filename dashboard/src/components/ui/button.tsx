import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium',
    'transition-all duration-150 active:scale-[0.98]',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    'disabled:pointer-events-none disabled:opacity-50',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-gradient-brand text-white shadow-sm hover:shadow-glow hover:brightness-110',
        secondary:
          'border border-border bg-surface text-text hover:border-border-strong hover:bg-surface-raised',
        ghost: 'text-text-muted hover:bg-accent-soft hover:text-text',
        danger: 'bg-danger text-white hover:brightness-110 hover:shadow-[0_4px_16px_-4px_var(--danger)]',
      },
      size: { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';
