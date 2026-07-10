import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';
import { fieldLook } from './input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(fieldLook, 'h-auto min-h-20 w-full resize-y py-2 text-text', className)}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
