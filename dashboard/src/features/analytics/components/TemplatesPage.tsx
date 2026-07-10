import { useParams, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { PageShell } from '../../../components/layout/PageShell';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Reveal } from '../../../components/ui/reveal';
import { Skeleton } from '../../../components/ui/Skeleton';
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

/** Max Reveal stagger index for a grid of tiles — later tiles all fire together at the cap. */
const MAX_REVEAL_INDEX = 5;

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
      {templates.isPending && (
        <ul
          role="status"
          aria-label="Loading templates"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i}>
              <Card className="flex h-full flex-col">
                <CardHeader>
                  <Skeleton className="h-5 w-2/3" />
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-9 w-full" />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {templates.isError && (
        <p role="alert" className="text-danger">
          {templates.error instanceof ApiError
            ? templates.error.problem.title
            : 'Failed to load templates'}
        </p>
      )}

      {templates.data && (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.data.templates.map((template, index) => {
            const isApplying = applyingId === template.id;
            const chips = kindChips(template.kind_counts);
            return (
              <li key={template.id}>
                <Reveal index={Math.min(index, MAX_REVEAL_INDEX)} className="h-full">
                  <Card className="flex h-full flex-col">
                    <CardHeader>
                      <CardTitle>{template.name}</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col gap-4">
                      <p className="flex-1 text-sm text-text-muted">{template.description}</p>
                      {chips.length > 0 && (
                        <ul className="flex flex-wrap gap-1.5" aria-label={`${template.name} contents`}>
                          {chips.map((chip) => (
                            <li key={chip}>
                              <Badge variant="outline">{chip}</Badge>
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
                </Reveal>
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
