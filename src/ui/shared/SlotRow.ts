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
}

/** Generic getter/setter for a boolean field. */
export interface BoolAdapter {
  get(): boolean;
  set(value: boolean): void;
}

/** Generic getter/setter for an enum / string field with a fixed option set. */
export interface EnumAdapter<T extends string = string> {
  get(): T;
  set(value: T): void;
  options: ReadonlyArray<{ v: T; l: string }>;
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

  // -------------------- shared output stage --------------------

  output: {
    curve: EnumAdapter<OutputCurve>;
    min: NumAdapter;
    max: NumAdapter;
    offset: NumAdapter;
    invert: BoolAdapter;
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
  const wrap = el('div', 'rw-slider');
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
  });
  num.addEventListener('input', () => {
    const v = parseFloat(num.value);
    if (!Number.isNaN(v)) {
      a.set(v);
      if (range.value !== num.value) range.value = num.value;
    }
  });

  const root = el('div', 'rw-row');
  const lbl = el('label', 'rw-label', label);
  wrap.classList.add('rw-control');
  root.append(lbl, wrap);

  return {
    root,
    refresh(): void {
      const v = String(a.get());
      if (range.value !== v) range.value = v;
      if (num.value !== v) num.value = v;
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
  return {
    root,
    refresh(): void { if (cb.checked !== a.get()) cb.checked = a.get(); },
  };
}

interface DropdownUi { root: HTMLElement; refresh(): void; }

/** Build a labeled dropdown bound to an EnumAdapter. */
export function buildDropdownRow<T extends string>(label: string, a: EnumAdapter<T>): DropdownUi {
  const sel = el('select', 'rw-select rw-control') as HTMLSelectElement;
  for (const o of a.options) {
    const opt = el('option') as HTMLOptionElement;
    opt.value = o.v; opt.textContent = o.l;
    sel.appendChild(opt);
  }
  sel.value = a.get();
  sel.addEventListener('change', () => a.set(sel.value as T));
  const root = el('div', 'rw-row');
  const lbl = el('label', 'rw-label', label);
  root.append(lbl, sel);
  return {
    root,
    refresh(): void { if (sel.value !== a.get()) sel.value = a.get(); },
  };
}

function buildGroup(title: string): { root: HTMLElement; body: HTMLElement } {
  const root = el('div', 'rw-group');
  const head = el('div', 'rw-group-head', title);
  const body = el('div', 'rw-group-body');
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

interface BodyGroup { root: HTMLElement; refresh(): void; }

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

function buildOutputStageGroup(o: SlotRowAdapter['output']): BodyGroup {
  const g = buildGroup('Output');
  const refreshers: Array<() => void> = [];
  const curveUi = buildDropdownRow<OutputCurve>('Curve', o.curve);
  refreshers.push(curveUi.refresh); g.body.appendChild(curveUi.root);
  const minUi = buildNumField('Min', o.min); refreshers.push(minUi.refresh); g.body.appendChild(minUi.root);
  const maxUi = buildNumField('Max', o.max); refreshers.push(maxUi.refresh); g.body.appendChild(maxUi.root);
  const offUi = buildNumField('Offset', o.offset); refreshers.push(offUi.refresh); g.body.appendChild(offUi.root);
  const invUi = buildToggleRow('Invert', o.invert, 'invert output'); refreshers.push(invUi.refresh); g.body.appendChild(invUi.root);
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
    header.appendChild(enLabel);
  }

  // Source dropdown
  const srcSel = el('select', 'rw-select rw-mod-slot-src') as HTMLSelectElement;
  for (const opt of adapter.source.options) {
    const o = el('option') as HTMLOptionElement;
    o.value = opt.v; o.textContent = opt.l;
    srcSel.appendChild(o);
  }
  srcSel.addEventListener('change', () => adapter.source.set(srcSel.value));
  header.appendChild(srcSel);

  // Expand toggle
  const expandBtn = el('button', 'rw-btn rw-mod-slot-expand') as HTMLButtonElement;
  expandBtn.type = 'button';
  expandBtn.textContent = '▶';
  expandBtn.title = 'Show / hide source-specific controls';
  expandBtn.addEventListener('click', () => adapter.expanded.set(!adapter.expanded.get()));
  header.appendChild(expandBtn);

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
  amtWrap.append(amtRange, amtNum);
  amtRange.addEventListener('input', () => {
    const v = +amtRange.value;
    adapter.amount.set(v);
    if (amtNum.value !== amtRange.value) amtNum.value = amtRange.value;
  });
  amtNum.addEventListener('input', () => {
    const v = parseFloat(amtNum.value);
    if (!Number.isNaN(v)) {
      adapter.amount.set(v);
      if (amtRange.value !== amtNum.value) amtRange.value = amtNum.value;
    }
  });
  header.appendChild(amtWrap);

  // Target dropdown
  const tgtSel = el('select', 'rw-select rw-mod-slot-tgt') as HTMLSelectElement;
  for (const opt of adapter.target.options) {
    const o = el('option') as HTMLOptionElement;
    o.value = opt.v; o.textContent = opt.l;
    tgtSel.appendChild(o);
  }
  tgtSel.addEventListener('change', () => adapter.target.set(tgtSel.value));
  header.appendChild(tgtSel);

  // Copy / paste / reset
  let copyBtn: HTMLButtonElement | null = null;
  let pasteBtn: HTMLButtonElement | null = null;
  if (adapter.caps.showCopyPaste) {
    copyBtn = buildIconBtn('Copy patch', 'C', () => adapter.copy());
    pasteBtn = buildIconBtn('Paste patch', 'V', () => adapter.paste());
    header.append(copyBtn, pasteBtn);
  }
  const delBtn = buildIconBtn(adapter.caps.resetLabel, 'X', () => adapter.reset());
  header.appendChild(delBtn);

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
    if (pasteBtn) pasteBtn.disabled = !canPaste();

    // Sync expand state.
    const open = adapter.expanded.get();
    body.style.display = open ? '' : 'none';
    expandBtn.textContent = open ? '▼' : '▶';
    card.classList.toggle('expanded', open);

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

  return { root: card, refresh };
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
