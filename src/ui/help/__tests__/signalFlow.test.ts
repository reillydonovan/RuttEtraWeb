import { describe, it, expect } from 'vitest';
import '../../../modulation/graph/bootstrap';
import type { GraphPatch } from '../../../modulation/graph/types';
import { busFlow, moduleFlow, nodeFlow, paramsFlow, slotFlow, type FlowState } from '../signalFlow';
import { flowSvg } from '../flowSvg';

const slot = (source: string, target: string, enabled = true) => ({ source, target, enabled }) as FlowState['modSlots'][number];

function state(over: Partial<FlowState> = {}): FlowState {
  return {
    modSlots: [slot('sine', 'zPush'), slot('triangle', 'none'), slot('sine', 'none', false), slot('saw', 'none')],
    modMode: 'both',
    graph: null,
    video: { rendererIn: 'sourceA', compositeInA: 'sourceA', compositeInB: 'sourceB', dualRasterInA: 'none', dualRasterInB: 'none' },
    ...over,
  };
}

const graph: GraphPatch = {
  nodes: [
    { id: 'l1', type: 'lfo', params: {}, inputs: {} },
    { id: 's1', type: 'scope', params: {}, inputs: { in: 'l1' } },
    { id: 'p1', type: 'param-out', params: { key: 'hSize' }, inputs: {} },
  ],
  bindings: [
    { id: 'b1', paramKey: 'hPos', sourceNodeId: 'l1', amount: 1, mode: 'additive' } as GraphPatch['bindings'][number],
    { id: 'b2', paramKey: 'vSize', sourceNodeId: 'p1', amount: 1, mode: 'additive' } as GraphPatch['bindings'][number],
  ],
};

describe('signalFlow', () => {
  it('slotFlow shows the waveform in and the target out', () => {
    const f = slotFlow(state(), 0)!;
    expect(f.inputs[0].links[0].label).toBe('SINE');
    expect(f.outputs[0].links[0].label).toMatch(/Z Push/i);
    expect(slotFlow(state(), 1)!.outputs[0].links).toHaveLength(0);
  });

  it('marks Classic cables idle in graph-only mode or when the slot is off', () => {
    expect(slotFlow(state({ modMode: 'graph' }), 0)!.outputs[0].links[0].idle).toBe(true);
    expect(slotFlow(state(), 0)!.outputs[0].links[0].idle).toBe(false);
  });

  it('nodeFlow lists bindings and downstream node wires', () => {
    const f = nodeFlow(state({ graph }), 'l1')!;
    const outs = f.outputs.flatMap((p) => p.links.map((l) => l.label));
    expect(outs.some((l) => /H Pos/i.test(l))).toBe(true);
    expect(outs.some((l) => /Scope/.test(l))).toBe(true);
    const scope = nodeFlow(state({ graph }), 's1')!;
    expect(scope.inputs[0].links[0].label).toBe('LFO');
  });

  it('paramsFlow collects modulators and OUT-jack destinations, counting the rest', () => {
    const f = paramsFlow(state({ graph }), 'Test', ['zPush', 'hPos', 'hSize', 'cols']);
    expect(f.inputs.map((p) => p.name).length).toBe(2); // zPush (FG1), hPos (LFO)
    expect(f.outputs).toHaveLength(1);                  // hSize OUT → V Size
    expect(f.unpatched).toBe(1);                        // cols
  });

  it('video modules follow the routing keys', () => {
    const comp = moduleFlow(state(), 'COMPOSITE', []);
    expect(comp.inputs.map((p) => p.links[0]?.label)).toEqual(['Video Source A', 'Video Source B']);
    const a = moduleFlow(state(), 'VIDEO SOURCE A', []);
    expect(a.outputs[0].links.map((l) => l.label)).toEqual(['Composite · A', 'Renderer']);
    expect(moduleFlow(state(), 'FUNCTION GEN 1', []).title).toBe('Function Gen 1');
  });

  it('busFlow shows only waveforms in use', () => {
    const f = busFlow(state());
    expect(f.outputs.map((p) => p.name)).toEqual(['SINE', 'TRI', 'SAW']);
    expect(f.outputs[0].links).toHaveLength(2);
  });
});

describe('flowSvg', () => {
  it('draws cables and labels, escaping text', () => {
    const svg = flowSvg({ title: 'A<b>', inputs: [{ name: 'IN', kind: 'mod', links: [{ label: 'x & y', kind: 'mod' }] }], outputs: [] });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('x &amp; y');
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('no outputs');
  });

  it('is empty when there is nothing to draw', () => {
    expect(flowSvg({ title: 'x', inputs: [], outputs: [], unpatched: 5 })).toBe('');
  });

  it('collapses long port lists into "+N more"', () => {
    const inputs = Array.from({ length: 20 }, (_, i) => ({ name: `p${i}`, kind: 'graph' as const, links: [{ label: `s${i}`, kind: 'graph' as const }] }));
    expect(flowSvg({ title: 'x', inputs, outputs: [] })).toContain('+6 more');
  });
});

describe('signalFlow v1.31', () => {
  it('draws an unpatched unit with empty IN jacks instead of nothing', () => {
    const f = paramsFlow(state({ modSlots: [] }), 'Idle', ['hPos', 'vPos', 'hSize', 'vSize', 'aspect', 'zPush', 'zBias']);
    expect(f.inputs).toHaveLength(5);
    expect(f.inputs.every((p) => p.links.length === 0)).toBe(true);
    expect(f.unpatched).toBe(2);
    expect(flowSvg(f)).not.toBe('');
  });

  it('shows where the Pattern Generator OUT is patched', () => {
    const s = state({ video: { rendererIn: 'pattern', compositeInA: 'sourceA', compositeInB: 'pattern', dualRasterInA: 'none', dualRasterInB: 'none' } });
    const f = moduleFlow(s, 'PATTERN GENERATOR', []);
    expect(f.outputs[0].links.map((l) => l.label)).toEqual(['Composite · B', 'Renderer']);
    expect(moduleFlow(s, 'RENDERER', []).inputs[0].links[0].label).toBe('Pattern Generator');
  });
});
