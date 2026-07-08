import { useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { useCloseComboboxOnOutsideClick } from '../../../components/ui/combobox';
import { Input } from '../../../components/ui/input';
import type { AddAnnotationInput, Annotation } from '../annotations';
import { defaultDate } from './builder-controls';

export interface AnnotationsManagerProps {
  annotations: Annotation[];
  onAdd: (input: AddAnnotationInput) => void;
  onRemove: (id: string) => void;
}

/**
 * The "Notes" popover host for a project's chart annotations (feat-08 §3): a small button that
 * reveals a panel listing every stored annotation, with an inline add form (date + label, reusing
 * `DateRangeFields`'s date input + `Input` + `Button`) and a delete action per note. Built on the
 * same click-to-open + outside-click-to-close primitives as `FilterValueInput`'s suggestion
 * dropdown — no new dependency.
 *
 * Takes `annotations`/`onAdd`/`onRemove` rather than owning its own `useAnnotations(projectId)`
 * call: a page hosting this alongside a `ComparisonTrend` (feat-08 §3 "one shared set per project
 * shows on all trend charts") needs the manager's edits to show up on that same chart immediately
 * — two independent hook instances would each keep their own React state and only agree after a
 * remount, since `useAnnotations` isn't backed by a shared store. Passing down the single
 * `useAnnotations(projectId)` instance from the host page keeps both in sync for free.
 */
export function AnnotationsManager({ annotations, onAdd, onRemove }: AnnotationsManagerProps) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => defaultDate(0));
  const [label, setLabel] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useCloseComboboxOnOutsideClick(containerRef, open, () => setOpen(false));

  const handleAdd = (event: FormEvent) => {
    event.preventDefault();
    if (!label.trim()) return;
    onAdd({ date, label });
    setLabel('');
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        Notes{annotations.length > 0 ? ` (${annotations.length})` : ''}
      </Button>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Chart annotations"
          className="absolute right-0 top-full z-30 mt-2 w-72 rounded-lg border border-border bg-surface p-3 shadow-lg"
        >
          <form onSubmit={handleAdd} className="flex flex-col gap-2">
            <div className="flex gap-2">
              <div>
                <label htmlFor={`${panelId}-date`} className="sr-only">
                  Note date
                </label>
                <Input
                  id={`${panelId}-date`}
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-36"
                />
              </div>
              <div className="flex-1">
                <label htmlFor={`${panelId}-label`} className="sr-only">
                  Note label
                </label>
                <Input
                  id={`${panelId}-label`}
                  placeholder="e.g. v1.4 release"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
            </div>
            <Button type="submit" variant="secondary" size="sm" disabled={!label.trim()}>
              Add note
            </Button>
          </form>

          <ul className="mt-3 flex max-h-48 flex-col gap-1 overflow-y-auto text-sm">
            {annotations.length === 0 && <li className="text-text-muted">No notes yet.</li>}
            {annotations.map((annotation) => (
              <li
                key={annotation.id}
                className="flex items-center justify-between gap-2 border-t border-border py-1.5 first:border-t-0"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-text">{annotation.date}</span>{' '}
                  <span className="text-text-muted">{annotation.label}</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${annotation.label}`}
                  onClick={() => onRemove(annotation.id)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
