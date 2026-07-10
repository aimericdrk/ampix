import * as ToastPrimitive from '@radix-ui/react-toast';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: 'default' | 'error';
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextToastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((options: ToastOptions) => {
    nextToastId += 1;
    const id = nextToastId;
    setToasts((current) => [...current, { ...options, id }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      <ToastPrimitive.Provider swipeDirection="right" duration={5000}>
        {children}
        {toasts.map((item) => (
          <ToastPrimitive.Root
            key={item.id}
            onOpenChange={(open) => {
              if (!open) dismiss(item.id);
            }}
            className={cn(
              'relative flex flex-col gap-1 overflow-hidden rounded-xl border border-border bg-surface-raised py-3 pl-4 pr-4 shadow-lift',
              'before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:content-[""]',
              item.variant === 'error' ? 'before:bg-danger' : 'before:bg-accent',
              'data-[state=open]:animate-[slide-in-right_250ms_var(--ease-out-expo)]',
              'data-[state=closed]:animate-[slide-in-right_200ms_ease-in_reverse]',
              'data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]',
              'data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-transform',
              'data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)]',
            )}
          >
            <ToastPrimitive.Title className="text-sm font-medium">
              {item.title}
            </ToastPrimitive.Title>
            {item.description && (
              <ToastPrimitive.Description className="mt-1 text-sm text-text-muted">
                {item.description}
              </ToastPrimitive.Description>
            )}
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
