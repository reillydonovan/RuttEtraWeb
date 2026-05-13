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

export interface Timeline {
  _v: 1;
  id: string;
  name: string;
  bpm: number;
  beatsPerBar: number;
  lengthBars: number;
  loop: boolean;
  syncMode: SequencerSyncMode;
  /** Settings keys that should NOT be touched during playback. */
  excludedParams: string[];
  /** Sorted ascending by `bar`. */
  keyframes: Keyframe[];
}

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
];

export function makeEmptyTimeline(name = 'Untitled', overrides: Partial<Timeline> = {}): Timeline {
  return {
    _v: 1,
    id: newTimelineId(),
    name,
    bpm: 120,
    beatsPerBar: 4,
    lengthBars: 16,
    loop: true,
    syncMode: 'internal',
    excludedParams: [...DEFAULT_EXCLUDED_PARAMS],
    keyframes: [],
    ...overrides,
  };
}

let _idCounter = 0;
export function newTimelineId(): string {
  return `tl_${Date.now().toString(36)}_${(_idCounter++).toString(36)}`;
}
export function newKeyframeId(): string {
  return `kf_${Date.now().toString(36)}_${(_idCounter++).toString(36)}`;
}
