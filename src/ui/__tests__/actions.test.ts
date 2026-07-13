/**
 * App action registry — the single dispatch point shared by keyboard
 * shortcuts and menu items. Pure module, node env.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { registerAction, registerActions, getAction, runAction, clearActions } from '../actions';

beforeEach(() => clearActions());

describe('action registry', () => {
  it('registers and runs an action', () => {
    let ran = 0;
    registerAction({ id: 'x.run', label: 'X', run: () => { ran++; } });
    expect(runAction('x.run')).toBe(true);
    expect(ran).toBe(1);
  });

  it('unknown ids are a safe no-op returning false', () => {
    expect(runAction('nope')).toBe(false);
  });

  it('disabled actions do not run', () => {
    let ran = 0;
    registerAction({ id: 'x.g', label: 'X', run: () => { ran++; }, enabled: () => false });
    expect(runAction('x.g')).toBe(false);
    expect(ran).toBe(0);
  });

  it('re-registering an id replaces the action (last one wins)', () => {
    const calls: string[] = [];
    registerAction({ id: 'x', label: 'A', run: () => { calls.push('a'); } });
    registerAction({ id: 'x', label: 'B', run: () => { calls.push('b'); } });
    runAction('x');
    expect(calls).toEqual(['b']);
    expect(getAction('x')?.label).toBe('B');
  });

  it('registerActions registers a batch; checked/enabled are surfaced', () => {
    registerActions([
      { id: 'a', label: 'A', run: () => {}, checked: () => true },
      { id: 'b', label: 'B', run: () => {} },
    ]);
    expect(getAction('a')?.checked?.()).toBe(true);
    expect(getAction('b')?.checked).toBeUndefined();
  });
});
