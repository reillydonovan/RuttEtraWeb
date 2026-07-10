/**
 * Additive listener API (Keyframing v2 full UI): multiple consumers can
 * observe timeline/playhead changes without clobbering the dock's
 * single-assignment callbacks, and `load(null)` — which the legacy
 * `onTimelineChange` deliberately never reports — reaches listeners so
 * the lane editor and panel diamonds can react to a cleared timeline.
 *
 * Uses timelines with no keyframes so the Sequencer never touches the
 * (stubbed) SettingsStore.
 */
import { describe, it, expect } from 'vitest';
import { Sequencer } from '../Sequencer';
import { makeEmptyTimeline, newLaneId, Timeline } from '../types';
import type { SettingsStore } from '../../state/Settings';

const makeSeq = (): Sequencer => new Sequencer({} as unknown as SettingsStore);

describe('addTimelineListener', () => {
  it('fires on load, with the loaded timeline', () => {
    const seq = makeSeq();
    const seen: Array<Timeline | null> = [];
    seq.addTimelineListener((t) => seen.push(t));
    const tl = makeEmptyTimeline('A');
    seq.load(tl);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.name).toBe('A');
  });

  it('fires with null on load(null) — the cleared-timeline signal', () => {
    const seq = makeSeq();
    const seen: Array<Timeline | null> = [];
    seq.load(makeEmptyTimeline('A'));
    seq.addTimelineListener((t) => seen.push(t));
    seq.load(null);
    expect(seen).toEqual([null]);
  });

  it('legacy onTimelineChange still never fires for null (dock contract)', () => {
    const seq = makeSeq();
    let legacyCalls = 0;
    seq.onTimelineChange = () => { legacyCalls++; };
    seq.load(makeEmptyTimeline('A'));
    seq.load(null);
    expect(legacyCalls).toBe(1);
  });

  it('fires on editLanes and coexists with the legacy callback', () => {
    const seq = makeSeq();
    seq.load(makeEmptyTimeline('A'));
    let legacy = 0;
    let listener = 0;
    seq.onTimelineChange = () => { legacy++; };
    seq.addTimelineListener(() => { listener++; });
    seq.editLanes((t) => {
      t.lanes.push({ id: newLaneId(), paramKey: 'zPush', enabled: true, points: [] });
    });
    expect(legacy).toBe(1);
    expect(listener).toBe(1);
    expect(seq.timeline?.lanes).toHaveLength(1);
  });

  it('unsubscribe stops delivery', () => {
    const seq = makeSeq();
    let calls = 0;
    const off = seq.addTimelineListener(() => { calls++; });
    seq.load(makeEmptyTimeline('A'));
    off();
    seq.load(makeEmptyTimeline('B'));
    expect(calls).toBe(1);
  });
});

describe('addPlayheadListener', () => {
  it('fires on seek and supports multiple listeners', () => {
    const seq = makeSeq();
    seq.load(makeEmptyTimeline('A'));
    const a: number[] = [];
    const b: number[] = [];
    seq.addPlayheadListener((bar) => a.push(bar));
    const off = seq.addPlayheadListener((bar) => b.push(bar));
    seq.seek(4);
    off();
    seq.seek(8);
    expect(a).toEqual([4, 8]);
    expect(b).toEqual([4]);
  });
});
