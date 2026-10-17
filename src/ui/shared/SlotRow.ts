/**
 * Shared expandable slot-row component.
 *
 * Used by:
 *   - `ModulationSection` (Classic 4-slot matrix)
 *   - `BeginnerView`      (Graph beginner-mode flat row projection)
 *
 * Both backings (Classic `ModSlot` and Graph source-node + binding)
 * implement the same `SlotRowAdapter` interface. The skeleton produces
 * the standard row DOM (collapsed header + expandable body) and the
 * group builders fill the body with source-specific controls + a shared
 * output stage. Neither component knows or cares which backing it has.
 *
 * Master spec §5: "Beginner view ... Same expandable row design as
 * Classic. This view is a constrained projection of the same underlying
 * graph — edits in either reflect in the other." This file is that
 * shared design.
 */

import { OutputCurve } from '../../state/Settings';
import { createRawKnob } from '../widgets';
import { animateToggle } from '../motion';
import { attachTooltip } from '../tooltip';

// ====================================================================
// Adapter interfaces
// ====================================================================

/** Generic getter/setter pair for a number field. */
export interface NumAdapter {
  get(): number;
  set(value: number): void;
  min: number;
  max: number;
  step: number;
  /** Hover tooltip for the row (graph rows: the node param's registry `help`). */
  help?: string;
}

/** Generic getter/setter for a boolean field. */
export interface BoolAdapter {
  get(): boolean;
  set(value: boolean): void;
  help?: string;
}

/** Generic getter/setter for an enum / string field with a fixed option set.
 *
 *  `options` may be either a static array or a thunk; the thunk form lets
 *  Target dropdowns refresh `cv:N` virtual targets when the user adds /
 *  removes a CV-output channel without rebuilding the whole adapter. */
export interface EnumAdapter<T extends string = string> {
  get(): T;
  set(value: T): void;
  help?: string;
  /**
   * Each option may carry an optional `group` label. When ANY option
   * has a group, the rendered `<select>` uses `<optgroup>` elements:
   * options with no group go to a "default" bucket at the top, then
   * each unique group label gets its own `<optgroup>` in first-seen
   * order. When no option has a group, the dropdown renders flat
   * (back-compat with every existing call site).
   */
  options: ReadonlyArray<{ v: T; l: string; group?: string }>
    | (() => ReadonlyArray<{ v: T; l: string; group?: string }>);
}

/** Resolve an EnumAdapter's options to a concrete array. */
export function resolveOptions<T extends string>(
  o: EnumAdapter<T>['options'],
): ReadonlyArray<{ v: T; l: string; group?: string }> {
  return typeof o === 'function' ? o() : o;
}

/**
 * Adapter for a complete row. Each backing implements this and the
 * shared component reads/writes via these methods. `null` getters
 * indicate an absent field — the corresponding control is hidden.
 *
 * The row always shows: source dropdown, expand toggle, amount slider,
 * target dropdown, copy/paste/delete buttons. Whether `enabled` and
 * `midiOut` are shown is controlled by `caps`.
 */
export interface SlotRowAdapter {
  // -------------------- collapsed header --------------------

  /** Master enable toggle. Classic exposes this; Graph rows omit it. */
  enabled?: BoolAdapter;
  source: EnumAdapter;
  /** Target param key, or `'none'` for unbound. */
  target: EnumAdapter;
  amount: NumAdapter;
  /** Per-row expand state (UI-only; persisted by the adapter). */
  expanded: BoolAdapter;

  // -------------------- source-specific (optional) --------------------
  // The "kind" of source determines which group is populated. Adapters
  // return null for inapplicable groups; the shared builder hides them.

  /**
   * Which source kind the underlying source represents, abstracted from
   * Classic ModSource / Graph NodeType. Determines which body groups
   * are visible. `'unsupported'` means "this source has no Beginner-
   * view representation; show the too-complex placeholder for the body".
   */
  sourceKind: SourceKind;

  // LFO group (waveform sources)
  lfo?: {
    frequency: NumAdapter;
    /** v21: Lo/Mid/Hi range switch (×0.01 / ×1 / ×10 on frequency). */
    freqRange?: EnumAdapter;
    phase: NumAdapter;
    duty: NumAdapter;
    depth?: NumAdapter;       // omitted for Graph (graph LFO has bipolar instead)
    bipolar?: BoolAdapter;    // unipolar/bipolar toggle
    syncMode?: EnumAdapter;
    clockDivision?: EnumAdapter;
  };

  // Ramp group
  ramp?: {
    timeSec: NumAdapter;
    mode: EnumAdapter;
    loop?: BoolAdapter;
    /** "Retrigger" button click handler, if applicable. */
    retrigger?: () => void;
  };

  // Audio group (envelope follower / band)
  audio?: {
    bandIndex?: NumAdapter;
    attackMs?: NumAdapter;
    releaseMs?: NumAdapter;
    gain?: NumAdapter;
    floor?: NumAdapter;
  };

  // Joystick shaping
  joystick?: {
    smoothMs?: NumAdapter;
    deadzone?: NumAdapter;
    invert?: BoolAdapter;
  };

  // Constant value
  constant?: { value: NumAdapter };

  // MIDI clock-only sub-section
  midiClock?: { clockDivision: EnumAdapter };

  // v9: CV input (audio-interface CV / OSC bridge)
  cv?: {
    /** Channel index — 0..n-1. */
    channel: NumAdapter;
    /** Live voltage readout (NaN = no signal yet). Polled per frame. */
    readVoltage(): number;
    /** Live normalized value (-1..1) for the bar. */
    readNormalized(): number;
    /** Click handler for "Calibrate" — captures current sample as zero. */
    calibrate(): void;
    /** Long-press / Shift+click handler — clears calibration. */
    resetCalibration(): void;
    /** Per-channel range (visualised, not editable here — edit in I/O panel). */
    rangeLabel(): string;
    /** True if the CV reader is currently running and the channel is active. */
    available(): boolean;
    /** True for Route C (OSC bridge); false for Route A (audio interface). */
    isOsc: boolean;
    /** Variance — used by the row's CV Learn shortcut, if exposed. */
    readVariance?(): number;
    /** Fire CV Learn from the row. Optional — main button lives next to target. */
    learn?(): void;
  };

  // v9: Gamepad / HID
  gamepad?: {
    /** Axis or button index. */
    index: NumAdapter;
    /** Live value (-1..1 for axis, 0..1 for button). */
    readValue(): number;
    /** True if a gamepad is connected and the index is in range. */
    available(): boolean;
    /** True for buttons (display 0..1), false for axes (-1..1). */
    isButton: boolean;
  };

  // -------------------- shared output stage --------------------

  output: {
    curve: EnumAdapter<OutputCurve>;
    min: NumAdapter;
    max: NumAdapter;
    offset: NumAdapter;
    invert: BoolAdapter;
    /**
     * v18: per-slot slew (Classic only). Graph rows omit these — in
     * Graph mode you insert a Slew node instead (coexistence: same math,
     * different patching surface).
     */
    slewRise?: NumAdapter;
    slewFall?: NumAdapter;
    /**
     * v20: apply mode — additive (offset) vs multiplicative (factor).
     * Classic maps to `slot.mode`; Beginner maps to `binding.mode`.
     */
    applyMode?: EnumAdapter;
  };

  // -------------------- MIDI out (optional) --------------------

  midiOut?: {
    enabled: BoolAdapter;
    channel: NumAdapter;
    cc: NumAdapter;
  };

  // -------------------- actions --------------------

  copy(): void;
  paste(): void;
  /** Reset / delete this row. Wording differs (Classic resets, Graph deletes); the adapter decides. */
  reset(): void;
  /**
   * Soft reset (↻ button): set source-specific params back to type-defaults
   * (LFO Rate=1Hz, Shape=sine, Depth=1, etc.), set Amount=0, set Output
   * stage to identity. Source and Target dropdowns DO NOT change.
   * The slot/binding remains enabled.
   */
  softReset(): void;
  /**
   * Hard reset (Shift+↻ button): everything `softReset()` does PLUS source
   * back to default (Sine LFO) and target back to '(none)'. The slot
   * remains in the list — it's a wipe, not a delete.
   */
  hardReset(): void;

  /** Optional dynamic flag: "row is too complex for Beginner view". */
  tooComplex?: boolean;
  tooComplexReason?: string;

  /** Optional MIDI clock receiving state — drives the "NO CLOCK" badge. */
  midiClockState?(): { receiving: boolean; lastHz: number } | null;

  // -------------------- capabilities --------------------

  caps: {
    showEnable: boolean;
    showCopyPaste: boolean;
    showMidiOut: boolean;
    /** Tooltip / aria-label for the X button (e.g. "Reset slot" vs. "Remove patch"). */
    resetLabel: string;
    /** Whether to show the per-row Retrigger button in the Ramp body. */
    showRampRetrigger: boolean;
  };

  /**
   * Snapshot for clipboard. The component relays Copy/Paste through the
   * adapter so each backing can serialize its own data.
   */
  // (clipboard handling lives outside this adapter; see slotClipboard below)
}

/** High-level source kinds — what body group(s) to show. */
export type SourceKind =
  | 'lfo'
  | 'ramp'
  | 'audio'
  | 'audioBand'
  | 'beat'
  | 'midiClock'
  | 'midiOther'
  | 'osc'
  | 'joystick'
  | 'constant'
  | 'cvAudio'
  | 'cvOsc'
  | 'gamepad'
  | 'patternOutput'
  | 'unsupported';

// ====================================================================
// DOM helpers (private)
// ====================================================================

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

interface NumFieldUi {
  root: HTMLElement;
  refresh(): void;
}

/**
 * Build an inline labeled number field with a draggable range slider
 * and a numeric box, both bound to the same adapter. Matches the rest
 * of the panel's `.rw-slider` styling so it looks identical across
 * Classic and Graph.
 */
export function buildNumField(label: string, a: NumAdapter): NumFieldUi {
  const wrap = el('div', 'rw-slider rw-slider--num');   // knob + a visible numeric field
  const range = el('input') as HTMLInputElement;
  range.type = 'range';
  range.min = String(a.min); range.max = String(a.max); range.step = String(a.step);
  range.value = String(a.get());
  const num = el('input', 'rw-num') as HTMLInputElement;
  num.type = 'number';
  num.min = String(a.min); num.max = String(a.max); num.step = String(a.step);
  num.value = String(a.get());
  wrap.append(range, num);
  range.addEventListener('input', () => {
    const v = +range.value;
    a.set(v);
    if (num.value !== range.value) num.value = range.value;
    knob.refresh();
  });
  num.addEventListener('input', () => {
    const v = parseFloat(num.value);
    if (!Number.isNaN(v)) {
      a.set(v);
      if (range.value !== num.value) range.value = num.value;
      knob.refresh();
    }
  });
  // Hardware/rack-skin face: skin.css hides `input[type="range"]`/
  // `.rw-num` under `.rw-slider` unconditionally, expecting a `.rw-knob`
  // to be present instead — without this, the field rendered completely
  // empty under those two skins (owner screenshot: AMT/Band/Gain all
  // blank). See createRawKnob's doc comment for the full story.
  const knob = createRawKnob({
    get: a.get, set: a.set, min: a.min, max: a.max, step: a.step, ariaLabel: label,
  });
  wrap.appendChild(knob.el);

  const root = el('div', 'rw-row');
  const lbl = el('label', 'rw-label', label);
  wrap.classList.add('rw-control');
  root.append(lbl, wrap);
  if (a.help) attachTooltip(root, a.help);

  return {
    root,
    refresh(): void {
      const v = String(a.get());
      if (range.value !== v) range.value = v;
      if (num.value !== v) num.value = v;
      knob.refresh();
    },
  };
}

interface ToggleUi { root: HTMLElement; refresh(): void; }

/** Build a labeled toggle row bound to a `BoolAdapter`. */
export function buildToggleRow(label: string, a: BoolAdapter, txt = ''): ToggleUi {
  const wrapLbl = el('label', 'rw-toggle');
  const cb = el('input') as HTMLInputElement; cb.type = 'checkbox';
  const sw = el('span', 'rw-toggle-sw');
  const tx = el('span', 'rw-toggle-txt', txt);
  wrapLbl.append(cb, sw, tx);
  cb.addEventListener('change', () => a.set(cb.checked));
  const root = el('div', 'rw-row');
  const lbl = el('label', 'rw-label', label);
  wrapLbl.classList.add('rw-control');
  root.append(lbl, wrapLbl);
  if (a.help) attachTooltip(root, a.help);
  return {
    root,
    refresh(): void { if (cb.checked !== a.get()) cb.checked = a.get(); },
  };
}

interface DropdownUi { root: HTMLElement; refresh(): void; }

/** Build a labeled dropdown bound to an EnumAdapter. */
export function buildDropdownRow<T extends string>(label: string, a: EnumAdapter<T>): DropdownUi {
  const sel = el('select', 'rw-select rw-control') as HTMLSelectElement;
  for (const o of resolveOptions(a.options)) {
    const opt = el('option') as HTMLOptionElement;
    opt.value = o.v; opt.textContent = o.l;
    sel.appendChild(opt);
  }
  sel.value = a.get();
  sel.addEventListener('change', () => a.set(sel.value as T));
  const root = el('div', 'rw-row');
  const lbl = el('label', 'rw-label', label);
  root.append(lbl, sel);
  if (a.help) attachTooltip(root, a.help);
  return {
    root,
    refresh(): void { if (sel.value !== a.get()) sel.value = a.get(); },
  };
}

/** A collapsible sub-group inside a slot card (LFO, Output, Audio…): the same caret, click,
 *  keyboard and spring as the panel's groups (widgets.group). Starts open — the card was just
 *  expanded to show these controls. */
function buildGroup(title: string): { root: HTMLElement; body: HTMLElement } {
  const root = el('div', 'rw-group');
  const head = el('div', 'rw-group-head', title);
  head.setAttribute('role', 'button');
  head.tabIndex = 0;
  head.setAttribute('aria-expanded', 'true');
  const body = el('div', 'rw-group-body');
  const toggle = (): void => {
    const closing = !root.classList.contains('rw-group--collapsed');
    head.setAttribute('aria-expanded', String(!closing));
    animateToggle(root,
      () => root.classList.toggle('rw-group--collapsed', closing),
      () => root.classList.toggle('rw-group--collapsed', !closing),
      { caret: '--caret', fromDeg: closing ? 0 : -90, toDeg: closing ? -90 : 0 });
  };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  root.append(head, body);
  return { root, body };
}

function buildIconBtn(title: string, txt: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'rw-btn rw-mod-slot-iconbtn') as HTMLButtonElement;
  b.type = 'button';
  b.title = title;
  b.textContent = txt;
  b.addEventListener('click', onClick);
  return b;
}

// ====================================================================
// Built-in option lists
// ====================================================================

export const OUTPUT_CURVE_OPTS: ReadonlyArray<{ v: OutputCurve; l: string }> = [
  { v: 'linear', l: 'Linear' },
  { v: 'exp',    l: 'Exp' },
  { v: 'log',    l: 'Log' },
  { v: 's',      l: 'S-curve' },
  { v: 'step',   l: 'Step' },
];

// ====================================================================
// Body group builders
// ====================================================================

interface BodyGroup {
  root: HTMLElement;
  refresh(): void;
  /** Optional teardown when the group's row is rebuilt. */
  dispose?(): void;
}

function buildLfoGroup(lfo: NonNullable<SlotRowAdapter['lfo']>): BodyGroup {
  const g = buildGroup('LFO');
  const refreshers: Array<() => void> = [];

  if (lfo.syncMode) {
    const r = buildDropdownRow('Sync', lfo.syncMode);
    refreshers.push(r.refresh);
    g.body.appendChild(r.root);
  }
  // Frequency only matters in 'free' sync; division only in 'midi'/'tempo'.
  // We always build both and toggle visibility at refresh time.
  const freqUi = buildNumField('Rate (Hz)', lfo.frequency);
  refreshers.push(freqUi.refresh);
  g.body.appendChild(freqUi.root);
  if (lfo.freqRange) {
    const rangeUi = buildDropdownRow('Range', lfo.freqRange);
    refreshers.push(rangeUi.refresh);
    g.body.appendChild(rangeUi.root);
  }
  let divUi: DropdownUi | null = null;
  if (lfo.clockDivision) {
    divUi = buildDropdownRow('Division', lfo.clockDivision);
    refreshers.push(divUi.refresh);
    g.body.appendChild(divUi.root);
  }
  const phaseUi = buildNumField('Phase', lfo.phase);
  refreshers.push(phaseUi.refresh);
  g.body.appendChild(phaseUi.root);
  const dutyUi = buildNumField('Duty', lfo.duty);
  refreshers.push(dutyUi.refresh);
  g.body.appendChild(dutyUi.root);
  if (lfo.depth) {
    const depthUi = buildNumField('Depth', lfo.depth);
    refreshers.push(depthUi.refresh);
    g.body.appendChild(depthUi.root);
  }
  if (lfo.bipolar) {
    // Convention: stored as "bipolar" but UI shows polarity choice. Map
    // bipolar=true -> bipolar (-1..+1), bipolar=false -> unipolar (0..1).
    const polarityRow = buildToggleRow('Polarity', {
      get: () => !lfo.bipolar!.get(),
      set: (v: boolean) => lfo.bipolar!.set(!v),
    }, 'unipolar (0..1)');
    refreshers.push(polarityRow.refresh);
    g.body.appendChild(polarityRow.root);
  }

  return {
    root: g.root,
    refresh(): void {
      // Visibility tweaks based on sync mode.
      if (lfo.syncMode) {
        const mode = lfo.syncMode.get();
        freqUi.root.style.display = mode === 'free' ? '' : 'none';
        if (divUi) divUi.root.style.display = mode === 'free' ? 'none' : '';
      }
      for (const r of refreshers) r();
    },
  };
}

function buildRampGroup(ramp: NonNullable<SlotRowAdapter['ramp']>, showRetrigger: boolean): BodyGroup {
  const g = buildGroup('Ramp');
  const refreshers: Array<() => void> = [];
  const timeUi = buildNumField('Time (sec)', ramp.timeSec);
  refreshers.push(timeUi.refresh);
  g.body.appendChild(timeUi.root);
  const modeUi = buildDropdownRow('Mode', ramp.mode);
  refreshers.push(modeUi.refresh);
  g.body.appendChild(modeUi.root);
  if (ramp.loop) {
    const loopUi = buildToggleRow('Loop', ramp.loop, 'loop (off = one-shot)');
    refreshers.push(loopUi.refresh);
    g.body.appendChild(loopUi.root);
  }
  if (showRetrigger && ramp.retrigger) {
    const b = el('button', 'rw-btn rw-mod-retrigger', 'Retrigger') as HTMLButtonElement;
    b.type = 'button';
    b.addEventListener('click', () => ramp.retrigger!());
    g.body.appendChild(b);
  }
  return { root: g.root, refresh(): void { for (const r of refreshers) r(); } };
}

function buildAudioGroup(audio: NonNullable<SlotRowAdapter['audio']>, sourceKind: SourceKind): BodyGroup {
  const g = buildGroup('Audio');
  const refreshers: Array<() => void> = [];
  let bandUi: NumFieldUi | null = null;
  if (audio.bandIndex) {
    bandUi = buildNumField('Band', audio.bandIndex);
    refreshers.push(bandUi.refresh);
    g.body.appendChild(bandUi.root);
  }
  if (audio.attackMs)  { const u = buildNumField('Attack (ms)', audio.attackMs);  refreshers.push(u.refresh); g.body.appendChild(u.root); }
  if (audio.releaseMs) { const u = buildNumField('Release (ms)', audio.releaseMs); refreshers.push(u.refresh); g.body.appendChild(u.root); }
  if (audio.gain)      { const u = buildNumField('Gain', audio.gain);             refreshers.push(u.refresh); g.body.appendChild(u.root); }
  if (audio.floor)     { const u = buildNumField('Floor', audio.floor);           refreshers.push(u.refresh); g.body.appendChild(u.root); }
  return {
    root: g.root,
    refresh(): void {
      // Band only visible for audioBand source kind.
      if (bandUi) bandUi.root.style.display = sourceKind === 'audioBand' ? '' : 'none';
      for (const r of refreshers) r();
    },
  };
}

function buildJoystickGroup(js: NonNullable<SlotRowAdapter['joystick']>): BodyGroup {
  const g = buildGroup('Joystick shaping');
  const refreshers: Array<() => void> = [];
  if (js.smoothMs) { const u = buildNumField('Smooth (ms)', js.smoothMs); refreshers.push(u.refresh); g.body.appendChild(u.root); }
  if (js.deadzone) { const u = buildNumField('Deadzone', js.deadzone); refreshers.push(u.refresh); g.body.appendChild(u.root); }
  if (js.invert)   { const u = buildToggleRow('Invert', js.invert, 'invert axis'); refreshers.push(u.refresh); g.body.appendChild(u.root); }
  return { root: g.root, refresh(): void { for (const r of refreshers) r(); } };
}

function buildConstantGroup(c: NonNullable<SlotRowAdapter['constant']>): BodyGroup {
  const g = buildGroup('Constant');
  const u = buildNumField('Value', c.value);
  g.body.appendChild(u.root);
  return { root: g.root, refresh: u.refresh };
}

function buildMidiClockGroup(mc: NonNullable<SlotRowAdapter['midiClock']>): BodyGroup {
  const g = buildGroup('MIDI Clock');
  const u = buildDropdownRow('Division', mc.clockDivision);
  g.body.appendChild(u.root);
  return { root: g.root, refresh: u.refresh };
}

/**
 * Drive a per-frame poll for the live-readout body groups. Returns a
 * disposer that stops the poll when the row is rebuilt.
 */
function startPollLoop(refresh: () => void): () => void {
  let alive = true;
  const tick = (): void => {
    if (!alive) return;
    try { refresh(); } catch { /* no-op — keep loop running */ }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => { alive = false; };
}

function buildCvGroup(cv: NonNullable<SlotRowAdapter['cv']>): BodyGroup {
  const g = buildGroup(cv.isOsc ? 'CV (OSC)' : 'CV (audio)');
  const refreshers: Array<() => void> = [];

  const chUi = buildNumField('Channel', cv.channel);
  refreshers.push(chUi.refresh);
  g.body.appendChild(chUi.root);

  // Live readout: voltage label + a small horizontal bar showing position
  // within the configured range. The bar is the difference between
  // "channel is wired" and "channel is silent at 0V" — without it users
  // burn time wondering if a patch even sees their CV.
  const liveRow = el('div', 'rw-mod-row rw-mod-cv-live');
  const liveLabel = el('span', 'rw-mod-row-label');
  liveLabel.textContent = 'Live';
  const liveBarWrap = el('div', 'rw-mod-cv-bar-wrap');
  const liveBar = el('div', 'rw-mod-cv-bar');
  liveBarWrap.appendChild(liveBar);
  const liveText = el('span', 'rw-mod-cv-text');
  liveText.textContent = '—V';
  liveRow.append(liveLabel, liveBarWrap, liveText);
  g.body.appendChild(liveRow);

  // Calibrate / range row.
  const ctlRow = el('div', 'rw-mod-row rw-mod-cv-ctl');
  const rangeBadge = el('span', 'rw-mod-cv-range');
  rangeBadge.textContent = cv.rangeLabel();
  const calBtn = el('button', 'rw-btn rw-mod-cv-calibrate', 'Calibrate') as HTMLButtonElement;
  calBtn.type = 'button';
  calBtn.title = 'Capture current voltage as zero. Shift+click to clear calibration.';
  calBtn.addEventListener('click', (e) => {
    if ((e as MouseEvent).shiftKey) cv.resetCalibration();
    else cv.calibrate();
  });
  ctlRow.append(rangeBadge, calBtn);
  if (cv.learn) {
    const learnBtn = el('button', 'rw-btn rw-mod-cv-learn', 'Learn') as HTMLButtonElement;
    learnBtn.type = 'button';
    learnBtn.title = 'Click, then wiggle the CV — that channel binds to this slot.';
    learnBtn.addEventListener('click', () => cv.learn?.());
    ctlRow.appendChild(learnBtn);
  }
  g.body.appendChild(ctlRow);

  const refresh = (): void => {
    for (const r of refreshers) r();
    rangeBadge.textContent = cv.rangeLabel();
    const v = cv.readVoltage();
    const n = cv.readNormalized();
    if (!cv.available()) {
      liveText.textContent = '—V';
      liveBar.style.width = '0%';
      liveBar.classList.remove('positive', 'negative');
      return;
    }
    if (Number.isNaN(v)) {
      liveText.textContent = '—V';
    } else {
      liveText.textContent = `${v >= 0 ? '+' : ''}${v.toFixed(2)}V`;
    }
    const pct = Math.min(100, Math.abs(n) * 50);
    liveBar.style.width = `${pct}%`;
    liveBar.classList.toggle('positive', n >= 0);
    liveBar.classList.toggle('negative', n < 0);
    liveBar.style.marginLeft = n >= 0 ? '50%' : `${50 - pct}%`;
  };
  const dispose = startPollLoop(refresh);
  return { root: g.root, refresh, dispose };
}

function buildGamepadGroup(g: NonNullable<SlotRowAdapter['gamepad']>): BodyGroup {
  const grp = buildGroup(g.isButton ? 'Gamepad button' : 'Gamepad axis');
  const refreshers: Array<() => void> = [];
  const idxUi = buildNumField(g.isButton ? 'Button' : 'Axis', g.index);
  refreshers.push(idxUi.refresh);
  grp.body.appendChild(idxUi.root);

  const liveRow = el('div', 'rw-mod-row rw-mod-cv-live');
  const liveLabel = el('span', 'rw-mod-row-label');
  liveLabel.textContent = 'Live';
  const liveBarWrap = el('div', 'rw-mod-cv-bar-wrap');
  const liveBar = el('div', 'rw-mod-cv-bar');
  liveBarWrap.appendChild(liveBar);
  const liveText = el('span', 'rw-mod-cv-text');
  liveText.textContent = '—';
  liveRow.append(liveLabel, liveBarWrap, liveText);
  grp.body.appendChild(liveRow);

  const refresh = (): void => {
    for (const r of refreshers) r();
    if (!g.available()) {
      liveText.textContent = '—';
      liveBar.style.width = '0%';
      return;
    }
    const v = g.readValue();
    liveText.textContent = v.toFixed(2);
    if (g.isButton) {
      liveBar.style.width = `${Math.min(100, v * 100)}%`;
      liveBar.style.marginLeft = '0';
      liveBar.classList.add('positive');
      liveBar.classList.remove('negative');
    } else {
      const pct = Math.min(100, Math.abs(v) * 50);
      liveBar.style.width = `${pct}%`;
      liveBar.classList.toggle('positive', v >= 0);
      liveBar.classList.toggle('negative', v < 0);
      liveBar.style.marginLeft = v >= 0 ? '50%' : `${50 - pct}%`;
    }
  };
  const dispose = startPollLoop(refresh);
  return { root: grp.root, refresh, dispose };
}

/** What each Output-stage control does — the same in Classic slots and Graph rows. */
const OUTPUT_HELP = {
  apply:  'Additive moves the target up and down around its knob; Multiply scales the knob’s value instead.',
  curve:  'Shape of the response: Linear as-is, Exp eases in, Log eases out, S-curve both, Step snaps to three levels.',
  min:    'Output when the source is at its lowest (−1). Raise it to keep the modulation off the bottom.',
  max:    'Output when the source is at its highest (+1). Lower it to keep the modulation off the top.',
  offset: 'Added to the output after the range — shifts the whole swing up or down.',
  invert: 'Flips the signal: high becomes low.',
  rise:   'Milliseconds to glide when the signal rises — smooths sudden jumps upward.',
  fall:   'Milliseconds to glide when the signal falls — smooths sudden drops.',
};

function buildOutputStageGroup(o: SlotRowAdapter['output']): BodyGroup {
  const g = buildGroup('Output');
  const refreshers: Array<() => void> = [];
  const h = <T extends { help?: string }>(a: T, help: string): T => ({ ...a, help: a.help ?? help });
  if (o.applyMode) {
    const modeUi = buildDropdownRow('Apply', h(o.applyMode, OUTPUT_HELP.apply));
    refreshers.push(modeUi.refresh); g.body.appendChild(modeUi.root);
  }
  const curveUi = buildDropdownRow<OutputCurve>('Curve', h(o.curve, OUTPUT_HELP.curve));
  refreshers.push(curveUi.refresh); g.body.appendChild(curveUi.root);
  const minUi = buildNumField('Min', h(o.min, OUTPUT_HELP.min)); refreshers.push(minUi.refresh); g.body.appendChild(minUi.root);
  const maxUi = buildNumField('Max', h(o.max, OUTPUT_HELP.max)); refreshers.push(maxUi.refresh); g.body.appendChild(maxUi.root);
  const offUi = buildNumField('Offset', h(o.offset, OUTPUT_HELP.offset)); refreshers.push(offUi.refresh); g.body.appendChild(offUi.root);
  const invUi = buildToggleRow('Invert', h(o.invert, OUTPUT_HELP.invert), 'invert output'); refreshers.push(invUi.refresh); g.body.appendChild(invUi.root);
  if (o.slewRise) {
    const riseUi = buildNumField('Slew ↑ ms', h(o.slewRise, OUTPUT_HELP.rise));
    refreshers.push(riseUi.refresh); g.body.appendChild(riseUi.root);
  }
  if (o.slewFall) {
    const fallUi = buildNumField('Slew ↓ ms', h(o.slewFall, OUTPUT_HELP.fall));
    refreshers.push(fallUi.refresh); g.body.appendChild(fallUi.root);
  }
  return { root: g.root, refresh(): void { for (const r of refreshers) r(); } };
}

function buildMidiOutGroup(m: NonNullable<SlotRowAdapter['midiOut']>): BodyGroup {
  const g = buildGroup('MIDI Out');
  const refreshers: Array<() => void> = [];
  const enUi = buildToggleRow('Enable', m.enabled, 'send CC');
  refreshers.push(enUi.refresh); g.body.appendChild(enUi.root);
  const chUi = buildNumField('Channel', m.channel); refreshers.push(chUi.refresh); g.body.appendChild(chUi.root);
  const ccUi = buildNumField('CC', m.cc); refreshers.push(ccUi.refresh); g.body.appendChild(ccUi.root);
  return { root: g.root, refresh(): void { for (const r of refreshers) r(); } };
}

// ====================================================================
// Top-level skeleton
// ====================================================================

export interface SlotRowUi {
  root: HTMLElement;
  refresh(): void;
  /** Re-read `adapter.target.options` and rebuild the dropdown's
   *  `<option>` elements. Used when the host wants to add / remove
   *  target options without a full row remount (e.g. CV-output channels
   *  added in the I/O panel appear as `cv:N` Target entries). */
  rebuildTargetOptions(): void;
}

/**
 * Build the complete slot row (collapsed header + expandable body) for
 * the given adapter. The returned `refresh()` re-syncs every control
 * from the adapter (called by the host whenever the underlying data
 * changes).
 */
export function createSlotRow(adapter: SlotRowAdapter): SlotRowUi {
  const card = el('div', 'rw-mod-slot');

  // -------------------- collapsed header --------------------
  const header = el('div', 'rw-mod-slot-row');
  // Line 1: [enable] source ............ [expand]
  // Line 2: [AMT knob + value] target ..............
  // (then the Copy/Paste · Reset/Remove footer, then the NO CLOCK badge)
  const line1 = el('div', 'rw-mod-slot-line rw-mod-slot-line--src');
  const line2 = el('div', 'rw-mod-slot-line rw-mod-slot-line--amt');
  header.append(line1, line2);

  // Enable toggle (Classic only)
  let enInput: HTMLInputElement | null = null;
  if (adapter.caps.showEnable && adapter.enabled) {
    const enLabel = el('label', 'rw-toggle rw-mod-slot-en');
    enLabel.title = 'Enable / disable this slot';
    enInput = el('input') as HTMLInputElement;
    enInput.type = 'checkbox';
    enInput.addEventListener('change', () => adapter.enabled!.set(enInput!.checked));
    const sw = el('span', 'rw-toggle-sw');
    enLabel.append(enInput, sw);
    line1.appendChild(enLabel);
  }

  // Source dropdown — supports optional `group` per option to render
  // `<optgroup>` sections (e.g. Pattern Outputs as a group alongside
  // the flat top-level sources).
  const srcSel = el('select', 'rw-select rw-mod-slot-src') as HTMLSelectElement;
  const opts = resolveOptions(adapter.source.options);
  const hasAnyGroup = opts.some((o) => !!o.group);
  if (!hasAnyGroup) {
    for (const opt of opts) {
      const o = el('option') as HTMLOptionElement;
      o.value = opt.v; o.textContent = opt.l;
      srcSel.appendChild(o);
    }
  } else {
    // Bucket by group; ungrouped options first, then each group
    // section in first-seen order.
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const opt of opts) {
      const o = el('option') as HTMLOptionElement;
      o.value = opt.v; o.textContent = opt.l;
      if (!opt.group) {
        srcSel.appendChild(o);
        continue;
      }
      let g = groups.get(opt.group);
      if (!g) {
        g = document.createElement('optgroup');
        g.label = opt.group;
        srcSel.appendChild(g);
        groups.set(opt.group, g);
      }
      g.appendChild(o);
    }
  }
  srcSel.addEventListener('change', () => adapter.source.set(srcSel.value));
  line1.appendChild(srcSel);

  // Expand toggle
  const expandBtn = el('button', 'rw-btn rw-mod-slot-expand') as HTMLButtonElement;
  expandBtn.type = 'button';
  expandBtn.textContent = '';    // a thin CSS chevron (panel.css) — a ▶ glyph reads as "play"
  expandBtn.title = 'Show / hide source-specific controls';
  expandBtn.setAttribute('aria-label', 'Show or hide the slot controls');
  expandBtn.setAttribute('aria-expanded', 'false');
  // Springs open/closed (motion.ts, the same feel as sections and groups). The new state is
  // committed when the spring settles: the Beginner view re-renders its rows on commit,
  // which would cut a running animation short.
  let expandAnimating = false;
  expandBtn.addEventListener('click', () => {
    if (expandAnimating) return;
    const next = !adapter.expanded.get();
    expandAnimating = true;
    animateToggle(card, () => applyOpen(next), () => applyOpen(!next), {
      onDone: () => { expandAnimating = false; adapter.expanded.set(next); },
    });
  });

  // Amount slider
  const amtWrap = el('div', 'rw-slider rw-mod-slot-amount');
  const amtRange = el('input') as HTMLInputElement;
  amtRange.type = 'range';
  amtRange.min = String(adapter.amount.min);
  amtRange.max = String(adapter.amount.max);
  amtRange.step = String(adapter.amount.step);
  const amtNum = el('input', 'rw-num') as HTMLInputElement;
  amtNum.type = 'number';
  amtNum.min = String(adapter.amount.min);
  amtNum.max = String(adapter.amount.max);
  amtNum.step = String(adapter.amount.step);
  const amtLabel = el('label', 'rw-mod-slot-amount-cap', 'AMT');
  amtLabel.title = 'Amount — how strongly this source moves the target';
  const amtField = el('div', 'rw-mod-slot-amount-field');
  amtField.append(amtLabel, amtNum);
  amtWrap.append(amtRange, amtField);
  amtRange.addEventListener('input', () => {
    const v = +amtRange.value;
    adapter.amount.set(v);
    if (amtNum.value !== amtRange.value) amtNum.value = amtRange.value;
    amtKnob.refresh();
  });
  amtNum.addEventListener('input', () => {
    const v = parseFloat(amtNum.value);
    if (!Number.isNaN(v)) {
      adapter.amount.set(v);
      if (amtRange.value !== amtNum.value) amtRange.value = amtNum.value;
      amtKnob.refresh();
    }
  });
  // Hardware/rack-skin face — see createRawKnob's doc comment
  // (widgets.ts): without this, skin.css's `.rw-slider input[type=
  // "range"], .rw-slider .rw-num { display: none }` rule left the whole
  // AMT row blank under those two skins (owner screenshot).
  const amtKnob = createRawKnob({
    get: adapter.amount.get, set: adapter.amount.set,
    min: adapter.amount.min, max: adapter.amount.max, step: adapter.amount.step,
    ariaLabel: 'Amount',
  });
  amtWrap.appendChild(amtKnob.el);
  line2.appendChild(amtWrap);

  // Target dropdown
  const tgtSel = el('select', 'rw-select rw-mod-slot-tgt') as HTMLSelectElement;
  /** Rebuild the dropdown options from `adapter.target.options`. Called
   *  initially and whenever the option list changes (e.g. user adds /
   *  removes a CV-output channel, which appends `cv:N` entries). */
  function rebuildTargetOptions(): void {
    const cur = tgtSel.value;
    const opts = resolveOptions(adapter.target.options);
    tgtSel.replaceChildren();
    for (const opt of opts) {
      const o = el('option') as HTMLOptionElement;
      o.value = opt.v; o.textContent = opt.l;
      tgtSel.appendChild(o);
    }
    // Restore selection if still valid; the model will re-fix it on next refresh
    // if it's not.
    const stillValid = opts.some((o) => o.v === cur);
    if (stillValid) tgtSel.value = cur;
  }
  rebuildTargetOptions();
  tgtSel.addEventListener('change', () => adapter.target.set(tgtSel.value));
  line2.appendChild(tgtSel);

  // Footer tools: Copy / Paste on the left (clipboard actions), Reset and
  // Remove on the right (they change the slot) — grouped by meaning, so a
  // destructive button is never next to a harmless one.
  const tools = el('div', 'rw-mod-slot-tools');
  const toolsL = el('div', 'rw-mod-slot-tools-group');
  const toolsR = el('div', 'rw-mod-slot-tools-group rw-mod-slot-tools-group--end');
  let copyBtn: HTMLButtonElement | null = null;
  let pasteBtn: HTMLButtonElement | null = null;
  if (adapter.caps.showCopyPaste) {
    copyBtn = buildIconBtn('Copy this patch (source, amount and target)', 'Copy', () => adapter.copy());
    pasteBtn = buildIconBtn('Paste a copied patch here', 'Paste', () => adapter.paste());
    toolsL.append(copyBtn, pasteBtn);
  }
  // Soft reset. Shift+click promotes to hard reset which also wipes
  // source + target. The button doesn't delete the row — that's the
  // job of the ✕ button below. Keyboard: R / Shift+R when the row is
  // focused dispatch the same actions.
  const softResetBtn = buildIconBtn(
    'Reset the patch settings (Shift-click: full reset including source and target)',
    'Reset',
    () => adapter.softReset(),
  );
  softResetBtn.addEventListener('click', (ev) => {
    // The base handler already ran — but we re-route on shift to call
    // hardReset(). Use stopImmediatePropagation to swallow the default.
    if (ev.shiftKey) { ev.stopImmediatePropagation(); ev.preventDefault(); adapter.hardReset(); }
  }, true);
  const delBtn = buildIconBtn(adapter.caps.resetLabel, '✕', () => adapter.reset());
  delBtn.classList.add('rw-mod-slot-del', 'rw-x');
  delBtn.setAttribute('aria-label', adapter.caps.resetLabel);
  // ✕ (remove) sits top right, on the source line; the expand caret sits bottom right,
  // next to the controls it opens.
  line1.appendChild(delBtn);
  toolsR.append(softResetBtn, expandBtn);
  tools.append(toolsL, toolsR);
  header.appendChild(tools);

  // Make the row focusable so R / Shift+R can trigger reset without a
  // mouse click, per the spec. Tab order matches column order.
  card.tabIndex = 0;
  card.addEventListener('keydown', (ev) => {
    // Don't intercept while a child input has focus — typing 'R' in a
    // number field shouldn't reset the patch.
    const target = ev.target as HTMLElement | null;
    if (target && target !== card && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    if (ev.key !== 'r' && ev.key !== 'R') return;
    ev.preventDefault();
    if (ev.shiftKey) adapter.hardReset();
    else adapter.softReset();
  });

  // No-clock badge — only relevant when source kind ties to MIDI clock.
  const noClock = el('span', 'rw-mod-noclock-badge', 'NO CLOCK');
  noClock.title = 'This slot is set to MIDI Clock sync, but no clock pulses are being received.';
  header.appendChild(noClock);

  card.appendChild(header);

  // -------------------- expanded body --------------------
  const body = el('div', 'rw-mod-slot-body');
  card.appendChild(body);

  // Lazy-built once we know the source kind. Rebuilt in-place on
  // `sourceKind` change since group sets differ per source.
  let bodyGroups: BodyGroup[] = [];
  let lastSourceKind: SourceKind | null = null;

  function rebuildBody(): void {
    for (const g of bodyGroups) g.dispose?.();
    body.innerHTML = '';
    bodyGroups = [];

    if (adapter.tooComplex) {
      const note = el('div', 'rw-mod-graph-empty');
      note.textContent = adapter.tooComplexReason
        ?? 'This row is too complex for Beginner view — open Advanced view to edit.';
      body.appendChild(note);
      return;
    }

    const kind = adapter.sourceKind;

    if (kind === 'lfo' && adapter.lfo) {
      bodyGroups.push(buildLfoGroup(adapter.lfo));
    }
    if (kind === 'ramp' && adapter.ramp) {
      bodyGroups.push(buildRampGroup(adapter.ramp, adapter.caps.showRampRetrigger));
    }
    if ((kind === 'audio' || kind === 'audioBand' || kind === 'beat') && adapter.audio) {
      bodyGroups.push(buildAudioGroup(adapter.audio, kind));
    }
    if (kind === 'joystick' && adapter.joystick) {
      bodyGroups.push(buildJoystickGroup(adapter.joystick));
    }
    if (kind === 'constant' && adapter.constant) {
      bodyGroups.push(buildConstantGroup(adapter.constant));
    }
    if (kind === 'midiClock' && adapter.midiClock) {
      bodyGroups.push(buildMidiClockGroup(adapter.midiClock));
    }
    if ((kind === 'cvAudio' || kind === 'cvOsc') && adapter.cv) {
      bodyGroups.push(buildCvGroup(adapter.cv));
    }
    if (kind === 'gamepad' && adapter.gamepad) {
      bodyGroups.push(buildGamepadGroup(adapter.gamepad));
    }
    if (kind === 'unsupported') {
      const note = el('div', 'rw-mod-graph-empty');
      note.textContent = 'This source has no Beginner-view controls — open Advanced view.';
      body.appendChild(note);
    }

    // Output stage is always present for every supported kind.
    if (kind !== 'unsupported') {
      bodyGroups.push(buildOutputStageGroup(adapter.output));
    }
    if (adapter.caps.showMidiOut && adapter.midiOut) {
      bodyGroups.push(buildMidiOutGroup(adapter.midiOut));
    }
    for (const g of bodyGroups) body.appendChild(g.root);
  }

  // -------------------- refresh / render --------------------

  function applyOpen(open: boolean): void {
    body.style.display = open ? '' : 'none';
    expandBtn.setAttribute('aria-expanded', String(open));
    card.classList.toggle('expanded', open);
  }

  function refresh(): void {
    if (enInput && adapter.enabled) {
      const v = adapter.enabled.get();
      if (enInput.checked !== v) enInput.checked = v;
    }
    if (srcSel.value !== adapter.source.get()) srcSel.value = adapter.source.get();
    if (tgtSel.value !== adapter.target.get()) tgtSel.value = adapter.target.get();
    const av = String(adapter.amount.get());
    if (amtRange.value !== av) amtRange.value = av;
    if (amtNum.value !== av) amtNum.value = av;
    amtKnob.refresh();
    if (pasteBtn) pasteBtn.disabled = !canPaste();

    // Sync expand state (left alone while the expand spring is running).
    if (!expandAnimating) applyOpen(adapter.expanded.get());

    // Source-kind change forces a body rebuild.
    if (adapter.sourceKind !== lastSourceKind) {
      lastSourceKind = adapter.sourceKind;
      rebuildBody();
    }
    for (const g of bodyGroups) g.refresh();

    // No-clock badge.
    const cs = adapter.midiClockState?.();
    const showBadge = !!cs && cs.receiving === false && cs.lastHz === 0;
    noClock.style.display = showBadge ? '' : 'none';
  }

  rebuildBody();
  refresh();

  return { root: card, refresh, rebuildTargetOptions };
}

// ====================================================================
// Clipboard
// ====================================================================

/**
 * Module-level clipboard for `Copy / Paste` row buttons. Each backing
 * stores its own snapshot type — Classic puts a `ModSlot`, Graph puts
 * a synthesized `{ source, target, amount, output, ... }` shape and
 * decides at paste time whether the clipboard fits its model.
 */
let _slotClipboard: unknown = null;

export function getSlotClipboard(): unknown { return _slotClipboard; }
export function setSlotClipboard(snapshot: unknown): void { _slotClipboard = snapshot; }
export function canPaste(): boolean { return _slotClipboard != null; }
