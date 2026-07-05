import { useEffect, useId, useRef, useState } from 'react';
import { useTheme } from '../../../../lib/theme';

let mermaidReady = false;

/**
 * Renders a Mermaid diagram from GENERATED diagram text (never raw user HTML — the source is always
 * produced by our own code, so there is no injection surface). Mermaid is dynamically imported so it
 * only loads when a diagram actually mounts (keeps it out of the initial bundle) and never breaks a
 * render if it fails: on any error we fall back to the diagram source in a <pre>. The source is also
 * always available in a <details> as the accessible text alternative to the SVG.
 */
export function MermaidDiagram({ chart, ariaLabel }: { chart: string; ariaLabel: string }) {
  const { theme } = useTheme();
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: theme === 'dark' ? 'dark' : 'default',
        });
        mermaidReady = true;
        const { svg: rendered } = await mermaid.render(`mmd-${id}`, chart);
        if (!cancelled) {
          setSvg(rendered);
          setFailed(false);
        }
      } catch {
        if (!cancelled) {
          setSvg(null);
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, theme, id]);

  return (
    <figure
      className="rounded-lg border border-border bg-chart-surface p-4"
      role="img"
      aria-label={ariaLabel}
    >
      {svg && !failed ? (
        <div ref={containerRef} className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <pre className="overflow-x-auto whitespace-pre rounded-md bg-bg p-3 text-xs text-text-muted">
          {chart}
        </pre>
      )}
      <details className="mt-3 text-xs text-text-muted">
        <summary className="cursor-pointer">Diagram source</summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre rounded-md bg-bg p-3">{chart}</pre>
      </details>
    </figure>
  );
}

/** Exposed for tests/telemetry: whether mermaid has been initialized at least once this session. */
export function isMermaidReady(): boolean {
  return mermaidReady;
}
