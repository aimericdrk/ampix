import { type SVGAttributes } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

export const spinnerVariants = cva('animate-spin text-accent', {
  variants: {
    size: { sm: 'size-4', md: 'size-6' },
  },
  defaultVariants: { size: 'md' },
});

export interface SpinnerProps
  extends Omit<SVGAttributes<SVGSVGElement>, 'size'>,
    VariantProps<typeof spinnerVariants> {}

export function Spinner({ className, size, ...props }: SpinnerProps) {
  return (
    <span role="status" aria-label="Loading">
      <LoaderCircle className={cn(spinnerVariants({ size }), className)} {...props} />
    </span>
  );
}
