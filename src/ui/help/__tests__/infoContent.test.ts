import { describe, it, expect } from 'vitest';
import '../../../modulation/graph/bootstrap';
import { allDefs } from '../../../modulation/graph/registry';
import { PARAM_DOCS } from '../paramDocs';
import { SECTION_HINTS } from '../sectionHints';
import { MODULE_INFO, moduleInfo, moduleKey, nodeInfo, paramRows, sectionInfo } from '../infoContent';

describe('infoContent', () => {
  it('paramRows uses PARAM_DOCS, skips unknown keys and duplicates', () => {
    const key = Object.keys(PARAM_DOCS)[0];
    const rows = paramRows([key, 'definitelyNotAParam', key]);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe(PARAM_DOCS[key].description);
  });

  it('moduleKey normalises numbered function generators', () => {
    expect(moduleKey('FUNCTION GEN 3')).toBe('FUNCTION GEN');
    expect(moduleKey(' composite ')).toBe('COMPOSITE');
  });

  it('every hardware module has a summary', () => {
    for (const t of ['VIDEO SOURCE A', 'VIDEO SOURCE B', 'COMPOSITE', 'DUAL RASTER', 'RENDERER',
      'PATTERN GENERATOR', 'FUNCTION GEN 1', 'SOURCES', 'CV OUT', 'DEPTH', 'ROTATION']) {
      expect(MODULE_INFO[moduleKey(t)]?.summary, t).toBeTruthy();
    }
  });

  it('moduleInfo adds param rows + jack tips only when the module has params', () => {
    const key = Object.keys(PARAM_DOCS)[0];
    const withParams = moduleInfo('DEPTH', [key]);
    expect(withParams.sections[0].rows).toHaveLength(1);
    expect(withParams.tips.some((t) => t.includes('IN jack'))).toBe(true);
    const bare = moduleInfo('RENDERER', []);
    expect(bare.sections).toHaveLength(0);
    expect(bare.aboutHash).toBe('the-patch-bay');
  });

  it('sectionInfo summary comes from SECTION_HINTS', () => {
    const [title, hint] = Object.entries(SECTION_HINTS)[0];
    expect(sectionInfo(title, []).summary).toBe(hint);
  });

  it('nodeInfo covers every registered node with a matching about anchor', () => {
    const defs = allDefs();
    expect(defs.length).toBeGreaterThan(5);
    for (const d of defs) {
      const info = nodeInfo(d);
      expect(info.title).toBe(d.label);
      expect(info.summary).toBe(d.description);
      expect(info.aboutHash).toMatch(/^node-[a-z0-9-]+$/);
      const outs = info.sections.find((s) => s.heading === 'Outputs');
      expect(outs?.rows.length ?? 0).toBe(d.outputs.length);
    }
  });
});
