import { useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../../../components/ui/dialog';
import { fieldLook, Input } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toast';
import { cn } from '../../../lib/cn';
import { ApiError } from '../../../lib/api/problem';
import type { AnalysisDefinition, CreateReportRequest, ReportKind } from '../../../lib/api/types';
import { useCohorts, useCreateReport } from '../api';

const KIND_LABELS: Record<ReportKind, string> = {
  insights: 'Insights',
  funnel: 'Funnel',
  retention: 'Retention',
  flows: 'Flows',
  experiment: 'Experiment',
};

/**
 * "Save current view as report" — the builder's current query-definition state IS the saved
 * `definition` (contracts §16). Opens a small dialog to name the report, then POSTs it.
 */
export function SaveAsReportButton({
  projectId,
  kind,
  definition,
  disabled,
}: {
  projectId: string;
  kind: ReportKind;
  definition: AnalysisDefinition;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" disabled={disabled}>
          Save as report
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Save as report</DialogTitle>
        <DialogDescription>
          Saves this {KIND_LABELS[kind].toLowerCase()} view so you can re-run it or add it to a
          dashboard.
        </DialogDescription>
        <SaveReportForm
          projectId={projectId}
          kind={kind}
          definition={definition}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function SaveReportForm({
  projectId,
  kind,
  definition,
  onSaved,
}: {
  projectId: string;
  kind: ReportKind;
  definition: AnalysisDefinition;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const createReport = useCreateReport(projectId);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    // kind and definition are correlated by the caller; the union can't be inferred from the generic
    // AnalysisDefinition, so we assert the discriminated CreateReportRequest shape here.
    const body = { name: name.trim(), kind, definition } as CreateReportRequest;
    createReport.mutate(body, {
      onSuccess: () => {
        toast({ title: 'Report saved' });
        setName('');
        onSaved();
      },
      onError: (error) =>
        toast({
          title: 'Could not save report',
          description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
          variant: 'error',
        }),
    });
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-4">
      <div>
        <label htmlFor="save-report-name" className="mb-1 block text-sm font-medium">
          Report name
        </label>
        <Input
          id="save-report-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Weekly checkouts"
        />
      </div>
      <Button type="submit" className="w-full" disabled={createReport.isPending || !name.trim()}>
        {createReport.isPending ? 'Saving…' : 'Save report'}
      </Button>
    </form>
  );
}

/** A cohort filter dropdown (sets `cohort_id`) for the Insights / Funnels / Retention builders. */
export function CohortSelect({
  projectId,
  value,
  onChange,
  id = 'cohort-filter',
  label = 'Cohort filter (optional)',
}: {
  projectId: string;
  value: string;
  onChange: (cohortId: string) => void;
  id?: string;
  label?: string;
}) {
  const cohorts = useCohorts(projectId);

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(fieldLook, 'w-auto')}
      >
        <option value="">All users (no cohort)</option>
        {(cohorts.data?.cohorts ?? []).map((cohort) => (
          <option key={cohort.id} value={cohort.id}>
            {cohort.name}
          </option>
        ))}
      </select>
    </div>
  );
}
