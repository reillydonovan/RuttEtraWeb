import { describe, expect, it } from 'vitest';
import { resetSavedState, isAppStorageKey, BACKUP_KEY } from '../resetSavedState';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  clear(): void { this.m.clear(); }
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string): void { this.m.delete(k); }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
}

describe('resetSavedState (?reset)', () => {
  it('backs up and clears every app-owned key, and leaves other sites\' keys alone', () => {
    const st = new MemoryStorage();
    st.setItem('ruttetra.settings.v1', '{"a":1}');
    st.setItem('ruttetra.project.autosave.v1', '{}');
    st.setItem('rw-ui-skin', 'rack');
    st.setItem('RW_MOD_DEBUG', '1');
    st.setItem('someone-else', 'keep');
    const n = resetSavedState(st);
    expect(n).toBe(4);
    expect(st.getItem('ruttetra.settings.v1')).toBeNull();
    expect(st.getItem('rw-ui-skin')).toBeNull();
    expect(st.getItem('someone-else')).toBe('keep');
    const backup = JSON.parse(st.getItem(BACKUP_KEY)!);
    expect(backup.entries['ruttetra.settings.v1']).toBe('{"a":1}');
    expect(backup.entries['rw-ui-skin']).toBe('rack');
  });

  it('never sweeps the backup itself', () => {
    expect(isAppStorageKey(BACKUP_KEY)).toBe(false);
    const st = new MemoryStorage();
    st.setItem('ruttetra.settings.v1', 'x');
    resetSavedState(st);
    resetSavedState(st);
    expect(st.getItem(BACKUP_KEY)).not.toBeNull();
  });
});
