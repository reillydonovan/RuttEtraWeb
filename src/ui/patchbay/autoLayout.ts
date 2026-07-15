/**
 * Pure, DOM-free layout algorithm for the Patch Bay's default freeform
 * arrangement — a left-to-right signal-flow reading (TouchDesigner/
 * ComfyUI/Blender node-editor convention), used as the bay's DEFAULT
 * starting layout (TIDY/stacked flow stays available as a fallback via
 * the TIDY/FREE toggle — this module never removes that option).
 *
 * Two independent, separately-testable concerns:
 *   - `graphNodeColumns` — topology only: a graph node's column is
 *     purely a function of its wiring (NodeWire[] from rackGeometry.ts).
 *   - `computeDefaultLayout` — geometry only: given every unit's
 *     assigned column and MEASURED {width,height} (never read from the
 *     DOM itself), pack them into x-bands, stacked top-to-bottom within
 *     a column.
 */

import type { NodeWire } from '../rack/rackGeometry';

export type LayoutColumn = 'generators' | 'processors' | 'output' | 'fields';

/** Left-to-right signal-flow column for every FIXED (non-graph-node)
 *  module, keyed by the module/field title string already used as its
 *  `data-pb-unit-id`. Generators (pure producers, no inputs) → the
 *  compositing/shaping stage → the sink → the faceplate param groups
 *  (cable destinations from any stage, not a single downstream step). */
export const FIXED_MODULE_COLUMNS: Readonly<Record<string, LayoutColumn>> = {
  'VIDEO SOURCE A': 'generators',
  'VIDEO SOURCE B': 'generators',
  'FUNCTION GEN 1': 'generators',
  'FUNCTION GEN 2': 'generators',
  'FUNCTION GEN 3': 'generators',
  'FUNCTION GEN 4': 'generators',
  COMPOSITE: 'processors',
  'DUAL RASTER': 'processors',
  'PATTERN GENERATOR': 'processors',
  RENDERER: 'output',
};

/** How many columns of physical x-space the fixed scheme spans before
 *  the 'fields' band — graph-node layers are offset by this many
 *  column-widths so they visually sit alongside/after 'generators'. */
const FIXED_COLUMN_ORDER: readonly LayoutColumn[] = ['generators', 'processors', 'output', 'fields'];

/** Deepest graph-node layer that still gets its own column before
 *  clamping to the 'output' band — keeps a pathologically deep chain
 *  from pushing the fixed columns around; real patches are shallow. */
const MAX_GRAPH_LAYERS = 3;

/**
 * Topological column per graph node id: 0 for a node with no wired
 * inputs (a pure generator — sits alongside 'generators'), else
 * 1 + max(source node's column) over every wired input. Cycle-safe:
 * the engine's own topo-sort already guarantees an acyclic patch, but
 * this defends with a visited-set anyway rather than assuming it.
 */
export function graphNodeColumns(nodeIds: readonly string[], wires: readonly NodeWire[]): Map<string, number> {
  const incomingBySource = new Map<string, string[]>();
  const hasWiredInput = new Set<string>();
  for (const w of wires) {
    hasWiredInput.add(w.targetNodeId);
    const list = incomingBySource.get(w.sourceNodeId);
    if (list) list.push(w.targetNodeId);
    else incomingBySource.set(w.sourceNodeId, [w.targetNodeId]);
  }
  // Column of a node = 1 + max(column of every node that feeds it).
  // Compute by "layer from roots" (nodes with no wired input) via BFS
  // instead of naive per-node recursion, so a cycle (shouldn't happen,
  // but never trust it blindly) just stops propagating rather than
  // recursing forever.
  const cols = new Map<string, number>();
  for (const id of nodeIds) if (!hasWiredInput.has(id)) cols.set(id, 0);
  const bySourceTargets = new Map<string, NodeWire[]>();
  for (const w of wires) {
    const list = bySourceTargets.get(w.sourceNodeId);
    if (list) list.push(w);
    else bySourceTargets.set(w.sourceNodeId, [w]);
  }
  let frontier = [...cols.keys()];
  const visitedEdges = new Set<string>();
  while (frontier.length) {
    const next: string[] = [];
    for (const sourceId of frontier) {
      const sourceCol = cols.get(sourceId) ?? 0;
      for (const w of bySourceTargets.get(sourceId) ?? []) {
        const edgeKey = `${w.sourceNodeId}->${w.targetNodeId}#${w.targetPort}`;
        if (visitedEdges.has(edgeKey)) continue;
        visitedEdges.add(edgeKey);
        const candidate = sourceCol + 1;
        const cur = cols.get(w.targetNodeId);
        if (cur === undefined || candidate > cur) {
          cols.set(w.targetNodeId, candidate);
          next.push(w.targetNodeId);
        }
      }
    }
    frontier = next;
  }
  // Any node id never reached above (shouldn't happen given every id is
  // seeded as a root or discovered via BFS) defensively lands at 0.
  for (const id of nodeIds) if (!cols.has(id)) cols.set(id, 0);
  return cols;
}

export interface LayoutUnitSpec {
  id: string;
  column: LayoutColumn;
  /** Only meaningful when `column === 'generators'` or the node is
   *  itself a graph node sharing that band — see `computeDefaultLayout`. */
  graphColumn?: number;
  width: number;
  height: number;
}

export interface LayoutOpts {
  columnGap: number;
  rowGap: number;
}

/**
 * Pack units into left-to-right x-bands (fixed columns, graph-node
 * layers offset alongside/after 'generators'), stacked top-to-bottom
 * within a column in INPUT order. Pure geometry — collision-free by
 * construction (no two units in the same column overlap vertically, no
 * two columns overlap horizontally), so callers never need a follow-up
 * `resolveOverlap` pass for a freshly-computed default layout.
 */
export function computeDefaultLayout(
  units: readonly LayoutUnitSpec[],
  opts: LayoutOpts,
): Map<string, { left: number; top: number }> {
  const { columnGap, rowGap } = opts;

  // Column index: fixed bands first, then one extra slot per graph
  // layer beyond 0 (layer 0 shares the 'generators' band), clamped so
  // a deep graph never reflows past 'output'.
  const fixedIndex = (c: LayoutColumn): number => FIXED_COLUMN_ORDER.indexOf(c);
  const columnIndexOf = (u: LayoutUnitSpec): number => {
    if (u.column === 'generators' && u.graphColumn) {
      const layer = Math.min(u.graphColumn, MAX_GRAPH_LAYERS);
      return fixedIndex('generators') + layer;
    }
    return fixedIndex(u.column);
  };

  const byColumnIndex = new Map<number, LayoutUnitSpec[]>();
  for (const u of units) {
    const idx = columnIndexOf(u);
    const list = byColumnIndex.get(idx);
    if (list) list.push(u);
    else byColumnIndex.set(idx, [u]);
  }

  const sortedIndices = [...byColumnIndex.keys()].sort((a, b) => a - b);
  const result = new Map<string, { left: number; top: number }>();
  let left = 0;
  for (const idx of sortedIndices) {
    const colUnits = byColumnIndex.get(idx)!;
    const colWidth = Math.max(0, ...colUnits.map((u) => u.width));
    let top = 0;
    for (const u of colUnits) {
      result.set(u.id, { left, top });
      top += u.height + rowGap;
    }
    left += colWidth + columnGap;
  }
  return result;
}
