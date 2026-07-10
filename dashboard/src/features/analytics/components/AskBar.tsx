import { Sparkles } from 'lucide-react';
import { forwardRef, useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { fieldLook } from '../../../components/ui/input';
import { useToast } from '../../../components/ui/toast';
import { cn } from '../../../lib/cn';
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
    <form
      onSubmit={handleSubmit}
      role="search"
      className={cn(
        'flex items-center gap-2 rounded-full border border-border bg-overlay p-1.5 pl-4 backdrop-blur-md',
        'transition-colors focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)]',
      )}
    >
      <Sparkles aria-hidden="true" size={16} className="shrink-0 text-accent" />
      <label htmlFor="ask-data-input" className="sr-only">
        Ask your data
      </label>
      <input
        ref={ref}
        id="ask-data-input"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder="Ask your data…"
        disabled={askData.isPending}
        maxLength={MAX_QUESTION_LENGTH}
        className={cn(
          fieldLook,
          'h-8 flex-1 rounded-full border-0 bg-transparent px-1 text-text shadow-none',
          'focus:shadow-none focus:outline-none',
        )}
      />
      <Button
        type="submit"
        size="sm"
        disabled={askData.isPending || trimmedIsEmpty(question)}
        className="rounded-full"
      >
        {askData.isPending ? 'Thinking…' : 'Ask'}
      </Button>
    </form>
  );
});

function trimmedIsEmpty(value: string): boolean {
  return value.trim().length === 0;
}
