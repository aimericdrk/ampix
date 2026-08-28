import { useMemo } from 'react';
import { ResponsiveContainer, Sankey, Tooltip } from 'recharts';
import type { SankeyNodeProps } from 'recharts';
import { formatCompactNumber, formatExactNumber } from '../format';
import { assignSeriesColors, seriesKey } from '../palette';
import type { FlowLink, FlowNode } from '../../../lib/api/types';
import { useChartAnimationProps } from './charts/chart-theme';
import { CollapsibleTable } from '../../../components/ui/CollapsibleTable';

/** Synthetic nodes ($other = folded tail, $end = drop-off) get a muted token, never a categorical hue. */
function isSynthetic(event: string): boolean {
  return event.startsWith('$');
}

interface SankeyNodeDatum {
  name: string;
  event: string;
  step: number;
  fill: string;
}

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  fontSize: 13,
};

/**
 * Flows = a Sankey (Recharts `<Sankey>`). §15 gives nodes keyed by string id and links referencing
 * those ids; Recharts needs nodes indexed positionally and links referencing array indices, so we
 * translate. Real events take fixed-order categorical colors (var(--series-N)); the synthetic
 * $other/$end nodes take a muted token. A hover tooltip surfaces node/link values, and an always-
 * present pair of data tables (nodes + links) is the accessible view.
 */
export function FlowsChart({ nodes, links }: { nodes: FlowNode[]; links: FlowLink[] }) {
  const animation = useChartAnimationProps();
  const colorByEvent = useMemo(() => {
    const realEvents: string[] = [];
    for (const n of nodes) {
      if (!isSynthetic(n.event) && !realEvents.includes(n.event)) realEvents.push(n.event);
    }
    const colors = assignSeriesColors(
      realEvents.map((e) => ({ name: e, breakdown_value: null })),
      realEvents,
    );
    return new Map(
      realEvents.map((e) => [e, colors.get(seriesKey(e, null)) ?? 'var(--series-other)']),
    );
  }, [nodes]);

  const colorFor = (event: string) =>
    isSynthetic(event) ? 'var(--series-other)' : (colorByEvent.get(event) ?? 'var(--series-other)');

  const sankeyData = useMemo(() => {
    const indexById = new Map(nodes.map((n, i) => [n.id, i]));
    return {
      nodes: nodes.map<SankeyNodeDatum>((n) => ({
        name: n.event,
        event: n.event,
        step: n.step,
        fill: colorFor(n.event),
      })),
      links: links
        .map((l) => ({
          source: indexById.get(l.source),
          target: indexById.get(l.target),
          value: l.value,
        }))
        .filter(
          (l): l is { source: number; target: number; value: number } =>
            l.source !== undefined && l.target !== undefined,
        ),
    };
    // colorFor depends only on colorByEvent (memoized off nodes), so nodes+links+colorByEvent cover it.
  }, [nodes, links, colorByEvent]);

  return (
    <div className="flex flex-col gap-6">
      <ul aria-label="Flow event legend" className="flex flex-wrap gap-4">
        {[...colorByEvent.entries()].map(([event, color]) => (
          <li key={event} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: color }}
            />
            {event}
          </li>
        ))}
      </ul>

      <div
        role="img"
        aria-label="Event flow Sankey diagram"
        style={{ width: '100%', height: 380, backgroundColor: 'var(--chart-surface)' }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <Sankey
            data={sankeyData}
            nodePadding={24}
            nodeWidth={12}
            link={{ stroke: 'none', fill: 'var(--series-other)', fillOpacity: 0.3 }}
            node={(nodeProps: SankeyNodeProps) => <FlowSankeyNode {...nodeProps} />}
            margin={{ top: 12, right: 140, bottom: 12, left: 12 }}
            {...animation}
          >
            <Tooltip contentStyle={TOOLTIP_STYLE} />
          </Sankey>
        </ResponsiveContainer>
      </div>

      <FlowsTables nodes={nodes} links={links} />
    </div>
  );
}

/** A single Sankey node rectangle, colored by its event, direct-labeled with event + flow value. */
function FlowSankeyNode({ x, y, width, height, payload }: SankeyNodeProps) {
  // Recharts spreads the original node object into the computed payload, so our custom fields survive.
  const datum = payload as unknown as SankeyNodeDatum & { value: number };
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={2} fill={datum.fill} fillOpacity={0.95} />
      <text
        x={x + width + 6}
        y={y + height / 2}
        textAnchor="start"
        dominantBaseline="middle"
        fill="var(--text)"
        fontSize={11}
      >
        {datum.event} ({formatCompactNumber(datum.value)})
      </text>
    </g>
  );
}

function FlowsTables({ nodes, links }: { nodes: FlowNode[]; links: FlowLink[] }) {
  const labelById = new Map(nodes.map((n) => [n.id, n.event]));
  return (
    <div className="flex flex-col gap-6">
      <CollapsibleTable title="Nodes" count={nodes.length}>
        <table className="w-full max-w-xl border-collapse text-left text-sm">
          <caption className="sr-only">Flow nodes</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-2 font-medium">
                Step
              </th>
              <th scope="col" className="py-2 font-medium">
                Event
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Users
              </th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => (
              <tr key={node.id} className="border-b border-border">
                <td className="py-2 tabular-nums">{node.step}</td>
                <td className="py-2">{node.event}</td>
                <td className="py-2 text-right tabular-nums">{formatExactNumber(node.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CollapsibleTable>

      <CollapsibleTable title="Transitions" count={links.length}>
        <table className="w-full max-w-xl border-collapse text-left text-sm">
          <caption className="sr-only">Flow transitions</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-2 font-medium">
                From
              </th>
              <th scope="col" className="py-2 font-medium">
                To
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Users
              </th>
            </tr>
          </thead>
          <tbody>
            {links.map((link, index) => (
              <tr key={`${link.source}-${link.target}-${index}`} className="border-b border-border">
                <td className="py-2">{labelById.get(link.source) ?? link.source}</td>
                <td className="py-2">{labelById.get(link.target) ?? link.target}</td>
                <td className="py-2 text-right tabular-nums">{formatExactNumber(link.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CollapsibleTable>
    </div>
  );
}
