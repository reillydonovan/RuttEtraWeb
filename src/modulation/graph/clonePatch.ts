import type { GraphPatch } from './types';

/**
 * Deep copy of a graph patch — the single clone used by every graph editor
 * surface before it edits a patch.
 *
 * Editors must never mutate the patch held by Settings: `SettingsStore.set`
 * ignores a value that is the same object as the stored one, so an
 * in-place edit followed by `set('modGraph', samePatch)` fires no
 * subscribers — the canvas doesn't re-render and nothing else hears about
 * the change. Copies must keep every field (notably the v17 `enabled` mute
 * flag on nodes and bindings), or an unrelated edit silently un-mutes.
 */
export function clonePatch(p: GraphPatch): GraphPatch {
  return {
    nodes: p.nodes.map((n) => ({
      ...n,
      params: { ...n.params },
      inputs: { ...n.inputs },
      position: n.position ? { ...n.position } : undefined,
    })),
    bindings: p.bindings.map((b) => ({ ...b })),
  };
}
