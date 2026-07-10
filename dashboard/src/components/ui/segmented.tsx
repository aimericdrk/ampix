import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { m } from 'motion/react';
import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { springTransition, useReducedMotion } from '../../lib/motion';

export interface SegmentedOption {
  value: string;
  label: ReactNode;
}

export interface SegmentedProps {
  options: SegmentedOption[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  'aria-label'?: string;
}

/** Pill-group control built on a role-correct radio-group, with a sliding highlight behind the checked item. */
export function Segmented({ options, value, onValueChange, className, ...rest }: SegmentedProps) {
  const highlightId = useId();
  const reducedMotion = useReducedMotion();

  return (
    <RadioGroupPrimitive.Root
      value={value}
      onValueChange={onValueChange}
      className={cn('inline-flex rounded-lg bg-surface-raised p-0.5', className)}
      {...rest}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <RadioGroupPrimitive.Item
            key={option.value}
            value={option.value}
            className={cn(
              'relative rounded-md px-3 py-1 text-sm text-text-muted transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              'data-[state=checked]:text-text',
              reducedMotion && 'data-[state=checked]:bg-surface data-[state=checked]:shadow-sm',
            )}
          >
            {checked && !reducedMotion && (
              <m.span
                layoutId={`segmented-highlight-${highlightId}`}
                className="absolute inset-0 -z-10 rounded-md bg-surface shadow-sm"
                transition={springTransition}
              />
            )}
            <span className="relative z-10">{option.label}</span>
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}
