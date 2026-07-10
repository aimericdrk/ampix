import { Link2 } from 'lucide-react';
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
      <Link2 aria-hidden="true" size={14} />
      Copy link
    </Button>
  );
}
