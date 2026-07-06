/**
 * v17 user patch library — pure list/serialization logic (AUDIT item 23).
 */
import { describe, it, expect } from 'vitest';
import {
  emptyLibrary, parseUserLibrary, serializeUserLibrary,
  savePatch, deletePatch,
} from '../userLibrary';
import { GraphPatch } from '../types';

const PATCH: GraphPatch = {
  nodes: [{ id: 'n1', type: 'lfo', params: { rate: 1 }, inputs: {} }],
  bindings: [{ id: 'b1', paramKey: 'zPush', sourceNodeId: 'n1', amount: 0.5, mode: 'additive' }],
};

describe('userLibrary', () => {
  it('round-trips through serialize/parse', () => {
    const lib = savePatch(emptyLibrary(), 'My Patch', PATCH, 1000);
    const back = parseUserLibrary(serializeUserLibrary(lib));
    expect(back.patches).toHaveLength(1);
    expect(back.patches[0].name).toBe('My Patch');
    expect(back.patches[0].patch.nodes[0].id).toBe('n1');
  });

  it('tolerates malformed input without throwing', () => {
    expect(parseUserLibrary(null).patches).toEqual([]);
    expect(parseUserLibrary('').patches).toEqual([]);
    expect(parseUserLibrary('not json').patches).toEqual([]);
    expect(parseUserLibrary('{"patches": "nope"}').patches).toEqual([]);
    expect(parseUserLibrary('[]').patches).toEqual([]);
    // Entries missing required fields are dropped individually.
    const partial = JSON.stringify({ _v: 1, patches: [{ id: 'x' }, null, {
      id: 'ok', name: 'Ok', savedAt: 1, patch: PATCH,
    }] });
    const lib = parseUserLibrary(partial);
    expect(lib.patches.map((p) => p.id)).toEqual(['ok']);
  });

  it('saving under an existing name overwrites in place (same id)', () => {
    let lib = savePatch(emptyLibrary(), 'A', PATCH, 1000);
    const firstId = lib.patches[0].id;
    const changed: GraphPatch = { ...PATCH, bindings: [] };
    lib = savePatch(lib, 'A', changed, 2000);
    expect(lib.patches).toHaveLength(1);
    expect(lib.patches[0].id).toBe(firstId);
    expect(lib.patches[0].savedAt).toBe(2000);
    expect(lib.patches[0].patch.bindings).toHaveLength(0);
  });

  it('deep-clones the patch so later mutations do not leak in', () => {
    const source: GraphPatch = JSON.parse(JSON.stringify(PATCH)) as GraphPatch;
    const lib = savePatch(emptyLibrary(), 'A', source, 1000);
    source.nodes[0].params.rate = 999;
    expect(lib.patches[0].patch.nodes[0].params.rate).toBe(1);
  });

  it('ignores empty / whitespace-only names', () => {
    expect(savePatch(emptyLibrary(), '', PATCH, 1).patches).toHaveLength(0);
    expect(savePatch(emptyLibrary(), '   ', PATCH, 1).patches).toHaveLength(0);
  });

  it('deletePatch removes by id and is a no-op on unknown ids', () => {
    const lib = savePatch(emptyLibrary(), 'A', PATCH, 1000);
    const id = lib.patches[0].id;
    expect(deletePatch(lib, id).patches).toHaveLength(0);
    expect(deletePatch(lib, 'nope').patches).toHaveLength(1);
  });
});
