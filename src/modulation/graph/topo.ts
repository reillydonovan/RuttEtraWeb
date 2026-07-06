/**
 * Topological sort with cycle detection for the signal graph.
 *
 * The graph is a DAG of node ids connected by `inputs` (input port name ->
 * source node id). When a cycle exists (A -> B -> A), one edge of the
 * cycle is broken and remembered as a `cycleEdge`. The engine reads that
 * edge's value from the previous frame's output, giving feedback patches
 * an implicit one-frame delay (musically useful, can't infinite-loop).
 *
 * Algorithm: Kahn's algorithm over an adjacency list built from the
 * `inputs` map. When Kahn stalls (remaining nodes have a cycle among
 * themselves) we break the lowest-id back-edge in the residual graph and
 * continue. Repeat until empty. This guarantees termination and produces
 * a deterministic order keyed off node ids.
 */

import { GraphPatch, splitInputRef } from './types';

export interface TopoResult {
  /** Topological order. All node ids present, even those involved in cycles. */
  order: string[];
  /** Edges (source -> dest, dest port) that were broken to remove a cycle. */
  cycleEdges: Array<{ from: string; to: string; toPort: string }>;
}

export function topoSort(patch: GraphPatch): TopoResult {
  const nodeIds = new Set(patch.nodes.map((n) => n.id));
  // Adjacency list of edges that count for ordering. Each entry is an
  // outgoing edge (from -> to via toPort) that is NOT yet broken.
  const outgoing = new Map<string, Array<{ to: string; toPort: string }>>();
  const incoming = new Map<string, Array<{ from: string; toPort: string }>>();
  for (const n of patch.nodes) {
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  }
  for (const n of patch.nodes) {
    for (const [toPort, ref] of Object.entries(n.inputs)) {
      if (ref == null) continue;
      // v25: refs may carry a source port (`nodeId#port`) — ordering
      // only cares about the node.
      const fromId = splitInputRef(ref).nodeId;
      if (!nodeIds.has(fromId)) continue; // dangling reference; ignore.
      outgoing.get(fromId)!.push({ to: n.id, toPort });
      incoming.get(n.id)!.push({ from: fromId, toPort });
    }
  }

  const order: string[] = [];
  const cycleEdges: Array<{ from: string; to: string; toPort: string }> = [];

  // Mutable in-degree map (counts only NOT-broken edges).
  const inDeg = new Map<string, number>();
  for (const id of nodeIds) inDeg.set(id, incoming.get(id)!.length);

  // Stable initial frontier sorted by id.
  const ready: string[] = [];
  for (const id of [...nodeIds].sort()) {
    if ((inDeg.get(id) ?? 0) === 0) ready.push(id);
  }

  while (order.length < nodeIds.size) {
    while (ready.length > 0) {
      const id = ready.shift()!;
      order.push(id);
      for (const e of outgoing.get(id) ?? []) {
        const next = (inDeg.get(e.to) ?? 0) - 1;
        inDeg.set(e.to, next);
        if (next === 0) {
          // Insert in id-sort order to keep the result deterministic.
          insertSorted(ready, e.to);
        }
      }
    }
    if (order.length === nodeIds.size) break;

    // Cycle remains. Find the lowest-id node that still has incoming
    // edges, and break its lowest-id back-edge.
    const stuck: string[] = [];
    for (const id of nodeIds) {
      if (!order.includes(id) && (inDeg.get(id) ?? 0) > 0) stuck.push(id);
    }
    if (stuck.length === 0) break; // shouldn't happen, but be defensive.
    stuck.sort();
    const target = stuck[0];
    const edges = (incoming.get(target) ?? []).slice().sort(
      (a, b) => a.from.localeCompare(b.from) || a.toPort.localeCompare(b.toPort),
    );
    const edge = edges[0];
    cycleEdges.push({ from: edge.from, to: target, toPort: edge.toPort });
    // Remove this edge from inDeg / outgoing so the algorithm proceeds.
    inDeg.set(target, (inDeg.get(target) ?? 1) - 1);
    const out = outgoing.get(edge.from) ?? [];
    const idx = out.findIndex((e) => e.to === target && e.toPort === edge.toPort);
    if (idx >= 0) out.splice(idx, 1);
    if ((inDeg.get(target) ?? 0) === 0) insertSorted(ready, target);
  }

  // If a node never showed up (orphan unreachable), append it so the
  // engine still knows about it.
  if (order.length < nodeIds.size) {
    for (const id of [...nodeIds].sort()) {
      if (!order.includes(id)) order.push(id);
    }
  }

  return { order, cycleEdges };
}

function insertSorted(arr: string[], id: string): void {
  // Linear insertion is fine — these arrays are tiny (< node count).
  let i = 0;
  while (i < arr.length && arr[i] < id) i++;
  arr.splice(i, 0, id);
}
