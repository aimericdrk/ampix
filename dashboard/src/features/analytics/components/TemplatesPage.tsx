import { useParams, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { PageShell } from '../../../components/layout/PageShell';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { useToast } from '../../../components/ui/toast';
import { ApiError } from '../../../lib/api/problem';
import type { ReportKind, TemplateId, TemplateKindCounts } from '../../../lib/api/types';
import { useApplyTemplate, useTemplates } from '../api';

const KIND_LABELS: Record<ReportKind, { one: string; many: string }> = {
  insights: { one: 'insight', many: 'insights' },
  funnel: { one: 'funnel', many: 'funnels' },
  retention: { one: 'retention report', many: 'retention reports' },
  flows: { one: 'paths report', many: 'paths reports' },
};

function kindChips(counts: TemplateKindCounts): string[] {
  return (Object.entries(counts) as [ReportKind, number][])
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${n} ${n === 1 ? KIND_LABELS[kind].one : KIND_LABELS[kind].many}`);
}

/**
 * The templates gallery (contracts §19). A card per fixed catalog entry; "Apply" materializes the
 * bundle as real reports + a dashboard server-side and jumps straight to the new dashboard.
 */
export function TemplatesPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/templates' });
  const navigate = useNavigate();
  const { toast } = useToast();
  const templates = useTemplates();
  const applyTemplate = useApplyTemplate(projectId);
  const [applyingId, setApplyingId] = useState<TemplateId | null>(null);

  const handleApply = (templateId: TemplateId) => {
    setApplyingId(templateId);
    applyTemplate.mutate(templateId, {
      onSuccess: ({ dashboard_id }) => {
        setApplyingId(null);
        toast({ title: 'Template applied' });
        void navigate({
          to: '/projects/$projectId/dashboards/$dashboardId',
          params: { projectId, dashboardId: dashboard_id },
        });
      },
      onError: (error) => {
        setApplyingId(null);
        toast({
          title: 'Could not apply template',
          description: error instanceof ApiError ? error.problem.title : 'Something went wrong.',
          variant: 'error',
        });
      },
    });
  };

  return (
    <PageShell
      projectId={projectId}
      title="Templates"
      description="Start from a ready-made analysis. Applying a template creates its reports and a dashboard in this project."
      breadcrumbs={[{ label: 'Templates' }]}
    >
      {templates.isPending && <p role="status">Loading templates…</p>}
      {templates.isError && (
        <p role="alert" className="text-danger">
          {templates.error instanceof ApiError
            ? templates.error.problem.title
            : 'Failed to load templates'}
        </p>
      )}

      {templates.data && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.data.templates.map((template) => {
            const isApplying = applyingId === template.id;
            const chips = kindChips(template.kind_counts);
            return (
              <li key={template.id}>
                <Card className="flex h-full flex-col">
                  <CardHeader>
                    <CardTitle>{template.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-4">
                    <p className="flex-1 text-sm text-text-muted">{template.description}</p>
                    {chips.length > 0 && (
                      <ul className="flex flex-wrap gap-1.5" aria-label={`${template.name} contents`}>
                        {chips.map((chip) => (
                          <li
                            key={chip}
                            className="rounded-full border border-border bg-bg px-2 py-0.5 text-xs text-text-muted"
                          >
                            {chip}
                          </li>
                        ))}
                      </ul>
                    )}
                    <Button
                      className="w-full"
                      disabled={applyTemplate.isPending}
                      onClick={() => handleApply(template.id)}
                    >
                      {isApplying ? 'Applying…' : 'Apply'}
                    </Button>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
