/**
 * Builds a slot card's Range adapter (target-unit From → To) from a patch's parts. One helper
 * for both engines — function generators (ModulationSection) and Graph rows (BeginnerView) —
 * so their Range lines can't drift. The maths lives in src/modulation/patchRange.ts.
 */

import type { SettingsStore } from '../../state/Settings';
import type { OutputStageParams } from '../../modulation/outputStage';
import { patchSwing, solveSwing, swingEditable, type ApplyMode, type Span, type SwingSolution } from '../../modulation/patchRange';
import { TARGETS } from '../targets';
import { whenLiveValues } from '../liveValueBus';
import type { LiveValuesStore } from '../../modulation/LiveValues';
import type { RangeAdapter } from './SlotRow';

let live: LiveValuesStore | null = null;
whenLiveValues((lv) => { live = lv; });

export interface PatchParts {
  target(): string;
  span(): Span;
  stage(): Partial<OutputStageParams>;
  amount(): number;
  mode(): ApplyMode;
  /** Write the solved Amount + Output stage. */
  write(sol: SwingSolution): void;
}

export function makeRangeAdapter(settings: SettingsStore, p: PatchParts): RangeAdapter {
  /** The target's knob value, or null for a target that isn't a numeric Settings key (none, cv:N). */
  const base = (): number | null => {
    const t = p.target();
    if (!t || t === 'none') return null;
    const v = (settings.get as (k: string) => unknown)(t);
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const input = () => {
    const b = base();
    return b == null ? null : { base: b, amount: p.amount(), mode: p.mode(), span: p.span(), stage: p.stage() };
  };
  return {
    label: () => (base() == null ? null : (TARGETS.find((t) => t.v === p.target())?.l ?? p.target())),
    swing: () => { const i = input(); return i ? patchSwing(i) : null; },
    editable: () => { const i = input(); return !!i && swingEditable(i); },
    set: (from, to) => {
      const i = input();
      if (!i) return;
      const sol = solveSwing({ ...i, from, to });
      if (sol) p.write(sol);
    },
    live: () => {
      const t = p.target();
      if (!live || base() == null) return null;
      const v = live.getLive(t);
      return Number.isFinite(v) ? v : null;
    },
  };
}
