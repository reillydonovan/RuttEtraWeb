/**
 * Timeline / Sequencer schema.
 *
 * Snapshots are *plain* `Partial<Settings>` so they survive preset edits and
 * round-trip through JSON without any reference resolution.
 */

import { Settings } from '../state/Settings';

export type EasingType = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'step' | 'hold';
export type SequencerSyncMode = 'internal' | 'midi';

export interface Keyframe {
  id: string;
  /** Bar position; floats allowed (e.g. 4.5 for the second beat of bar 5). */
  bar: number;
  /** Full settings snapshot at this keyframe. */
  presetSnapshot: Partial<Settings>;
  /** Optional human label. */
  presetName?: string;
  /** Easing applied when interpolating INTO this keyframe from the previous one. */
  easing: EasingType;
  /** Prevents accidental drag/delete. */
  locked?: boolean;
  /** User-assigned color for visual grouping (CSS hex). */
  color?: string;
}

/**
 * v2 (Keyframing v2, AUDIT item 25): a point on an automation lane.
 * `value` is a RELATIVE OFFSET, not an absolute — lanes write through
 * `LiveValuesStore` as a third offset-writer alongside the two
 * modulation engines, summing with base exactly like CV into an input
 * sums with the knob (owner decision, AUDIT.md). The UI is responsible
 * for previewing the resolved absolute value.
 */
export interface AutomationPoint {
  /** Bar position; floats allowed. */
  bar: number;
  /** Relative offset added to the param's base value. */
  value: number;
  /** Easing INTO this point from the previous one. Default linear. */
  easing?: EasingType;
}

/** v2: one per-parameter automation lane. */
export interface AutomationLane {
  id: string;
  /** Settings key this lane offsets (a ModTarget). */
  paramKey: string;
  /** Muted lanes contribute nothing (target snaps to base instantly). */
  enabled: boolean;
  /** Sorted ascending by `bar`. Values clamp-hold outside the range. */
  points: AutomationPoint[];
}

export interface Timeline {
  _v: 2;
  id: string;
  name: string;
  beatsPerBar: number;
  lengthBars: number;
  loop: boolean;
  syncMode: SequencerSyncMode;
  /** Settings keys that should NOT be touched during playback. */
  excludedParams: string[];
  /** Sorted ascending by `bar`. */
  keyframes: Keyframe[];
  /** v2: per-parameter automation lanes (relative offsets via LiveValues). */
  lanes: AutomationLane[];
}

// NOTE: `Timeline.bpm` was removed in v8 — BPM is owned by the global
// `Settings.internalBpm` (single shared source) and read by the sequencer
// at tick time. The timeline-store migration collects any non-default
// per-timeline BPMs and surfaces them via a one-time toast rather than
// silently importing the value into `internalBpm`.

/**
 * Default exclusion list. Camera (so the user can fly around during playback),
 * source/recorder/UI/I/O bindings, and the timeline + help meta-fields
 * themselves never get overwritten by interpolation.
 */
export const DEFAULT_EXCLUDED_PARAMS: string[] = [
  // Camera
  'defaultView', 'cameraMode', 'cameraFov', 'cameraNear', 'cameraFar',
  'autoOrbit', 'autoOrbitSpeed', 'flySpeed', 'flyBoost',

  // Source
  'sourceKind', 'deviceId', 'requestedWidth', 'requestedHeight', 'requestedFps',

  // Panel UI
  'panelDock', 'panelCollapsed', 'panelTab', 'hudVisible',

  // I/O bindings
  'midiInputId', 'midiOutputId', 'midiBindings',
  'oscBridgeUrl', 'oscAutoConnect', 'oscBindings',

  // Recorder
  'recordIncludeMic', 'recordBitrateMbps', 'recordPreferredFormat', 'recordFps',

  // Help / timeline meta
  'helpSeen', 'helpAutoOpen', 'helpActiveTab',
  'timelineDock', 'timelineHeight', 'activeTimelineId',
  'timelineReadoutFormat', 'timelineReadoutFps', 'timelineReadoutSampleRate',
];

export function makeEmptyTimeline(name = 'Untitled', overrides: Partial<Timeline> = {}): Timeline {
  return {
    _v: 2,
    id: newTimelineId(),
    name,
    beatsPerBar: 4,
    lengthBars: 16,
    loop: true,
    syncMode: 'internal',
    excludedParams: [...DEFAULT_EXCLUDED_PARAMS],
    keyframes: [],
    lanes: [],
    ...overrides,
  };
}

export function newLaneId(): string {
  return `ln_${Date.now().toString(36)}_${(_idCounter++).toString(36)}`;
}

let _idCounter = 0;
export function newTimelineId(): string {
  return `tl_${Date.now().toString(36)}_${(_idCounter++).toString(36)}`;
}
export function newKeyframeId(): string {
  return `kf_${Date.now().toString(36)}_${(_idCounter++).toString(36)}`;
}
