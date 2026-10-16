import { describe, it, expect } from 'vitest';
import { nextOption, firstOption, lastOption, typeahead, placeMenu, MenuRow } from '../dropdownModel';

const rows: MenuRow[] = [
  { kind: 'option', label: 'Sine' },
  { kind: 'group', label: 'Audio' },
  { kind: 'option', label: 'Audio Band' },
  { kind: 'option', label: 'Audio Env', disabled: true },
  { kind: 'option', label: 'Beat' },
  { kind: 'option', label: 'Square' },
];

describe('themed dropdown model', () => {
  it('steps over group headings and disabled options', () => {
    expect(nextOption(rows, 0, 1)).toBe(2);       // skips the "Audio" heading
    expect(nextOption(rows, 2, 1)).toBe(4);       // skips the disabled Audio Env
    expect(nextOption(rows, 4, -1)).toBe(2);
  });
  it('stops at the ends like a native list', () => {
    expect(nextOption(rows, 5, 1)).toBe(5);
    expect(nextOption(rows, 0, -1)).toBe(0);
  });
  it('finds the first and last enabled option', () => {
    expect(firstOption(rows)).toBe(0);
    expect(lastOption(rows)).toBe(5);
    expect(firstOption([{ kind: 'group', label: 'x' }])).toBe(-1);
  });
  it('type-ahead jumps to the next matching label and wraps', () => {
    expect(typeahead(rows, 0, 'b')).toBe(4);
    expect(typeahead(rows, 4, 's')).toBe(5);
    expect(typeahead(rows, 5, 's')).toBe(0);      // wraps to Sine
    expect(typeahead(rows, 0, 'au')).toBe(2);
    expect(typeahead(rows, 0, 'zzz')).toBe(0);
  });
  it('repeating one letter cycles that letter\'s options', () => {
    const r: MenuRow[] = [{ kind: 'option', label: 'Sine' }, { kind: 'option', label: 'Saw' }, { kind: 'option', label: 'Square' }];
    expect(typeahead(r, 0, 'ss')).toBe(1);
    expect(typeahead(r, 1, 'ss')).toBe(2);
  });
  it('opens below the field when there is room', () => {
    const p = placeMenu({ left: 100, right: 300, top: 100, bottom: 130 }, { width: 1920, height: 1080 }, 380, 0);
    expect(p.above).toBe(false);
    expect(p.top).toBe(134);
    expect(p.width).toBe(200);
    expect(p.maxHeight).toBe(380);
  });
  it('flips above when below cannot hold it and above has more room', () => {
    const p = placeMenu({ left: 100, right: 300, top: 900, bottom: 930 }, { width: 1920, height: 1000 }, 380, 0);
    expect(p.above).toBe(true);
    expect(p.maxHeight).toBeGreaterThan(96);
  });
  it('stays on screen horizontally', () => {
    const p = placeMenu({ left: 1800, right: 1900, top: 100, bottom: 130 }, { width: 1920, height: 1080 }, 300, 260);
    expect(p.left + p.width).toBeLessThanOrEqual(1920 - 8);
  });
});
