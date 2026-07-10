import * as TabsPrimitive from '@radix-ui/react-tabs';
import { m } from 'motion/react';
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useState,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from 'react';
import { cn } from '../../lib/cn';
import { springTransition, useReducedMotion } from '../../lib/motion';

interface TabsHighlightContextValue {
  /** Currently active tab value, mirrored locally so triggers can render the sliding pill. */
  activeValue: string | undefined;
  /** Shared `layoutId` namespace so the highlight animates between triggers of the same `Tabs` instance. */
  highlightId: string;
}

const TabsHighlightContext = createContext<TabsHighlightContextValue | undefined>(undefined);

export const Tabs = forwardRef<
  ElementRef<typeof TabsPrimitive.Root>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>(({ value, defaultValue, onValueChange, ...props }, ref) => {
  const highlightId = useId();
  const [activeValue, setActiveValue] = useState(value ?? defaultValue);

  useEffect(() => {
    if (value !== undefined) setActiveValue(value);
  }, [value]);

  const handleValueChange = (next: string) => {
    if (value === undefined) setActiveValue(next);
    onValueChange?.(next);
  };

  return (
    <TabsHighlightContext.Provider value={{ activeValue, highlightId }}>
      <TabsPrimitive.Root
        ref={ref}
        value={value}
        defaultValue={defaultValue}
        onValueChange={handleValueChange}
        {...props}
      />
    </TabsHighlightContext.Provider>
  );
});
Tabs.displayName = 'Tabs';

export const TabsList = forwardRef<
  ElementRef<typeof TabsPrimitive.List>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('inline-flex rounded-lg bg-surface-raised p-0.5', className)}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, children, value, ...props }, ref) => {
  const context = useContext(TabsHighlightContext);
  const reducedMotion = useReducedMotion();
  const checked = context?.activeValue === value;

  return (
    <TabsPrimitive.Trigger
      ref={ref}
      value={value}
      className={cn(
        'relative rounded-md px-3 py-1.5 text-sm text-text-muted transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'data-[state=active]:text-text',
        reducedMotion && 'data-[state=active]:bg-surface data-[state=active]:shadow-sm',
        className,
      )}
      {...props}
    >
      {checked && !reducedMotion && context && (
        <m.span
          layoutId={`tabs-highlight-${context.highlightId}`}
          className="absolute inset-0 -z-10 rounded-md bg-surface shadow-sm"
          transition={springTransition}
        />
      )}
      <span className="relative z-10">{children}</span>
    </TabsPrimitive.Trigger>
  );
});
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = 'TabsContent';
