import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export const GradientText = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn('text-gradient-brand font-display font-semibold', className)}
      {...props}
    />
  ),
);
GradientText.displayName = 'GradientText';
