import type { FlowLink, FlowNode } from '../../../lib/api/types';

/** Card + spacing geometry for the layered path map (px, stage coordinates). */
export const NODE_WIDTH = 168;
export const NODE_HEIGHT = 176;
export const COLUMN_GAP = 104;
export const ROW_GAP = 28;
export const EDGE_MIN_WIDTH = 1.5;
export const EDGE_MAX_WIDTH = 8;

const COLUMN_STRIDE = NODE_WIDTH + COLUMN_GAP;
const ROW_STRIDE = NODE_HEIGHT + ROW_GAP;

/** `$other`/`$end` are synthetic (folded tail / drop-off) — muted, never a real screen with a shot. */
export function isSyntheticScreen(name: string): boolean {
  return name.startsWith('$');
}

/** Human label for a node: synthetic markers get friendly names, real screens keep their name. */
export function screenLabel(name: string): string {
  if (name === '$other') return 'Other screens';
  if (name === '$end') return 'Drop-off';
  return name;
}

export interface PositionedNode extends FlowNode {
  x: number;
  y: number;
  orderInStep: number;
}

export interface LayoutEdge {
  id: string;
  source: PositionedNode;
  target: PositionedNode;
  value: number;
}

export interface PathLayout {
  nodes: PositionedNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  maxValue: number;
}

/**
 * A simple layered layout computed in code (NO graph-layout dependency): one column per `step`, nodes
 * stacked in response order within the column, each column vertically centered against the tallest.
 * Edges are resolved from links to their positioned endpoints; unresolved links are dropped.
 */
export function computePathLayout(nodes: FlowNode[], links: FlowLink[]): PathLayout {
  const byStep = new Map<number, FlowNode[]>();
  for (const node of nodes) {
    const bucket = byStep.get(node.step) ?? [];
    bucket.push(node);
    byStep.set(node.step, bucket);
  }
  const steps = [...byStep.keys()].sort((a, b) => a - b);

  let maxRows = 0;
  for (const step of steps) maxRows = Math.max(maxRows, byStep.get(step)!.length);
  const contentHeight = Math.max(1, maxRows) * ROW_STRIDE - ROW_GAP;

  const positioned = new Map<string, PositionedNode>();
  steps.forEach((step, colIndex) => {
    const bucket = byStep.get(step)!;
    const colHeight = bucket.length * ROW_STRIDE - ROW_GAP;
    const yOffset = (contentHeight - colHeight) / 2;
    bucket.forEach((node, orderInStep) => {
      positioned.set(node.id, {
        ...node,
        orderInStep,
        x: colIndex * COLUMN_STRIDE,
        y: yOffset + orderInStep * ROW_STRIDE,
      });
    });
  });

  const edges: LayoutEdge[] = [];
  let maxValue = 0;
  links.forEach((link, index) => {
    const source = positioned.get(link.source);
    const target = positioned.get(link.target);
    if (!source || !target) return;
    edges.push({ id: `${link.source}->${link.target}-${index}`, source, target, value: link.value });
    maxValue = Math.max(maxValue, link.value);
  });

  const width = steps.length > 0 ? steps.length * COLUMN_STRIDE - COLUMN_GAP : NODE_WIDTH;
  return {
    nodes: [...positioned.values()],
    edges,
    width: Math.max(width, NODE_WIDTH),
    height: Math.max(contentHeight, NODE_HEIGHT),
    maxValue,
  };
}

/** Stroke width encoding transition volume, floored so a rare edge is still visible. */
export function edgeStrokeWidth(value: number, maxValue: number): number {
  if (maxValue <= 0) return EDGE_MIN_WIDTH;
  return EDGE_MIN_WIDTH + (value / maxValue) * (EDGE_MAX_WIDTH - EDGE_MIN_WIDTH);
}

/** A left→right cubic bezier from the source card's right edge to the target card's left edge. */
export function edgePath(source: PositionedNode, target: PositionedNode): string {
  const x1 = source.x + NODE_WIDTH;
  const y1 = source.y + NODE_HEIGHT / 2;
  const x2 = target.x;
  const y2 = target.y + NODE_HEIGHT / 2;
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
}

/**
 * A Mermaid-safe node id derived from the node index (never the raw screen name). Screen names may
 * contain spaces, `:` `[` `]` `{` `}` `|` `"` etc. that break Mermaid syntax or open an injection
 * surface — so ids are `n{index}` and only alphanumerics from the name are appended as a readable hint.
 */
export function sanitizeNodeId(name: string, index: number): string {
  const hint = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  return `n${index}${hint ? `_${hint}` : ''}`;
}

/** Escapes a Mermaid quoted-label body: strip characters that could break the string or inject syntax. */
function mermaidLabel(text: string): string {
  return text.replace(/[\\"`|<>{}[\]\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Builds a `flowchart LR` Mermaid diagram of the same screen-paths from generated text only (the
 * MermaidDiagram component renders with `securityLevel: 'strict'` and never receives raw user HTML).
 * Node labels carry the screen name + user count; edge labels carry the transition count.
 */
export function buildScreenPathsMermaid(nodes: FlowNode[], links: FlowLink[]): string {
  const idFor = new Map<string, string>();
  nodes.forEach((node, index) => idFor.set(node.id, sanitizeNodeId(node.event, index)));

  const lines = ['flowchart LR'];
  for (const node of nodes) {
    const id = idFor.get(node.id)!;
    const label = mermaidLabel(`${screenLabel(node.event)} (${node.value})`);
    lines.push(`  ${id}["${label}"]`);
  }
  for (const link of links) {
    const source = idFor.get(link.source);
    const target = idFor.get(link.target);
    if (!source || !target) continue;
    lines.push(`  ${source} -->|${mermaidLabel(String(link.value))}| ${target}`);
  }
  return lines.join('\n');
}
