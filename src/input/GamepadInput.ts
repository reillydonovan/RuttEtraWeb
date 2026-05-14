/**
 * Gamepad / HID input as a control surface for modulation.
 *
 * Browsers expose connected gamepads (and many MIDI fighter / fader
 * surfaces / Stream Decks with the right firmware) via the Gamepad API
 * — no permission prompt needed. Axes report -1..1 and buttons 0..1
 * (some are pressure-sensitive). The API has *no event loop* of its
 * own: the right pattern is to poll once per render frame and snapshot
 * the latest values for downstream consumers.
 *
 * This isn't strictly CV, but it covers the same use case ("physical
 * knobs and sliders driving synth params") and is a free win because
 * the API is already available in every modern browser. Spec lists it
 * as Route D in the v9 voltage-control plan.
 *
 * Usage: instantiate once, call `poll()` from the render loop, and
 * read with `getAxis(idx)` / `getButton(idx)`. The variance buffers
 * support CV-style "Learn" — pick whichever axis the user just
 * wiggled the most over a short window.
 */

import { SettingsStore } from '../state/Settings';

export interface GamepadStatus {
  /** Index in `navigator.getGamepads()` (-1 = no gamepad bound). */
  index: number;
  id: string;
  axisCount: number;
  buttonCount: number;
  connected: boolean;
}

export type GamepadStatusListener = (s: GamepadStatus) => void;

export class GamepadInput {
  private status: GamepadStatus = {
    index: -1, id: '', axisCount: 0, buttonCount: 0, connected: false,
  };
  private listeners = new Set<GamepadStatusListener>();

  /** Smoothed axes -1..1, deadzone applied. */
  private axes: Float32Array = new Float32Array(0);
  /** Buttons 0..1 (pressed = 1.0, pressure-sensitive otherwise). */
  private buttons: Float32Array = new Float32Array(0);
  /** Variance per axis over a rolling ~2s window (for Learn). */
  private axisVar: Float32Array = new Float32Array(0);
  private axisMean: Float32Array = new Float32Array(0);
  /** Variance per button over the same window. */
  private buttonVar: Float32Array = new Float32Array(0);
  private buttonMean: Float32Array = new Float32Array(0);
  /** True if at least one snapshot has been read since `start()`. */
  private gotData = false;

  /** Decay factor for the rolling-variance window. Tuned for ~2s @ 60Hz. */
  private varDecay = 1 / (60 * 2);

  constructor(private settings: SettingsStore) {
    settings.subscribe('gamepadIndex', () => this.refreshStatus());
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', () => this.refreshStatus());
      window.addEventListener('gamepaddisconnected', () => this.refreshStatus());
    }
    this.refreshStatus();
  }

  subscribe(fn: GamepadStatusListener): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  /**
   * List every gamepad the browser sees right now. Some browsers don't
   * populate this until a gamepad sends its first input — calling this
   * after a `gamepadconnected` event is the most reliable.
   */
  list(): { index: number; id: string }[] {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
    const pads = navigator.getGamepads();
    const out: { index: number; id: string }[] = [];
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p) out.push({ index: i, id: p.id });
    }
    return out;
  }

  /** Call once per render frame from the main loop. */
  poll(): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const idx = this.settings.get('gamepadIndex');
    if (idx < 0) {
      // No gamepad bound — keep buffers zeroed so engines see "no input".
      if (this.status.connected) {
        this.zeroBuffers();
        this.refreshStatus();
      }
      return;
    }
    const pads = navigator.getGamepads();
    const pad = pads[idx];
    if (!pad) {
      if (this.status.connected) {
        this.zeroBuffers();
        this.setStatus({ ...this.status, connected: false });
      }
      return;
    }

    if (!this.status.connected || pad.id !== this.status.id) {
      this.setStatus({
        index: idx,
        id: pad.id,
        axisCount: pad.axes.length,
        buttonCount: pad.buttons.length,
        connected: true,
      });
    }

    if (this.axes.length !== pad.axes.length) {
      this.axes = new Float32Array(pad.axes.length);
      this.axisVar = new Float32Array(pad.axes.length);
      this.axisMean = new Float32Array(pad.axes.length);
    }
    if (this.buttons.length !== pad.buttons.length) {
      this.buttons = new Float32Array(pad.buttons.length);
      this.buttonVar = new Float32Array(pad.buttons.length);
      this.buttonMean = new Float32Array(pad.buttons.length);
    }

    const dz = this.settings.get('gamepadDeadzone');
    const decay = this.varDecay;
    for (let i = 0; i < pad.axes.length; i++) {
      let v = pad.axes[i];
      if (Math.abs(v) < dz) v = 0;
      this.axes[i] = v;
      // Rolling variance via Welford-style decayed update.
      const diff = v - this.axisMean[i];
      this.axisMean[i] += diff * decay;
      const d2 = v - this.axisMean[i];
      this.axisVar[i] = this.axisVar[i] * (1 - decay) + diff * d2 * decay;
    }
    for (let i = 0; i < pad.buttons.length; i++) {
      const b = pad.buttons[i];
      const v = typeof b === 'number' ? b : b.value;
      this.buttons[i] = v;
      const diff = v - this.buttonMean[i];
      this.buttonMean[i] += diff * decay;
      const d2 = v - this.buttonMean[i];
      this.buttonVar[i] = this.buttonVar[i] * (1 - decay) + diff * d2 * decay;
    }
    this.gotData = true;
  }

  /** -1..1 (after deadzone). 0 if axis index out of range or pad disconnected. */
  getAxis(i: number): number {
    if (i < 0 || i >= this.axes.length) return 0;
    return this.axes[i];
  }

  /** 0..1. */
  getButton(i: number): number {
    if (i < 0 || i >= this.buttons.length) return 0;
    return this.buttons[i];
  }

  /** Variance of axis `i` over the last ~2s — for CV Learn. */
  getAxisVariance(i: number): number {
    if (i < 0 || i >= this.axisVar.length) return 0;
    return this.axisVar[i];
  }

  /** Index of the axis with the highest variance, or -1 if nothing moved. */
  pickHighestVarianceAxis(minVariance = 0.005): number {
    let best = -1;
    let bestVar = minVariance;
    for (let i = 0; i < this.axisVar.length; i++) {
      if (this.axisVar[i] > bestVar) { bestVar = this.axisVar[i]; best = i; }
    }
    return best;
  }

  // -------------------- internals --------------------

  private zeroBuffers(): void {
    this.axes.fill(0);
    this.buttons.fill(0);
    this.axisVar.fill(0);
    this.buttonVar.fill(0);
    this.axisMean.fill(0);
    this.buttonMean.fill(0);
    this.gotData = false;
  }

  private refreshStatus(): void {
    const idx = this.settings.get('gamepadIndex');
    if (idx < 0) {
      this.setStatus({ index: -1, id: '', axisCount: 0, buttonCount: 0, connected: false });
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    const pad = pads[idx];
    if (!pad) {
      this.setStatus({ index: idx, id: '', axisCount: 0, buttonCount: 0, connected: false });
      return;
    }
    this.setStatus({
      index: idx,
      id: pad.id,
      axisCount: pad.axes.length,
      buttonCount: pad.buttons.length,
      connected: true,
    });
  }

  private setStatus(next: GamepadStatus): void {
    this.status = next;
    for (const fn of this.listeners) fn(next);
  }
}
