import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { IconButton } from '../../../../components/ui/icon-button';
import { cn } from '../../../../lib/cn';

/** A Copy icon-button that briefly flips to a check mark — shared by the settings panels. */
export function CopyIconButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };
  return (
    <IconButton
      variant="secondary"
      size="sm"
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      onClick={handleCopy}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </IconButton>
  );
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}

/** The read-only credential presentation used across the settings panels. */
export function CodeChip({ value, className }: { value: string; className?: string }) {
  return (
    <code className={cn('break-all rounded-lg bg-surface-raised px-3 py-2 font-mono text-xs', className)}>
      {value}
    </code>
  );
}

/**
 * One labelled setting: name and helper text on the left, the control flush right. Rows stack into
 * a full-width list instead of a half-empty column — the reason the panels are single-column now.
 */
export function SettingRow({
  label,
  hint,
  htmlFor,
  children,
  ...rest
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** Renders the label as a `<label>` for the given control id. */
  htmlFor?: string;
  children: ReactNode;
  role?: string;
  'aria-label'?: string;
}) {
  const Text = htmlFor ? 'label' : 'span';
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4 first:pt-0 last:pb-0"
      {...rest}
    >
      <div className="min-w-0 max-w-xl">
        <Text htmlFor={htmlFor} className="block text-sm font-medium">
          {label}
        </Text>
        {hint && <p className="mt-0.5 text-sm text-text-muted">{hint}</p>}
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/** Vertical stack of `SettingRow`s with hairlines between them. */
export function SettingRows({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-border">{children}</div>;
}
