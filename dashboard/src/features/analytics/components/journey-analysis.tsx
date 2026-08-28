import { Check, Copy, Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Skeleton } from '../../../components/ui/Skeleton';
import { useToast } from '../../../components/ui/toast';
import type {
  JourneyAnalysisResponse,
  JourneyOutcome,
  JourneyResponse,
} from '../../../lib/api/types';

function payloadFilename(outcome: JourneyOutcome, report: JourneyResponse): string {
  const { from, to } = report.definition.date_range;
  return `journey-${outcome}-${from}-to-${to}.json`;
}

/**
 * Hands the report to whatever AI the user actually uses.
 *
 * The endpoint is fetchable by an agent holding a bearer token, but the far more common case is
 * someone pasting the report into a chat they already have open — and the payload is right here in
 * the browser, so making them re-fetch it with credentials would be pure ceremony. The JSON is the
 * byte-for-byte response body, self-describing by construction, so whatever reads it gets the units
 * and cohort definitions along with the numbers.
 */
export function JourneyPayloadActions({
  report,
  outcome,
}: {
  report: JourneyResponse;
  outcome: JourneyOutcome;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(report, null, 2);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      // Reverts to the idle label on its own; a permanently "Copied" button reads as broken.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Couldn't copy to the clipboard", variant: 'error' });
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = payloadFilename(outcome, report);
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={copy}>
        {copied ? <Check aria-hidden="true" size={14} /> : <Copy aria-hidden="true" size={14} />}
        {copied ? 'Copied' : 'Copy JSON'}
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={download}>
        <Download aria-hidden="true" size={14} />
        Download
      </Button>
    </>
  );
}

/**
 * The model's findings. Each one shows the figures it rests on, because the failure mode of an LLM
 * reading a statistics table is a fluent claim the numbers do not support — with the evidence
 * printed beside the claim, a reader can check it against the tables above without re-deriving
 * anything.
 */
export function JourneyAnalysisPanel({
  analysis,
  pending,
  outcome,
}: {
  analysis: JourneyAnalysisResponse | undefined;
  pending: boolean;
  outcome: JourneyOutcome;
}) {
  if (pending) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label="Analysing the journey">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (!analysis) {
    return (
      <p className="text-sm text-text-muted">
        Nothing analysed yet. &ldquo;Analyse&rdquo; sends the report above to the model and shows
        what it finds; &ldquo;Copy JSON&rdquo; hands the identical payload to your own AI instead.
      </p>
    );
  }

  // The analysis is fetched per outcome; if the toggle moved after it returned, saying so is more
  // honest than silently captioning stale findings with the new cohort's name.
  const stale = analysis.outcome !== outcome;

  return (
    <div className="flex flex-col gap-4">
      {stale && (
        <p role="status" className="text-xs text-text-muted">
          These findings are for the {analysis.outcome} cohort. Run the analysis again for the
          current selection.
        </p>
      )}

      <p className="text-base font-medium">{analysis.headline}</p>

      <ol className="flex flex-col gap-3">
        {analysis.findings.map((finding, index) => (
          <li
            key={`${finding.title}-${index}`}
            className="rounded-lg border border-border bg-surface-raised p-3"
          >
            <h3 className="text-sm font-semibold">{finding.title}</h3>
            <p className="mt-1 text-sm text-text-muted">{finding.detail}</p>
            {finding.evidence.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {finding.evidence.map((item, evidenceIndex) => (
                  <li
                    key={`${item}-${evidenceIndex}`}
                    className="rounded-md bg-surface px-2 py-0.5 text-xs tabular-nums text-text-muted"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>

      {analysis.caveats.length > 0 && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-text-muted">Caveats</h3>
          <ul className="mt-1 list-disc pl-5 text-sm text-text-muted">
            {analysis.caveats.map((caveat, index) => (
              <li key={`${caveat}-${index}`}>{caveat}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
