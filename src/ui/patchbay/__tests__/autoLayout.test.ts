import { describe, it, expect } from 'vitest';
import { graphNodeColumns, computeDefaultLayout, type LayoutUnitSpec } from '../autoLayout';
import type { NodeWire } from '../../rack/rackGeometry';

function wire(sourceNodeId: string, targetNodeId: string, targetPort = 'in'): NodeWire {
  return { sourceNodeId, targetNodeId, targetPort, sourcePort: '' };
}

describe('graphNodeColumns', () => {
  it('a node with no wired inputs gets column 0', () => {
    const cols = graphNodeColumns(['a'], []);
    expect(cols.get('a')).toBe(0);
  });

  it('a chain A->B->C gets columns 0/1/2', () => {
    const cols = graphNodeColumns(['a', 'b', 'c'], [wire('a', 'b'), wire('b', 'c')]);
    expect(cols.get('a')).toBe(0);
    expect(cols.get('b')).toBe(1);
    expect(cols.get('c')).toBe(2);
  });

  it('a diamond: child column is 1+max(parents), not sum', () => {
    // a -> c, b -> c ; a and b are both roots (column 0)
    const cols = graphNodeColumns(['a', 'b', 'c'], [wire('a', 'c'), wire('b', 'c')]);
    expect(cols.get('a')).toBe(0);
    expect(cols.get('b')).toBe(0);
    expect(cols.get('c')).toBe(1);
  });

  it('a diamond with uneven parent depths: child column follows the DEEPER parent', () => {
    // a -> b -> d ; a -> d  (d has two inputs: from b at depth 1, and from a at depth 0)
    const cols = graphNodeColumns(['a', 'b', 'd'], [wire('a', 'b'), wire('b', 'd'), wire('a', 'd')]);
    expect(cols.get('a')).toBe(0);
    expect(cols.get('b')).toBe(1);
    expect(cols.get('d')).toBe(2); // 1 + max(b=1, a=0) = 2
  });

  it('handles an empty wire list and an unreferenced node', () => {
    const cols = graphNodeColumns(['solo'], []);
    expect(cols.get('solo')).toBe(0);
  });
});

describe('computeDefaultLayout', () => {
  function unit(id: string, column: LayoutUnitSpec['column'], width = 200, height = 100, graphColumn?: number): LayoutUnitSpec {
    return { id, column, width, height, graphColumn };
  }

  it('orders columns left to right: generators < processors < output < fields', () => {
    const units = [
      unit('renderer', 'output'),
      unit('field1', 'fields'),
      unit('gen1', 'generators'),
      unit('proc1', 'processors'),
    ];
    const pos = computeDefaultLayout(units, { columnGap: 20, rowGap: 10 });
    expect(pos.get('gen1')!.left).toBeLessThan(pos.get('proc1')!.left);
    expect(pos.get('proc1')!.left).toBeLessThan(pos.get('renderer')!.left);
    expect(pos.get('renderer')!.left).toBeLessThan(pos.get('field1')!.left);
  });

  it('stacks units within a column top to bottom in input order', () => {
    const units = [
      unit('gen1', 'generators', 200, 100),
      unit('gen2', 'generators', 200, 150),
      unit('gen3', 'generators', 200, 80),
    ];
    const pos = computeDefaultLayout(units, { columnGap: 20, rowGap: 10 });
    expect(pos.get('gen1')!.top).toBe(0);
    expect(pos.get('gen2')!.top).toBe(110); // 100 + rowGap(10)
    expect(pos.get('gen3')!.top).toBe(270); // 110 + 150 + 10
    // Same column -> same left.
    expect(pos.get('gen1')!.left).toBe(pos.get('gen2')!.left);
    expect(pos.get('gen2')!.left).toBe(pos.get('gen3')!.left);
  });

  it('produces no overlapping rects across a mixed set of units', () => {
    const units = [
      unit('gen1', 'generators', 200, 100),
      unit('gen2', 'generators', 200, 150),
      unit('proc1', 'processors', 220, 120),
      unit('renderer', 'output', 180, 90),
      unit('field1', 'fields', 260, 400),
      unit('field2', 'fields', 260, 200),
      unit('graphnode0', 'generators', 180, 100, 0),
      unit('graphnode1', 'generators', 180, 100, 1),
    ];
    const pos = computeDefaultLayout(units, { columnGap: 24, rowGap: 12 });
    const rects = units.map((u) => ({ id: u.id, ...pos.get(u.id)!, width: u.width, height: u.height }));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        const overlapX = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
        const overlaps = overlapX > 0 && overlapY > 0;
        expect(overlaps).toBe(false);
      }
    }
  });

  it('a graph node with graphColumn 1 sits in a later x-band than graphColumn 0', () => {
    const units = [
      unit('n0', 'generators', 180, 100, 0),
      unit('n1', 'generators', 180, 100, 1),
    ];
    const pos = computeDefaultLayout(units, { columnGap: 20, rowGap: 10 });
    expect(pos.get('n0')!.left).toBeLessThan(pos.get('n1')!.left);
  });
});
