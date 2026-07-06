/**
 * v20: Classic slot apply mode — multiplicative slots write factors to
 * LiveValues, mirroring Graph multiplicative bindings (AUDIT item 5).
 */
import { describe, it, expect } from 'vitest';
import { ModMatrix } from '../ModMatrix';
import { LiveValuesStore } from '../LiveValues';
import { DEFAULT_MOD_SLOT, ModSlot, SettingsStore } from '../../state/Settings';

function makeStub(slots: Partial<ModSlot>[]): SettingsStore {
  const state: Record<string, unknown> = {
    modSlots: slots.map((s) => ({ ...DEFAULT_MOD_SLOT, ...s })),
    internalBpm: 120,
    zPush: 2,
    intensity: 1,
  };
  return {
    get: (k: string) => state[k],
    set: (k: string, v: unknown) => { state[k] = v; },
    subscribe: () => () => {},
    subscribeAll: () => () => {},
  } as unknown as SettingsStore;
}

function makeMatrix(slots: Partial<ModSlot>[]): {
  matrix: ModMatrix; live: LiveValuesStore; settings: SettingsStore;
} {
  const settings = makeStub(slots);
  const live = new LiveValuesStore(settings);
  const matrix = new ModMatrix(settings, { liveValues: live });
  return { matrix, live, settings };
}

const CONSTANT_ONE: Partial<ModSlot> = {
  enabled: true,
  source: 'constant',
  constantValue: 1,
  target: 'zPush',
  amount: 0.5,
};

describe('ModMatrix apply mode (v20)', () => {
  it('additive slot sums an offset: live = base + value*amount', () => {
    const { matrix, live } = makeMatrix([{ ...CONSTANT_ONE, mode: 'additive' }]);
    matrix.tick(1 / 60);
    expect(live.getLive('zPush')).toBeCloseTo(2 + 0.5, 6);
  });

  it('multiplicative slot contributes a factor: live = base * (1 + value*amount)', () => {
    const { matrix, live } = makeMatrix([{ ...CONSTANT_ONE, mode: 'multiplicative' }]);
    matrix.tick(1 / 60);
    expect(live.getLive('zPush')).toBeCloseTo(2 * 1.5, 6);
  });

  it('amount 0 multiplicative is a perfect identity', () => {
    const { matrix, live } = makeMatrix([{ ...CONSTANT_ONE, mode: 'multiplicative', amount: 0 }]);
    matrix.tick(1 / 60);
    expect(live.getLive('zPush')).toBeCloseTo(2, 6);
  });

  it('add and multiply stack as (base + offsets) * factors', () => {
    const { matrix, live } = makeMatrix([
      { ...CONSTANT_ONE, mode: 'additive' },                       // +0.5
      { ...CONSTANT_ONE, mode: 'multiplicative', amount: 1 },      // ×2
    ]);
    matrix.tick(1 / 60);
    expect(live.getLive('zPush')).toBeCloseTo((2 + 0.5) * 2, 6);
  });

  it('disabling a multiplicative slot clears its factor the same frame', () => {
    const { matrix, live, settings } = makeMatrix([{ ...CONSTANT_ONE, mode: 'multiplicative' }]);
    matrix.tick(1 / 60);
    expect(live.getLive('zPush')).toBeCloseTo(3, 6);
    (settings.get('modSlots') as ModSlot[])[0].enabled = false;
    matrix.tick(1 / 60);
    expect(live.getLive('zPush')).toBeCloseTo(2, 6);
  });

  it('missing mode field (pre-v20 slots) behaves additively', () => {
    const { matrix, live, settings } = makeMatrix([CONSTANT_ONE]);
    delete ((settings.get('modSlots') as ModSlot[])[0] as Partial<ModSlot>).mode;
    matrix.tick(1 / 60);
    expect(live.getLive('zPush')).toBeCloseTo(2.5, 6);
  });
});
