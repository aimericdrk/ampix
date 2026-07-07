import { Button } from '../../../components/ui/button';
import { useToast } from '../../../components/ui/toast';

/**
 * Shareable Analysis URLs (feat-01 §3.3) — a "Copy link" button reused by every builder page
 * (Insights, Funnels, Retention, Flows, Paths). Writes the current address bar (which already
 * carries the page's `?s=` builder state, kept in sync by `useUrlAnalysisState`) to the clipboard
 * and confirms with a toast. Best-effort only: when the Clipboard API is unavailable, the click is
 * a silent no-op rather than surfacing an error.
 */
export function CopyLinkButton() {
  const { toast } = useToast();

  const copyLink = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => toast({ title: 'Link copied' }))
      .catch(() => {
        // Best-effort only — clipboard access can be denied/unavailable; no error surfaced.
      });
  };

  return (
    <Button type="button" variant="secondary" onClick={copyLink} className="gap-1.5">
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.5 1.5M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.5-1.5" />
      </svg>
      Copy link
    </Button>
  );
}
