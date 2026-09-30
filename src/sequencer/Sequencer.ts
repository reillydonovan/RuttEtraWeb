/**
 * Timeline / Scene Sequencer engine.
 *
 * Drives `Settings` from a `Timeline` over time. The render loop calls
 * `tick(dt)` once per frame; the engine advances the playhead, finds the two
 * keyframes bracketing it, lerps a `Partial<Settings>` between them, and
 * applies the result via `settings.batchUpdate()`.
 *
 * Authoring API mutates the timeline in place and pushes a deep clone onto
 * an undo stack. UI listens via the on* event callbacks.
 */

import type { SettingsStore } from '../state/Settings';
import { CONNECTION_SETTING_KEYS } from '../state/Settings';
import { MidiClock } from '../midi/MidiClock';
import { applyEasing } from './easings';
import { laneOffsets } from './lanes';
import { lerpSnapshot, pickSnapshot } from './interp';

/** Duck-typed slice of LiveValuesStore the sequencer needs (keeps the
 *  module dependency-light and trivially stubbable in tests). */
interface LiveValuesLike {
  setContributions(namespace: string, offsets?: Map<string, number>): void;
}
import {
  Keyframe,
  Timeline,
  newKeyframeId,
  DEFAULT_EXCLUDED_PARAMS,
} from './types';

const HISTORY_CAP = 50;

/** A timeline's exclusion list plus the connection settings no keyframe
 *  may ever write (see CONNECTION_SETTING_KEYS in Settings.ts). */
function excludedSet(list: readonly string[]): Set<string> {
  return new Set([...list, ...CONNECTION_SETTING_KEYS]);
}

function deepClone<T>(v: T): T {
  // structuredClone is widely available in modern browsers; fall back to JSON.
  try {
    return (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v))) as T;
  } catch {
    return JSON.parse(JSON.stringify(v)) as T;
  }
}

function sortKeyframes(kfs: Keyframe[]): Keyframe[] {
  kfs.sort((a, b) => a.bar - b.bar);
  return kfs;
}

export class Sequencer {
  /** Currently loaded timeline (mutated by authoring API). */
  timeline: Timeline | null = null;

  playheadBar = 0;
  isPlaying = false;

  // ---------- events ----------
  // ADDITIVE accessors (v1.12.1, multi-instance TimelineDocks): every
  // `seq.onX = fn` assignment SUBSCRIBES rather than replaces, so a
  // second timeline instance (or RecordSection, which was silently
  // clobbering the dock's callbacks before) no longer breaks the first.
  // Reading `this.onX` yields a dispatcher over all subscribers (or
  // undefined when none), so existing `this.onX?.(...)` call sites and
  // truthiness checks keep working unchanged.
  private cbPlayState = new Set<(playing: boolean) => void>();
  private cbPlayhead2 = new Set<(bar: number) => void>();
  private cbKeyframe = new Set<(kf: Keyframe) => void>();
  private cbTimeline = new Set<(t: Timeline) => void>();
  private cbSelection = new Set<(id: string | null) => void>();

  set onPlayStateChange(fn: ((playing: boolean) => void) | undefined) { if (fn) this.cbPlayState.add(fn); }
  get onPlayStateChange(): ((playing: boolean) => void) | undefined {
    return this.cbPlayState.size ? (p) => { for (const f of this.cbPlayState) f(p); } : undefined;
  }
  set onPlayheadChange(fn: ((bar: number) => void) | undefined) { if (fn) this.cbPlayhead2.add(fn); }
  get onPlayheadChange(): ((bar: number) => void) | undefined {
    return this.cbPlayhead2.size ? (b) => { for (const f of this.cbPlayhead2) f(b); } : undefined;
  }
  set onKeyframeReached(fn: ((kf: Keyframe) => void) | undefined) { if (fn) this.cbKeyframe.add(fn); }
  get onKeyframeReached(): ((kf: Keyframe) => void) | undefined {
    return this.cbKeyframe.size ? (k) => { for (const f of this.cbKeyframe) f(k); } : undefined;
  }
  set onTimelineChange(fn: ((t: Timeline) => void) | undefined) { if (fn) this.cbTimeline.add(fn); }
  get onTimelineChange(): ((t: Timeline) => void) | undefined {
    return this.cbTimeline.size ? (t) => { for (const f of this.cbTimeline) f(t); } : undefined;
  }
  set onSelectionChange(fn: ((id: string | null) => void) | undefined) { if (fn) this.cbSelection.add(fn); }
  get onSelectionChange(): ((id: string | null) => void) | undefined {
    return this.cbSelection.size ? (i) => { for (const f of this.cbSelection) f(i); } : undefined;
  }

  // Additive multi-listener API alongside the single-assignment callbacks
  // above (which TimelineDock owns). Unlike `onTimelineChange`, timeline
  // listeners also fire on `load(null)` so consumers can react to the
  // timeline being cleared.
  private timelineListeners = new Set<(t: Timeline | null) => void>();
  private playheadListeners = new Set<(bar: number) => void>();

  addTimelineListener(fn: (t: Timeline | null) => void): () => void {
    this.timelineListeners.add(fn);
    return () => this.timelineListeners.delete(fn);
  }
  addPlayheadListener(fn: (bar: number) => void): () => void {
    this.playheadListeners.add(fn);
    return () => this.playheadListeners.delete(fn);
  }

  selectedKeyframeId: string | null = null;

  // ---------- private ----------
  private midiClock: MidiClock | null = null;
  private excluded: Set<string> = excludedSet(DEFAULT_EXCLUDED_PARAMS);
  /** Last applied Partial<Settings> output; used to skip no-op writes. */
  private lastApplied: Partial<unknown> | null = null;
  private history: Timeline[] = [];
  private future: Timeline[] = [];
  private prevPlayhead = 0;

  /** Temporary loop override (used by Record-Timeline). null = use timeline.loop. */
  private loopOverride: boolean | null = null;

  constructor(private settings: SettingsStore) {}

  // ====================================================================
  // Lifecycle / sync
  // ====================================================================

  attachMidiClock(c: MidiClock | null): void {
    this.midiClock = c;
  }

  /**
   * v2 (Keyframing v2): attach the shared LiveValuesStore so automation
   * lanes can contribute relative offsets under the 'timeline'
   * namespace — the third offset-writer alongside Classic and Graph.
   * Optional: without it, lanes are inert (data still round-trips).
   */
  private liveValues: LiveValuesLike | null = null;
  setLiveValues(lv: LiveValuesLike | null): void {
    this.liveValues = lv;
    this.applyLanes();
  }

  /**
   * Re-evaluate every enabled lane at the current playhead and push the
   * offsets. Public so the lane-editor UI can refresh after edits; also
   * called from every playhead move (tick / seek / load / stop). The
   * same-frame clear inside setContributions means muted or deleted
   * lanes snap their targets back to base instantly.
   */
  applyLanes(): void {
    if (!this.liveValues) return;
    const lanes = this.timeline?.lanes ?? [];
    this.liveValues.setContributions('timeline', laneOffsets(lanes, this.playheadBar));
  }

  load(t: Timeline | null): void {
    this.timeline = t;
    this.playheadBar = 0;
    this.prevPlayhead = 0;
    this.isPlaying = false;
    this.lastApplied = null;
    this.history = [];
    this.future = [];
    this.selectedKeyframeId = null;
    // v2: re-evaluate lanes for the new (or cleared) timeline; clearing
    // drops the 'timeline' namespace contributions the same frame.
    this.applyLanes();
    if (t) {
      this.excluded = excludedSet(t.excludedParams);
      sortKeyframes(t.keyframes);
      // Park settings at the first keyframe (if any) so the screen reflects
      // the loaded timeline immediately.
      if (t.keyframes.length > 0) {
        this.applySnapshotImmediate(t.keyframes[0]);
      }
    }
    // Fires the legacy callback only for a real timeline, but always fans
    // out to addTimelineListener subscribers — a null here means "timeline
    // cleared", which the lane editor and panel diamonds must observe.
    this.fireTimelineChange();
    this.fireSelection();
    this.firePlayState();
    this.firePlayhead();
  }

  // ====================================================================
  // Transport
  // ====================================================================

  play(): void {
    if (!this.timeline) return;
    if (!this.isPlaying) {
      this.isPlaying = true;
      this.firePlayState();
    }
  }

  pause(): void {
    if (this.isPlaying) {
      this.isPlaying = false;
      this.firePlayState();
    }
  }

  stop(): void {
    this.isPlaying = false;
    this.playheadBar = 0;
    this.prevPlayhead = 0;
    this.firePlayState();
    this.firePlayhead();
    // Re-park settings at the first keyframe to reset the visual.
    const t = this.timeline;
    if (t && t.keyframes.length > 0) this.applySnapshotImmediate(t.keyframes[0]);
  }

  seek(bar: number): void {
    if (!this.timeline) return;
    const len = Math.max(0.0001, this.timeline.lengthBars);
    const clamped = Math.max(0, Math.min(len, bar));
    this.playheadBar = clamped;
    this.prevPlayhead = clamped;
    this.firePlayhead();
    this.applyAtPlayhead();
  }

  /**
   * Set the global internal BPM. Routed to `Settings.internalBpm` (single
   * shared source) since v8 — the Timeline no longer owns its own BPM.
   * No-ops if the value is unchanged.
   */
  setBpm(bpm: number): void {
    const clamped = Math.max(20, Math.min(400, bpm));
    if (this.settings.get('internalBpm') !== clamped) {
      this.settings.set('internalBpm', clamped);
    }
  }

  /** Temporarily disable looping for this run (Record Timeline). */
  setLoopOverride(loop: boolean | null): void {
    this.loopOverride = loop;
  }

  // ====================================================================
  // Authoring (undo/redo)
  // ====================================================================

  private snapshotForUndo(): void {
    if (!this.timeline) return;
    this.history.push(deepClone(this.timeline));
    if (this.history.length > HISTORY_CAP) this.history.shift();
    this.future = [];
  }

  /**
   * v2: mutate the timeline's lanes with undo support, then re-apply
   * offsets and notify listeners. The lane editor's single write path.
   *
   * `snapshot: false` skips pushing an undo entry for this call — for
   * continuous gestures (dragging the panel knob while parked on a
   * keyframe) where the caller collapses many rapid edits into one
   * undo step by passing `snapshot: false` for every call after the
   * first in the gesture. Defaults to true (every other call site).
   */
  editLanes(fn: (t: Timeline) => void, opts?: { snapshot?: boolean }): void {
    if (!this.timeline) return;
    if (opts?.snapshot !== false) this.snapshotForUndo();
    fn(this.timeline);
    this.applyLanes();
    this.fireTimelineChange();
  }

  addKeyframe(bar: number, name?: string): Keyframe {
    if (!this.timeline) throw new Error('No timeline loaded');
    this.snapshotForUndo();
    const snapshot = this.snapshotCurrentSettings();
    const kf: Keyframe = {
      id: newKeyframeId(),
      bar: this.clampBar(bar),
      presetSnapshot: snapshot,
      presetName: name,
      easing: 'easeInOut',
    };
    this.timeline.keyframes.push(kf);
    sortKeyframes(this.timeline.keyframes);
    this.fireTimelineChange();
    return kf;
  }

  /** Add a keyframe whose snapshot comes from a specific preset values blob (drag-from-presets). */
  addKeyframeFromPreset(bar: number, presetValues: Partial<unknown>, name?: string): Keyframe {
    if (!this.timeline) throw new Error('No timeline loaded');
    this.snapshotForUndo();
    const snapshot = this.filterExcluded(presetValues as Record<string, unknown>);
    const kf: Keyframe = {
      id: newKeyframeId(),
      bar: this.clampBar(bar),
      presetSnapshot: snapshot,
      presetName: name,
      easing: 'easeInOut',
    };
    this.timeline.keyframes.push(kf);
    sortKeyframes(this.timeline.keyframes);
    this.fireTimelineChange();
    return kf;
  }

  removeKeyframe(id: string): void {
    if (!this.timeline) return;
    const i = this.timeline.keyframes.findIndex(k => k.id === id);
    if (i < 0) return;
    this.snapshotForUndo();
    this.timeline.keyframes.splice(i, 1);
    if (this.selectedKeyframeId === id) {
      this.selectedKeyframeId = null;
      this.fireSelection();
    }
    this.fireTimelineChange();
  }

  moveKeyframe(id: string, newBar: number): void {
    if (!this.timeline) return;
    const kf = this.timeline.keyframes.find(k => k.id === id);
    if (!kf || kf.locked) return;
    if (kf.bar === newBar) return;
    this.snapshotForUndo();
    kf.bar = this.clampBar(newBar);
    sortKeyframes(this.timeline.keyframes);
    this.fireTimelineChange();
  }

  updateKeyframe(id: string, patch: Partial<Keyframe>): void {
    if (!this.timeline) return;
    const kf = this.timeline.keyframes.find(k => k.id === id);
    if (!kf) return;
    this.snapshotForUndo();
    Object.assign(kf, patch);
    if ('bar' in patch) {
      kf.bar = this.clampBar(kf.bar);
      sortKeyframes(this.timeline.keyframes);
    }
    this.fireTimelineChange();
  }

  duplicateKeyframe(id: string): Keyframe {
    if (!this.timeline) throw new Error('No timeline loaded');
    const src = this.timeline.keyframes.find(k => k.id === id);
    if (!src) throw new Error('Keyframe not found');
    this.snapshotForUndo();
    const offset = 1; // one bar later
    const dup: Keyframe = {
      ...deepClone(src),
      id: newKeyframeId(),
      bar: this.clampBar(src.bar + offset),
    };
    this.timeline.keyframes.push(dup);
    sortKeyframes(this.timeline.keyframes);
    this.fireTimelineChange();
    return dup;
  }

  /** Replace the keyframe's snapshot with a fresh capture of current Settings. */
  replaceSnapshot(id: string): void {
    if (!this.timeline) return;
    const kf = this.timeline.keyframes.find(k => k.id === id);
    if (!kf) return;
    this.snapshotForUndo();
    kf.presetSnapshot = this.snapshotCurrentSettings();
    this.fireTimelineChange();
  }

  /** Apply a keyframe's snapshot now without moving the playhead. */
  preview(id: string): void {
    if (!this.timeline) return;
    const kf = this.timeline.keyframes.find(k => k.id === id);
    if (!kf) return;
    this.applySnapshotImmediate(kf);
  }

  setBeatsPerBar(n: number): void {
    if (!this.timeline) return;
    this.snapshotForUndo();
    this.timeline.beatsPerBar = Math.max(1, Math.min(16, Math.round(n)));
    this.fireTimelineChange();
  }

  setLengthBars(n: number): void {
    if (!this.timeline) return;
    this.snapshotForUndo();
    this.timeline.lengthBars = Math.max(1, Math.round(n));
    if (this.playheadBar > this.timeline.lengthBars) {
      this.playheadBar = this.timeline.lengthBars;
      this.firePlayhead();
    }
    this.fireTimelineChange();
  }

  setLoop(loop: boolean): void {
    if (!this.timeline) return;
    this.snapshotForUndo();
    this.timeline.loop = loop;
    this.fireTimelineChange();
  }

  setSyncMode(mode: 'internal' | 'midi'): void {
    if (!this.timeline) return;
    this.snapshotForUndo();
    this.timeline.syncMode = mode;
    this.fireTimelineChange();
  }

  rename(name: string): void {
    if (!this.timeline) return;
    this.snapshotForUndo();
    this.timeline.name = name;
    this.fireTimelineChange();
  }

  selectKeyframe(id: string | null): void {
    if (this.selectedKeyframeId === id) return;
    this.selectedKeyframeId = id;
    this.fireSelection();
  }

  // ---------- undo / redo ----------

  canUndo(): boolean { return this.history.length > 0; }
  canRedo(): boolean { return this.future.length > 0; }

  undo(): void {
    if (!this.timeline || this.history.length === 0) return;
    this.future.push(deepClone(this.timeline));
    const prev = this.history.pop()!;
    this.timeline = prev;
    this.excluded = excludedSet(prev.excludedParams);
    sortKeyframes(this.timeline.keyframes);
    if (this.selectedKeyframeId
        && !this.timeline.keyframes.find(k => k.id === this.selectedKeyframeId)) {
      this.selectedKeyframeId = null;
      this.fireSelection();
    }
    this.fireTimelineChange();
  }

  redo(): void {
    if (!this.timeline || this.future.length === 0) return;
    this.history.push(deepClone(this.timeline));
    const next = this.future.pop()!;
    this.timeline = next;
    this.excluded = excludedSet(next.excludedParams);
    sortKeyframes(this.timeline.keyframes);
    this.fireTimelineChange();
  }

  // ====================================================================
  // Per-frame
  // ====================================================================

  tick(dtSec: number): void {
    if (!this.isPlaying || !this.timeline) return;
    const t = this.timeline;
    if (t.lengthBars <= 0) return;

    // Determine current BPM. Internal sync reads the single shared
    // `Settings.internalBpm`; MIDI sync follows the live MIDI clock and
    // holds at the last received value when the clock is silent (no
    // silent fallback to internal BPM — see master spec).
    let bpm = this.settings.get('internalBpm');
    if (t.syncMode === 'midi' && this.midiClock && this.midiClock.bpm > 0) {
      bpm = this.midiClock.bpm;
    }

    const beatsPerSec = bpm / 60;
    const barsPerSec  = beatsPerSec / Math.max(1, t.beatsPerBar);

    this.prevPlayhead = this.playheadBar;
    this.playheadBar += dtSec * barsPerSec;

    const loop = this.loopOverride !== null ? this.loopOverride : t.loop;
    let wrapped = false;
    if (this.playheadBar >= t.lengthBars) {
      if (loop) {
        // Wrap; the segment that "crossed" the boundary still fires
        // keyframe-reached for any kfs after `prevPlayhead` up to lengthBars.
        this.playheadBar = this.playheadBar % t.lengthBars;
        wrapped = true;
      } else {
        this.playheadBar = t.lengthBars;
        this.isPlaying = false;
      }
    }

    this.applyAtPlayhead();
    this.detectKeyframeCrossings(wrapped);
    this.firePlayhead();
    if (!this.isPlaying) this.firePlayState();
  }

  // ====================================================================
  // Internals
  // ====================================================================

  private applyAtPlayhead(): void {
    const t = this.timeline;
    if (!t) return;
    // v2: lanes evaluate at every playhead position, independent of
    // whether any preset keyframes exist.
    this.applyLanes();
    const kfs = t.keyframes;
    if (kfs.length === 0) return;

    if (kfs.length === 1) {
      this.applySnapshotImmediate(kfs[0]);
      return;
    }

    // Find bracketing keyframes A (last with bar <= head) and B (first with bar > head).
    const head = this.playheadBar;
    let aIdx = 0;
    let bIdx = 0;
    if (head <= kfs[0].bar) {
      aIdx = bIdx = 0;
    } else if (head >= kfs[kfs.length - 1].bar) {
      aIdx = bIdx = kfs.length - 1;
    } else {
      for (let i = 0; i < kfs.length - 1; i++) {
        if (head >= kfs[i].bar && head < kfs[i + 1].bar) {
          aIdx = i;
          bIdx = i + 1;
          break;
        }
      }
    }
    const A = kfs[aIdx];
    const B = kfs[bIdx];

    let diff: Partial<unknown>;
    if (A === B) {
      // Out of range or only one kf bracketed.
      diff = pickSnapshot(A.presetSnapshot, this.excluded);
      // Skip if identical to last applied.
      if (this.lastApplied && shallowEqualKeyOrder(diff as Record<string, unknown>, this.lastApplied as Record<string, unknown>)) {
        return;
      }
    } else {
      const span = B.bar - A.bar;
      const t01 = span > 0 ? (head - A.bar) / span : 0;
      // Apply easing curve from B (incoming).
      let eased = applyEasing(B.easing, t01);
      // `hold` semantics: stay at A until the incoming kf is reached.
      if (B.easing === 'hold') eased = t01 >= 1 ? 1 : 0;
      // `step` semantics: jump to B at t > 0.
      else if (B.easing === 'step') eased = t01 > 0 ? 1 : 0;
      diff = lerpSnapshot(
        A.presetSnapshot,
        B.presetSnapshot,
        eased,
        this.excluded,
        this.lastApplied as Partial<unknown> | undefined,
      );
    }

    if (Object.keys(diff as object).length > 0) {
      this.settings.batchUpdate(diff as Partial<unknown> as never);
    }
    // Track last applied as the cumulative state we've sent (merge in).
    this.lastApplied = mergeSnapshot(this.lastApplied as Record<string, unknown> | null, diff as Record<string, unknown>);
  }

  private applySnapshotImmediate(kf: Keyframe): void {
    const diff = pickSnapshot(kf.presetSnapshot, this.excluded);
    if (Object.keys(diff).length > 0) {
      this.settings.batchUpdate(diff as never);
    }
    this.lastApplied = { ...(diff as Record<string, unknown>) };
  }

  private detectKeyframeCrossings(wrapped: boolean): void {
    const t = this.timeline;
    if (!t || t.keyframes.length === 0 || !this.onKeyframeReached) return;
    const head = this.playheadBar;
    const prev = this.prevPlayhead;
    const len = t.lengthBars;

    const inSegment = (bar: number, lo: number, hi: number): boolean =>
      bar > lo - 1e-6 && bar <= hi + 1e-6;

    if (!wrapped) {
      for (const kf of t.keyframes) {
        if (inSegment(kf.bar, prev, head) && kf.bar !== prev) {
          this.onKeyframeReached?.(kf);
        }
      }
    } else {
      // Two segments: [prev, len] and [0, head].
      for (const kf of t.keyframes) {
        if (inSegment(kf.bar, prev, len) && kf.bar !== prev) {
          this.onKeyframeReached?.(kf);
        } else if (inSegment(kf.bar, 0, head)) {
          this.onKeyframeReached?.(kf);
        }
      }
    }
  }

  /** Snapshot current Settings minus excluded keys, returned as Partial<Settings>. */
  private snapshotCurrentSettings(): Partial<unknown> {
    const all = this.settings.all as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(all)) {
      if (this.excluded.has(k)) continue;
      // Skip our internal version field if any.
      if (k === '_v') continue;
      out[k] = all[k];
    }
    return out;
  }

  private filterExcluded(values: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(values)) {
      if (this.excluded.has(k)) continue;
      out[k] = values[k];
    }
    return out;
  }

  private clampBar(bar: number): number {
    const len = this.timeline?.lengthBars ?? 1;
    return Math.max(0, Math.min(len, bar));
  }

  // ---------- event fan-out ----------

  private firePlayState(): void {
    this.onPlayStateChange?.(this.isPlaying);
  }
  private firePlayhead(): void {
    this.onPlayheadChange?.(this.playheadBar);
    for (const fn of this.playheadListeners) fn(this.playheadBar);
  }
  private fireTimelineChange(): void {
    if (this.timeline) this.onTimelineChange?.(this.timeline);
    for (const fn of this.timelineListeners) fn(this.timeline);
  }
  private fireSelection(): void {
    this.onSelectionChange?.(this.selectedKeyframeId);
  }
}

// --- helpers ---------------------------------------------------------------

function shallowEqualKeyOrder(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.is(a[k], b[k])) return false;
  }
  return true;
}

function mergeSnapshot(
  base: Record<string, unknown> | null,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out = base ? { ...base } : {};
  for (const k of Object.keys(patch)) out[k] = patch[k];
  return out;
}
