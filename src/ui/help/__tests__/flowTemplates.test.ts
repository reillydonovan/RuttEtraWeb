import { describe, it, expect } from 'vitest';
import '../../../modulation/graph/bootstrap';
import { allDefs } from '../../../modulation/graph/registry';
import { ABOUT_FLOWS, nodeTemplateFlow } from '../flowTemplates';
import { flowSvg } from '../flowSvg';

describe('flowTemplates (About page diagrams)', () => {
  it('draws every node that has ports', () => {
    for (const d of allDefs()) {
      const svg = flowSvg(nodeTemplateFlow(d));
      expect(svg === '').toBe(d.inputs.length === 0 && d.outputs.length === 0);
    }
  });
  it('every hand-picked example renders', () => {
    for (const [id, f] of Object.entries(ABOUT_FLOWS)) expect(flowSvg(f), id).toContain('<svg');
  });
});
