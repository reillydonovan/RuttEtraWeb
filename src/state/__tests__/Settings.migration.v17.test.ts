/**
 * v16 → v17 migration: graph node/binding `enabled` backfill (AUDIT item 23).
 */
import { describe, it, expect } from 'vitest';
import { migrateSettings } from '../Settings';
import type { GraphPatch } from '../../modulation/graph/types';

describe('migrateSettings v16 -> v17', () => {
  it('backfills enabled:true on every node and binding of a saved patch', () => {
    const v16 = {
      _v: 16,
      modGraph: {
        nodes: [
          { id: 'n1', type: 'lfo', params: {}, inputs: {} },
          { id: 'n2', type: 'constant', params: {}, inputs: {}, enabled: false },
        ],
        bindings: [
          { id: 'b1', paramKey: 'zPush', sourceNodeId: 'n1', amount: 1, mode: 'additive' },
        ],
      },
    };
    const out = migrateSettings(v16);
    expect(out._v).toBe(17);
    const g = out.modGraph as GraphPatch;
    expect(g.nodes[0].enabled).toBe(true);
    // Explicit false is user intent — preserved, not clobbered.
    expect(g.nodes[1].enabled).toBe(false);
    expect(g.bindings[0].enabled).toBe(true);
  });

  it('is idempotent and tolerates a null graph', () => {
    const once = migrateSettings({ _v: 16, modGraph: null });
    expect(once._v).toBe(17);
    expect(once.modGraph).toBeNull();
    const twice = migrateSettings(once);
    expect(twice._v).toBe(17);
  });
});
