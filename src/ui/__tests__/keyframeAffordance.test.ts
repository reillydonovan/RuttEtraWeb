/**
 * setKeyedValueAtPlayhead: auto-key semantics for the panel slider.
 * Once a param has at least one lane, every edit is keyed: on an
 * existing point it rewrites that point; off one, it auto-creates a
 * new point at the playhead. Editing the base directly (which shifts
 * the WHOLE curve under every other keyframe) must never happen for
 * an automated param — that was the exact bug reported: moving to a
 * bar with no keyframe and adjusting the knob silently rewrote
 * Settings, dragging every other keyframe's resolved value with it.
 */
import { describe, it, expect } from 'vitest';
import { Sequencer } from '../../sequencer/Sequencer';
import { makeEmptyTimeline, newLaneId, Timeline } from '../../sequencer/types';
import { registerSequencer, setKeyedValueAtPlayhead } from '../keyframeAffordance';
import type { SettingsStore } from '../../state/Settings';

class FakeSettings {
  state: Record<string, number> = {};
  get(key: string): unknown { return this.state[key]; }
  set(key: string, v: unknown): void { this.state[key] = v as number; }
  subscribe(): () => void { return () => {}; }
}

function makeSeqWithLane(
  paramKey: string,
  points: { bar: number; value: number }[],
  base = 0,
): { seq: Sequencer; settings: FakeSettings } {
  const settings = new FakeSettings();
  settings.state[paramKey] = base;
  const seq = new Sequencer(settings as unknown as SettingsStore);
  registerSequencer(seq);
  const t: Timeline = makeEmptyTimeline('T');
  t.lanes.push({ id: newLaneId(), paramKey, enabled: true, points });
  seq.load(t);
  return { seq, settings };
}

describe('setKeyedValueAtPlayhead', () => {
  it('returns false for a param with no lane at all (caller falls back to base editing)', () => {
    const settings = new FakeSettings();
    settings.state.zPush = 0.2;
    const seq = new Sequencer(settings as unknown as SettingsStore);
    registerSequencer(seq);
    seq.load(makeEmptyTimeline('T')); // no lanes for zPush
    const handled = setKeyedValueAtPlayhead(settings as unknown as SettingsStore, 'zPush', 1.0);
    expect(handled).toBe(false);
  });

  it('auto-keys a NEW point when the playhead is off an existing keyframe, leaving the base and other points untouched', () => {
    const { seq, settings } = makeSeqWithLane('zPush', [{ bar: 4, value: 0.5 }], 0.2);
    seq.seek(10); // no point here — the reported bug's scenario
    const handled = setKeyedValueAtPlayhead(settings as unknown as SettingsStore, 'zPush', 1.0);
    expect(handled).toBe(true);
    expect(settings.state.zPush).toBe(0.2); // base unchanged — the fix
    const points = seq.timeline!.lanes[0].points;
    expect(points).toHaveLength(2);
    const newPt = points.find((p) => p.bar === 10)!;
    expect(newPt.value).toBeCloseTo(0.8); // 1.0 - base 0.2
    // The ORIGINAL keyframe at bar 4 must still resolve to its old
    // value (0.5 + 0.2 = 0.7) — this is what the base-edit bug broke.
    const oldPt = points.find((p) => p.bar === 4)!;
    expect(oldPt.value).toBeCloseTo(0.5);
  });

  it('rewrites the point at the playhead and leaves the base untouched', () => {
    const { seq, settings } = makeSeqWithLane('zPush', [{ bar: 4, value: 0.5 }], 0.2);
    seq.seek(4);
    const handled = setKeyedValueAtPlayhead(settings as unknown as SettingsStore, 'zPush', 1.0);
    expect(handled).toBe(true);
    expect(settings.state.zPush).toBe(0.2); // base unchanged
    expect(seq.timeline!.lanes[0].points[0].value).toBeCloseTo(0.8); // 1.0 - base 0.2
  });

  it('holds other lanes on the same key steady when rewriting one point', () => {
    const settings = new FakeSettings();
    settings.state.zPush = 0;
    const seq = new Sequencer(settings as unknown as SettingsStore);
    registerSequencer(seq);
    const t = makeEmptyTimeline('T');
    t.lanes.push(
      { id: newLaneId(), paramKey: 'zPush', enabled: true, points: [{ bar: 4, value: 0.3 }] },
      { id: newLaneId(), paramKey: 'zPush', enabled: true, points: [{ bar: 4, value: 0.2 }] },
    );
    seq.load(t);
    seq.seek(4);
    // Live value before edit: base 0 + 0.3 + 0.2 = 0.5. Target the knob
    // at 1.0 — only the FIRST lane's point should absorb the change.
    setKeyedValueAtPlayhead(settings as unknown as SettingsStore, 'zPush', 1.0);
    expect(seq.timeline!.lanes[0].points[0].value).toBeCloseTo(0.8); // 1.0 - 0 - 0.2(other)
    expect(seq.timeline!.lanes[1].points[0].value).toBeCloseTo(0.2); // untouched
  });

  it('collapses a drag gesture (snapshot:false) into a single undo step', () => {
    const { seq, settings } = makeSeqWithLane('zPush', [{ bar: 4, value: 0 }]);
    seq.seek(4);
    setKeyedValueAtPlayhead(settings as unknown as SettingsStore, 'zPush', 0.3, { snapshot: true });
    setKeyedValueAtPlayhead(settings as unknown as SettingsStore, 'zPush', 0.6, { snapshot: false });
    setKeyedValueAtPlayhead(settings as unknown as SettingsStore, 'zPush', 0.9, { snapshot: false });
    expect(seq.timeline!.lanes[0].points[0].value).toBeCloseTo(0.9);
    seq.undo();
    // One undo restores all the way back to BEFORE the whole gesture.
    expect(seq.timeline!.lanes[0].points[0].value).toBeCloseTo(0);
    expect(seq.canUndo()).toBe(false);
  });
});
