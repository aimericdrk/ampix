import * as SliderPrimitive from '@radix-ui/react-slider';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '../../lib/cn';

export const Slider = forwardRef<
  ElementRef<typeof SliderPrimitive.Root>,
  ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, value, defaultValue, ...props }, ref) => {
  const thumbCount = (value ?? defaultValue ?? [0]).length;

  return (
    <SliderPrimitive.Root
      ref={ref}
      value={value}
      defaultValue={defaultValue}
      className={cn('relative flex w-full touch-none select-none items-center', className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-surface-raised">
        <SliderPrimitive.Range className="absolute h-full bg-accent" />
      </SliderPrimitive.Track>
      {Array.from({ length: thumbCount }).map((_, index) => (
        <SliderPrimitive.Thumb
          key={index}
          className={cn(
            'block size-4 rounded-full border-2 border-accent bg-surface shadow transition-colors',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );
});
Slider.displayName = 'Slider';
