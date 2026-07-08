import { forwardRef, useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { IconSparkle } from '../../../components/ui/icons';
import { Input } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toast';
import { ApiError } from '../../../lib/api/problem';
import type { InsightsQueryDefinition } from '../../../lib/api/types';
import { useAskData } from '../api';

const MAX_QUESTION_LENGTH = 500;

/** Friendly copy for the known "Ask your data" failure modes (feat-17 §3.2/§4) — falls back to a
 * generic message for anything else (network error, unexpected 5xx, ...). */
function friendlyAskError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.problem.status === 503) return "AI query isn't set up (no Mistral key)";
    if (error.problem.status === 422 || error.problem.status === 400) {
      return "I couldn't turn that into a query — try rephrasing";
    }
  }
  return 'Something went wrong asking your data — try again';
}

export interface AskBarProps {
  projectId: string;
  /** Called with the validated §14 definition + the original question once the model succeeds. */
  onResult: (definition: InsightsQueryDefinition, question: string) => void;
}

/**
 * "Ask your data" (feat-17 §3.2): a prominent plain-language input on the Insights builder header.
 * Submitting posts the question to `POST /query/ask`; success hands the returned definition back to
 * the caller (which hydrates + runs the normal builder — this component owns no query state of its
 * own), failure surfaces a friendly toast rather than a raw ProblemDetails title.
 */
export const AskBar = forwardRef<HTMLInputElement, AskBarProps>(function AskBar(
  { projectId, onResult },
  ref,
) {
  const [question, setQuestion] = useState('');
  const { toast } = useToast();
  const askData = useAskData(projectId);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || askData.isPending) return;

    askData.mutate(trimmed, {
      onSuccess: (data) => {
        setQuestion('');
        onResult(data.definition, data.question);
      },
      onError: (error) => {
        toast({ title: friendlyAskError(error), variant: 'error' });
      },
    });
  };

  return (
    <form onSubmit={handleSubmit} role="search" className="flex items-center gap-2">
      <div className="relative flex-1">
        <label htmlFor="ask-data-input" className="sr-only">
          Ask your data
        </label>
        <IconSparkle
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <Input
          ref={ref}
          id="ask-data-input"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask your data…"
          disabled={askData.isPending}
          maxLength={MAX_QUESTION_LENGTH}
          className="pl-9"
        />
      </div>
      <Button type="submit" disabled={askData.isPending || trimmedIsEmpty(question)}>
        {askData.isPending ? 'Thinking…' : 'Ask'}
      </Button>
    </form>
  );
});

function trimmedIsEmpty(value: string): boolean {
  return value.trim().length === 0;
}
