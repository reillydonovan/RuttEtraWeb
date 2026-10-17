import { describe, it, expect } from 'vitest';
import '../bootstrap';
import { allDefs } from '../registry';

// Every graph node param's `help` is the single source for its hover tooltip (Beginner rows,
// Advanced inspector, Patch Bay), the node's ⓘ panel and the About Node Catalog. A new node
// or param without one fails here — and names itself.
describe('graph node param help', () => {
  it('registers the nodes', () => {
    expect(allDefs().length).toBeGreaterThan(20);
  });

  it('every param of every node has a one-line help string', () => {
    const missing: string[] = [];
    for (const def of allDefs()) {
      for (const [name, spec] of Object.entries(def.params)) {
        if (!spec.help || !spec.help.trim()) missing.push(`${def.type}.${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('help stays short enough for a tooltip', () => {
    const long: string[] = [];
    for (const def of allDefs()) {
      for (const [name, spec] of Object.entries(def.params)) {
        if (spec.help && spec.help.length > 200) long.push(`${def.type}.${name} (${spec.help.length})`);
      }
    }
    expect(long).toEqual([]);
  });
});
