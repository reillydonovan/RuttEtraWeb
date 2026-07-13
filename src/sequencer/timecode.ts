/**
 * Timeline transport counter — display-format conversions.
 *
 * Bars/Beats is the timeline's only real clock (`Settings.internalBpm`
 * × `Timeline.beatsPerBar`, the single shared source used everywhere —
 * Classic LFOs, Graph clock nodes, the timeline itself). Timecode,
 * Frames, and Samples are pure REFORMATTINGS of the current playhead
 * position for editors who think in video/audio terms instead of
 * musical time — nothing here changes playback, authoring, or the
 * underlying clock. Same status as the ruler's bar grid: a display,
 * not a second source of truth.
 *
 * Pure, DOM-free, node-testable — same pattern as easings.ts / interp.ts.
 */

export type ReadoutFormat = 'bars' | 'timecode' | 'frames' | 'samples';

/** Standard editorial frame rates offered for Timecode/Frames display. */
export const READOUT_FPS_OPTIONS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60] as const;

/** Standard audio sample rates offered for Samples display. */
export const READOUT_SAMPLE_RATE_OPTIONS = [44100, 48000, 88200, 96000] as const;

/** Bar position -> elapsed seconds, given the shared BPM clock. */
export function barToSeconds(bar: number, bpm: number, beatsPerBar: number): number {
  if (bpm <= 0) return 0;
  return (bar * beatsPerBar * 60) / bpm;
}

/** Elapsed seconds -> bar position, the inverse of `barToSeconds`. */
export function secondsToBar(seconds: number, bpm: number, beatsPerBar: number): number {
  if (beatsPerBar <= 0) return 0;
  return (seconds * bpm) / (beatsPerBar * 60);
}

/**
 * `HH:MM:SS:FF`, non-drop-frame. `fps` may be a broadcast rate like
 * 29.97 — the FF digit range uses its rounded nominal frame count
 * (e.g. 30) since this is a creative tool, not an SMPTE drop-frame
 * mastering path; `fps` itself (not the nominal) still drives the
 * total-frame-count timing so the counter stays accurate.
 */
export function formatTimecode(seconds: number, fps: number): string {
  const nominal = Math.max(1, Math.round(fps));
  const frames = totalFrames(seconds, fps);
  const ff = frames % nominal;
  const totalSecs = Math.floor(frames / nominal);
  const ss = totalSecs % 60;
  const mm = Math.floor(totalSecs / 60) % 60;
  const hh = Math.floor(totalSecs / 3600);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

/** Total elapsed frames at `fps` (rounded, clamped to >= 0). */
export function totalFrames(seconds: number, fps: number): number {
  return Math.max(0, Math.round(seconds * fps));
}

/** Total elapsed samples at `sampleRate` (rounded, clamped to >= 0). */
export function totalSamples(seconds: number, sampleRate: number): number {
  return Math.max(0, Math.round(seconds * sampleRate));
}

/**
 * Render the transport counter for the given format. `bar` is the
 * playhead position; `bpm`/`beatsPerBar` drive the bars<->seconds
 * conversion for the non-bars formats.
 *
 * Non-Bars/Beats formats append the bar position as a trailing anchor
 * (`frame 58 · bar 0.97`) — a raw frame/sample count or an HH:MM:SS:FF
 * clock carries no visual cue for where that lands on the bar ruler,
 * so without it the reading feels disconnected from the timeline
 * you're actually looking at (e.g. "frame 58" reads as some large,
 * arbitrary number when the playhead is barely past bar 0). The anchor
 * is the same number Bars/Beats mode shows on its own, so switching
 * formats never loses that reference point.
 */
export function formatReadout(
  format: ReadoutFormat,
  bar: number,
  lengthBars: number,
  bpm: number,
  beatsPerBar: number,
  fps: number,
  sampleRate: number,
): string {
  if (format === 'bars') return `bar ${bar.toFixed(2)} / ${lengthBars}`;
  const seconds = barToSeconds(bar, bpm, beatsPerBar);
  const anchor = `bar ${bar.toFixed(2)}`;
  if (format === 'timecode') return `${formatTimecode(seconds, fps)}  ·  ${anchor}`;
  if (format === 'frames') return `frame ${totalFrames(seconds, fps)}  ·  ${anchor}`;
  return `smp ${totalSamples(seconds, sampleRate)}  ·  ${anchor}`;
}

/**
 * Timeline LENGTH field — the transport's total-length control follows
 * the same DISPLAY format as the playhead readout (owner request): in
 * Bars/Beats it's bar count as always, but in Timecode it reads as
 * total runtime (seconds), in Frames as a total frame count, and in
 * Samples as a total sample count. `lengthBars` (an integer bar count)
 * stays the ONE stored value in every format — these are editing-unit
 * conversions on top of it, not a second length field.
 */
export function lengthDisplayFromBars(
  format: ReadoutFormat,
  lengthBars: number,
  bpm: number,
  beatsPerBar: number,
  fps: number,
  sampleRate: number,
): number {
  if (format === 'bars') return lengthBars;
  const seconds = barToSeconds(lengthBars, bpm, beatsPerBar);
  if (format === 'timecode') return Math.round(seconds * 100) / 100;
  if (format === 'frames') return totalFrames(seconds, fps);
  return totalSamples(seconds, sampleRate);
}

/** Inverse of `lengthDisplayFromBars` — rounds to a whole bar (the
 *  underlying model's actual unit) and clamps to at least 1. */
export function lengthBarsFromDisplay(
  format: ReadoutFormat,
  displayValue: number,
  bpm: number,
  beatsPerBar: number,
  fps: number,
  sampleRate: number,
): number {
  let bars: number;
  if (format === 'bars') bars = displayValue;
  else if (format === 'timecode') bars = secondsToBar(displayValue, bpm, beatsPerBar);
  else if (format === 'frames') bars = secondsToBar(displayValue / Math.max(1e-9, fps), bpm, beatsPerBar);
  else bars = secondsToBar(displayValue / Math.max(1, sampleRate), bpm, beatsPerBar);
  return Math.max(1, Math.round(bars));
}

/** `M:SS`, or `H:MM:SS` past an hour — a compact ruler-tick label. Full
 *  HH:MM:SS:FF precision is what the transport counter is for; a ruler
 *  tick every bar has no room for that much text. */
function formatShortTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const ss = total % 60;
  const mm = Math.floor(total / 60) % 60;
  const hh = Math.floor(total / 3600);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}

/**
 * Label for one bar-tick on the timeline ruler, in the SAME display
 * format currently selected for the transport counter — so the ruler
 * you're scrubbing along and the number you're reading always speak
 * the same language. Tick POSITIONS stay in bar-space regardless of
 * format (editing/snapping/zoom are all bar-based); only the label
 * text changes. `bar` is always an integer here (one label per bar).
 */
export function formatRulerTick(
  format: ReadoutFormat,
  bar: number,
  bpm: number,
  beatsPerBar: number,
  fps: number,
  sampleRate: number,
): string {
  if (format === 'bars') return String(bar);
  const seconds = barToSeconds(bar, bpm, beatsPerBar);
  if (format === 'timecode') return formatShortTime(seconds);
  if (format === 'frames') return String(totalFrames(seconds, fps));
  return String(totalSamples(seconds, sampleRate));
}
