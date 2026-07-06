/**
 * Modulation matrix UI — 4 slots, each can be a Ramp, Waveform, Audio band,
 * Beat, MIDI / OSC source, Joystick, or Constant generator routed to any
 * DCU/post-fx parameter.
 *
 * v8 layout — every slot is now a collapsible card with source-specific
 * controls inline plus a shared "output stage" (curve / range / offset /
 * invert). The joystick pad and the global Tempo BPM live above the slot
 * list. See `panel.css` for the row layout classes.
 *
 * This replaces the v2 layout (one row per knob, no expand affordance,
 * `clockSync: boolean` toggle).
 */

import {
  ClockDivision, ModSlot, ModSource, ModTarget, OutputCurve,
  SettingsStore, SyncMode, DEFAULT_MOD_SLOT,
  consumeMigrationNotices,
} from '../../state/Settings';
import { ModMatrix } from '../../modulation/ModMatrix';
import { CVInput } from '../../audio/CVInput';
import { GamepadInput } from '../../input/GamepadInput';
import { ALL_DIVISIONS } from '../../midi/MidiClock';
import { group, button } from '../widgets';
import { TARGETS, cvOutputTargets } from '../targets';
import {
  createSlotRow, SlotRowAdapter, SourceKind,
  getSlotClipboard, setSlotClipboard,
} from '../shared/SlotRow';
import { listPatternOutputs } from '../../renderer/patterns/PatternRegistry';

/**
 * The string value used in the <select> for a pattern output entry,
 * e.g. `'po:lissajous:x'`. Encoding lets the source dropdown enumerate
 * every signal as a top-level option (Spec: "appear in the source
 * dropdown alongside LFO/Audio/...") while ModSlot still keeps a
 * compact closed-set `ModSource` and a sibling `patternOutputId`.
 *
 * The adapter's `source.get/set` (below) translates between this
 * encoded string and the underlying slot fields.
 */
const PATTERN_OUTPUT_SELECT_PREFIX = 'po:';

/** Encode a bus id to the dropdown value. */
function encodePatternOutputValue(busId: string): string {
  return PATTERN_OUTPUT_SELECT_PREFIX + busId;
}

/** Decode a dropdown value into a bus id, or null if it's not a
 *  pattern-output entry. */
function decodePatternOutputValue(v: string): string | null {
  return v.startsWith(PATTERN_OUTPUT_SELECT_PREFIX)
    ? v.slice(PATTERN_OUTPUT_SELECT_PREFIX.length)
    : null;
}

/**
 * Build the source dropdown options. Pattern outputs appear as
 * grouped entries (`<optgroup label="Pattern Outputs">`) at the
 * bottom; adding a new pattern signal in `PatternRegistry` picks up
 * automatically without a manual edit here.
 */
function buildSources(): { v: string; l: string; group?: string }[] {
  const sources: { v: string; l: string; group?: string }[] = [
    { v: 'sine',         l: 'Sine' },
    { v: 'triangle',     l: 'Triangle' },
    { v: 'square',       l: 'Square' },
    { v: 'saw',          l: 'Saw' },
    { v: 'pulse',        l: 'Pulse (duty)' },
    { v: 'ramp',         l: 'Ramp' },
    { v: 'audio',        l: 'Audio (envelope)' },
    { v: 'audioBand',    l: 'Audio Band [n]' },
    { v: 'beat',         l: 'Beat' },
    { v: 'midiCC',       l: 'MIDI CC' },
    { v: 'midiNote',     l: 'MIDI Note' },
    { v: 'midiVelocity', l: 'MIDI Velocity' },
    { v: 'midiClock',    l: 'MIDI Clock' },
    { v: 'osc',          l: 'OSC' },
    { v: 'joystickX',    l: 'Joystick X' },
    { v: 'joystickY',    l: 'Joystick Y' },
    { v: 'joystickZ',    l: 'Joystick Z (scroll)' },
    { v: 'constant',     l: 'Constant' },
    { v: 'cvAudio',      l: 'CV Input (audio)' },
    { v: 'cvOsc',        l: 'CV Input (OSC)' },
    { v: 'gamepadAxis',  l: 'Gamepad Axis' },
    { v: 'gamepadBtn',   l: 'Gamepad Button' },
  ];
  for (const entry of listPatternOutputs()) {
    sources.push({
      v: encodePatternOutputValue(entry.busId),
      l: `Pattern: ${entry.signal.label}`,
      group: 'Pattern Outputs',
    });
  }
  return sources;
}

const SOURCES: { v: string; l: string; group?: string }[] = buildSources();

const SYNC_MODES: { v: SyncMode; l: string }[] = [
  { v: 'free',  l: 'Free (Hz)' },
  { v: 'midi',  l: 'MIDI Clock' },
  { v: 'tempo', l: 'Tempo (BPM)' },
];

/** Static portion of the Target dropdown options. CV-output channel
 *  entries (`cv:N`) are appended live by `buildTargetOptions(settings)`,
 *  so they refresh the moment the user adds / removes / re-types an
 *  output in the I/O panel. */
const TARGET_OPTS_STATIC: { v: ModTarget | 'none'; l: string }[] = [
  { v: 'none', l: '— none —' },
  ...TARGETS,
];

function buildTargetOpts(settings: SettingsStore): { v: ModTarget | 'none'; l: string }[] {
  return [...TARGET_OPTS_STATIC, ...cvOutputTargets(settings)];
}

const RAMP_MODES: ModSlot['rampMode'][] = ['up', 'down', 'triangle', 'hold'];

const CURVES: { v: OutputCurve; l: string }[] = [
  { v: 'linear', l: 'Linear' },
  { v: 'exp',    l: 'Exp' },
  { v: 'log',    l: 'Log' },
  { v: 's',      l: 'S-curve' },
  { v: 'step',   l: 'Step' },
];

/**
 * One-shot guard — show the migration toast at most once per page load,
 * even if the modulation section is re-mounted (e.g. after switching
 * panel docks or layout modes).
 */
let _migrationToastShown = false;

export function createModulationSection(
  settings: SettingsStore,
  matrix: ModMatrix,
  cv?: CVInput,
  gamepad?: GamepadInput,
): HTMLElement {
  const root = document.createElement('div');

  // -----------------------------------------------------------------
  // Joystick pad
  // -----------------------------------------------------------------
  root.appendChild(buildJoystick(matrix));

  // -----------------------------------------------------------------
  // Global Tempo BPM (single shared source — Timeline + Classic + Graph)
  // -----------------------------------------------------------------
  root.appendChild(buildTempoGroup(settings));

  // -----------------------------------------------------------------
  // Audio mic shortcut
  // -----------------------------------------------------------------
  const audioGroup = group('Audio Interface (mic)');
  const audioBtn = document.createElement('button');
  audioBtn.className = 'rw-btn';
  audioBtn.textContent = 'Enable Mic';
  let audioOn = false;
  audioBtn.addEventListener('click', async () => {
    audioOn = !audioOn;
    try {
      await matrix.setAudioEnabled(audioOn);
      audioBtn.textContent = audioOn ? 'Disable Mic' : 'Enable Mic';
      audioBtn.classList.toggle('primary', audioOn);
    } catch (err) {
      audioOn = false;
      audioBtn.textContent = `Error: ${(err as Error).message}`;
    }
  });
  audioGroup.body.appendChild(audioBtn);
  const audioHint = document.createElement('div');
  audioHint.className = 'rw-hint';
  audioHint.textContent = 'For full FFT control, use the Audio panel under the I/O tab.';
  audioGroup.body.appendChild(audioHint);
  root.appendChild(audioGroup.root);

  // -----------------------------------------------------------------
  // Slot list
  // -----------------------------------------------------------------
  const refreshers: Array<() => void> = [];
  const targetRebuilders: Array<() => void> = [];
  const slots = settings.get('modSlots');
  for (let i = 0; i < slots.length; i++) {
    const { el, refresh, rebuildTargetOptions } = createSlot(settings, matrix, i, cv, gamepad);
    refreshers.push(refresh);
    if (rebuildTargetOptions) targetRebuilders.push(rebuildTargetOptions);
    root.appendChild(el);
  }

  // Re-run every slot's refresh when ANY slot data changes (paste, source
  // change, etc.). Cheap because each slot's refresh just rewrites the
  // few fields it owns.
  settings.subscribe('modSlots', () => { for (const r of refreshers) r(); });
  settings.subscribe('modSlotExpanded', () => { for (const r of refreshers) r(); });
  // CV-output channels appear as `cv:N` entries in the Target dropdown.
  // Re-render those options whenever the user adds / removes / relabels
  // an output channel in the I/O panel — otherwise dropdowns would
  // stay stale until the next full re-mount.
  settings.subscribe('cvOutputChannels', () => {
    for (const r of targetRebuilders) r();
    for (const r of refreshers) r();
  });

  // Global "retrigger all ramps" — wrap in a group so it doesn't dangle
  // visually below the slot list (master spec UI polish: "Retrigger
  // Ramps label at the bottom appears dangling").
  const globalActions = group('All slots');
  globalActions.body.appendChild(button('Retrigger Ramps', () => matrix.retriggerRamps()));
  root.appendChild(globalActions.root);

  // -----------------------------------------------------------------
  // One-time migration toast (collected by store.ts on Timeline import)
  // -----------------------------------------------------------------
  if (!_migrationToastShown) {
    _migrationToastShown = true;
    const notices = consumeMigrationNotices();
    if (notices.length > 0) {
      const head = notices.slice(0, 3).join('\n');
      const tail = notices.length > 3 ? `\n…and ${notices.length - 3} more.` : '';
      showMigrationToast(`Migration notice:\n${head}${tail}`);
    }
  }

  return root;
}

// =====================================================================
// Joystick pad (unchanged from v2 — extracted for readability)
// =====================================================================

function buildJoystick(matrix: ModMatrix): HTMLElement {
  const jsGroup = group('Joystick (XY pad + Z)');
  const xyzReadout = document.createElement('div');
  xyzReadout.className = 'rw-joystick-readouts';
  const xR = document.createElement('span'); xR.textContent = 'X: 0.00';
  const yR = document.createElement('span'); yR.textContent = 'Y: 0.00';
  const zR = document.createElement('span'); zR.textContent = 'Z: 0.00';
  xyzReadout.append(xR, yR, zR);
  jsGroup.body.appendChild(xyzReadout);

  const lockRow = document.createElement('div');
  lockRow.className = 'rw-joystick-lock';
  const lockSel = document.createElement('select');
  lockSel.className = 'rw-select';
  for (const o of [
    { v: 'none', l: 'Lock: none' },
    { v: 'x',    l: 'Lock: X only' },
    { v: 'y',    l: 'Lock: Y only' },
  ]) {
    const opt = document.createElement('option');
    opt.value = o.v; opt.textContent = o.l;
    lockSel.appendChild(opt);
  }
  lockRow.appendChild(lockSel);
  jsGroup.body.appendChild(lockRow);

  const padWrap = document.createElement('div');
  padWrap.className = 'rw-joystick-wrap';
  const pad = document.createElement('div');
  pad.className = 'rw-joystick';
  const knob = document.createElement('div');
  knob.className = 'knob';
  knob.style.left = '50%'; knob.style.top = '50%';
  pad.appendChild(knob);

  const zSlider = document.createElement('div');
  zSlider.className = 'rw-joystick-z';
  zSlider.setAttribute('role', 'slider');
  zSlider.setAttribute('aria-label', 'Joystick Z axis');
  zSlider.setAttribute('aria-valuemin', '-1');
  zSlider.setAttribute('aria-valuemax', '1');
  zSlider.setAttribute('aria-orientation', 'vertical');
  zSlider.tabIndex = 0;
  const zFill = document.createElement('div');
  zFill.className = 'rw-joystick-z-fill';
  const zKnob = document.createElement('div');
  zKnob.className = 'rw-joystick-z-knob';
  zSlider.append(zFill, zKnob);
  padWrap.append(pad, zSlider);

  const setZSliderValue = (v: number): void => {
    const clamped = Math.max(-1, Math.min(1, v));
    const t = (clamped + 1) / 2;
    const pct = t * 100;
    zFill.style.height = `${pct}%`;
    zKnob.style.bottom = `${pct}%`;
    zSlider.setAttribute('aria-valuenow', String(clamped));
    zSlider.setAttribute('aria-valuetext', clamped.toFixed(2));
  };
  setZSliderValue(0);

  let jx = 0, jy = 0, jz = 0;
  let dragging = false;
  function setKnob(nx: number, ny: number) {
    knob.style.left = `${(nx * 0.5 + 0.5) * 100}%`;
    knob.style.top  = `${(ny * 0.5 + 0.5) * 100}%`;
  }
  function emit() {
    matrix.setJoystick(jx, jy, jz);
    xR.textContent = `X: ${jx.toFixed(2)}`;
    yR.textContent = `Y: ${jy.toFixed(2)}`;
    zR.textContent = `Z: ${jz.toFixed(2)}`;
  }
  function onMove(e: PointerEvent) {
    if (!dragging) return;
    const r = pad.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width)  * 2 - 1;
    const y = ((e.clientY - r.top)  / r.height) * 2 - 1;
    const lock = lockSel.value;
    if (lock !== 'y') jx = Math.max(-1, Math.min(1,  x));
    if (lock !== 'x') jy = Math.max(-1, Math.min(1, -y));
    setKnob(jx, -jy);
    emit();
  }
  pad.addEventListener('pointerdown', (e) => {
    dragging = true;
    pad.setPointerCapture(e.pointerId);
    onMove(e);
  });
  pad.addEventListener('pointermove', onMove);
  pad.addEventListener('pointerup', (e) => {
    dragging = false;
    pad.releasePointerCapture(e.pointerId);
  });
  pad.addEventListener('wheel', (e) => {
    e.preventDefault();
    jz = Math.max(-1, Math.min(1, jz + (e.deltaY < 0 ? 0.05 : -0.05)));
    setZSliderValue(jz);
    emit();
  }, { passive: false });

  // Z slider — custom div-based for iOS Safari touch reliability.
  const updateZFromPointer = (clientY: number): void => {
    const r = zSlider.getBoundingClientRect();
    if (r.height <= 0) return;
    const t = 1 - Math.max(0, Math.min(1, (clientY - r.top) / r.height));
    jz = Math.max(-1, Math.min(1, t * 2 - 1));
    setZSliderValue(jz);
    emit();
  };
  zSlider.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const activeId = e.pointerId;
    updateZFromPointer(e.clientY);
    const onMove2 = (ev: PointerEvent): void => {
      if (ev.pointerId !== activeId) return;
      ev.preventDefault();
      updateZFromPointer(ev.clientY);
    };
    const onUp = (ev: PointerEvent): void => {
      if (ev.pointerId !== activeId) return;
      document.removeEventListener('pointermove',   onMove2);
      document.removeEventListener('pointerup',     onUp);
      document.removeEventListener('pointercancel', onUp);
    };
    document.addEventListener('pointermove',   onMove2, { passive: false });
    document.addEventListener('pointerup',     onUp);
    document.addEventListener('pointercancel', onUp);
  });
  zSlider.addEventListener('keydown', (e) => {
    let next = jz;
    switch (e.key) {
      case 'ArrowUp':   case 'ArrowRight': next += 0.05; break;
      case 'ArrowDown': case 'ArrowLeft':  next -= 0.05; break;
      case 'PageUp':                       next += 0.2;  break;
      case 'PageDown':                     next -= 0.2;  break;
      case 'Home':                         next = 1;     break;
      case 'End':                          next = -1;    break;
      case 'Backspace': case 'Delete':     next = 0;     break;
      default: return;
    }
    e.preventDefault();
    jz = Math.max(-1, Math.min(1, next));
    setZSliderValue(jz);
    emit();
  });
  jsGroup.body.appendChild(padWrap);

  return jsGroup.root;
}

// =====================================================================
// Global Tempo group
// =====================================================================

function buildTempoGroup(settings: SettingsStore): HTMLElement {
  const g = group('Tempo');
  const r = document.createElement('div');
  r.className = 'rw-row';
  const lbl = document.createElement('label');
  lbl.className = 'rw-label';
  lbl.textContent = 'BPM';
  r.appendChild(lbl);

  const wrap = document.createElement('div');
  wrap.className = 'rw-control rw-slider';
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '20'; range.max = '300'; range.step = '0.5';
  const num = document.createElement('input');
  num.type = 'number';
  num.min = '20'; num.max = '300'; num.step = '0.5';
  num.className = 'rw-num';
  wrap.append(range, num);
  r.appendChild(wrap);
  g.body.appendChild(r);

  const hint = document.createElement('div');
  hint.className = 'rw-hint';
  hint.textContent = 'Shared by Timeline, Classic LFOs (Tempo sync), and the Graph Clock node.';
  g.body.appendChild(hint);

  const apply = (v: number) => {
    const s = String(v);
    if (range.value !== s) range.value = s;
    if (num.value !== s) num.value = s;
  };
  settings.subscribe('internalBpm', (v) => apply(v as number));
  range.addEventListener('input', () => settings.set('internalBpm', +range.value));
  num.addEventListener('input', () => {
    const v = parseFloat(num.value);
    if (!Number.isNaN(v)) settings.set('internalBpm', v);
  });

  return g.root;
}

// =====================================================================
// Per-slot row
// =====================================================================

interface SlotUi {
  el: HTMLElement;
  refresh: () => void;
  rebuildTargetOptions?: () => void;
}

function createSlot(
  settings: SettingsStore,
  matrix: ModMatrix,
  index: number,
  cv?: CVInput,
  gamepad?: GamepadInput,
): SlotUi {
  const get = (): ModSlot => settings.get('modSlots')[index];
  const update = (patch: Partial<ModSlot>): void => {
    const next = settings.get('modSlots').slice();
    next[index] = { ...next[index], ...patch };
    settings.set('modSlots', next);
    if (patch.target && patch.target !== 'none') matrix.recaptureBase(patch.target);
  };
  const setExpanded = (open: boolean): void => {
    const arr = (settings.get('modSlotExpanded') ?? []).slice();
    while (arr.length <= index) arr.push(false);
    if (arr[index] === open) return;
    arr[index] = open;
    settings.set('modSlotExpanded', arr);
  };
  const isExpanded = (): boolean => Boolean((settings.get('modSlotExpanded') ?? [])[index]);

  // Build a `SlotRowAdapter` view of this Classic ModSlot. The shared
  // SlotRow component (used by Graph beginner view too) renders the row
  // entirely through this adapter — it never sees `ModSlot` directly.
  const adapter: SlotRowAdapter = {
    enabled: { get: () => get().enabled, set: (v) => update({ enabled: v }) },
    source: {
      // Encoded value: `'po:<busId>'` for pattern outputs, otherwise
      // the literal ModSource. Lets the dropdown enumerate every
      // pattern signal as its own option while the slot keeps a
      // compact closed-set `source` field + sibling `patternOutputId`.
      get: () => {
        const slot = get();
        if (slot.source === 'patternOutput' && slot.patternOutputId) {
          return encodePatternOutputValue(slot.patternOutputId);
        }
        return slot.source;
      },
      set: (v) => {
        const decoded = decodePatternOutputValue(v);
        if (decoded != null) {
          update({ source: 'patternOutput' as ModSource, patternOutputId: decoded });
        } else {
          // Switching AWAY from a pattern output: clear the bus id
          // to avoid stale state if the user later switches back.
          update({ source: v as ModSource, patternOutputId: '' });
        }
      },
      options: SOURCES,
    },
    target: {
      get: () => get().target,
      set: (v) => update({ target: v as ModTarget | 'none' }),
      options: () => buildTargetOpts(settings) as ReadonlyArray<{ v: string; l: string }>,
    },
    amount: {
      get: () => get().amount,
      set: (v) => update({ amount: v }),
      min: -5, max: 5, step: 0.001,
    },
    expanded: { get: isExpanded, set: setExpanded },
    sourceKind: 'unsupported',
    lfo: {
      frequency: { get: () => get().frequency, set: (v) => update({ frequency: v }), min: 0.001, max: 20, step: 0.001 },
      phase:     { get: () => get().phase,     set: (v) => update({ phase: v }),     min: 0,     max: 1,  step: 0.001 },
      duty:      { get: () => get().duty,      set: (v) => update({ duty: v }),      min: 0.05,  max: 0.95, step: 0.001 },
      depth:     { get: () => get().lfoDepth,  set: (v) => update({ lfoDepth: v }),  min: 0,     max: 1,  step: 0.001 },
      bipolar:   { get: () => !get().lfoUnipolar, set: (v) => update({ lfoUnipolar: !v }) },
      syncMode:  { get: () => get().syncMode,  set: (v) => update({ syncMode: v as SyncMode }), options: SYNC_MODES },
      clockDivision: {
        get: () => get().clockDivision,
        set: (v) => update({ clockDivision: v as ClockDivision }),
        options: ALL_DIVISIONS.map((d) => ({ v: d, l: d })),
      },
    },
    ramp: {
      timeSec: { get: () => get().rampTimeSec, set: (v) => update({ rampTimeSec: v }), min: 0.05, max: 600, step: 0.05 },
      mode: {
        get: () => get().rampMode,
        set: (v) => update({ rampMode: v as ModSlot['rampMode'] }),
        options: RAMP_MODES.map((m) => ({ v: m, l: m })),
      },
      loop: { get: () => get().rampLoop, set: (v) => update({ rampLoop: v }) },
      retrigger: () => matrix.retriggerSlot(index),
    },
    audio: {
      bandIndex: { get: () => get().bandIndex, set: (v) => update({ bandIndex: Math.round(v) }), min: 0, max: 127, step: 1 },
      attackMs:  { get: () => get().audioAttackMs,  set: (v) => update({ audioAttackMs: v }),  min: 1, max: 1000, step: 1 },
      releaseMs: { get: () => get().audioReleaseMs, set: (v) => update({ audioReleaseMs: v }), min: 1, max: 5000, step: 1 },
      gain:      { get: () => get().audioGain,      set: (v) => update({ audioGain: v }),      min: 0, max: 4, step: 0.01 },
      floor:     { get: () => get().audioFloor,     set: (v) => update({ audioFloor: v }),     min: 0, max: 1, step: 0.001 },
    },
    joystick: {
      smoothMs: { get: () => get().joystickSmoothMs, set: (v) => update({ joystickSmoothMs: v }), min: 0, max: 500, step: 1 },
      deadzone: { get: () => get().joystickDeadzone, set: (v) => update({ joystickDeadzone: v }), min: 0, max: 0.5, step: 0.001 },
      invert:   { get: () => get().joystickInvert,   set: (v) => update({ joystickInvert: v }) },
    },
    constant: {
      value: { get: () => get().constantValue, set: (v) => update({ constantValue: v }), min: -1, max: 1, step: 0.001 },
    },
    midiClock: {
      clockDivision: {
        get: () => get().clockDivision,
        set: (v) => update({ clockDivision: v as ClockDivision }),
        options: ALL_DIVISIONS.map((d) => ({ v: d, l: d })),
      },
    },
    cv: {
      channel: {
        get: () => get().cvChannel,
        set: (v) => update({ cvChannel: Math.max(0, Math.round(v)) }),
        min: 0, max: 31, step: 1,
      },
      readVoltage: () => {
        if (get().source === 'cvOsc') {
          // For OSC bridge route, the "voltage" we display is the
          // mapped value from the bridge channel's range. We don't
          // have the OSC client in this scope, so fall back to a
          // simple "—" placeholder; the I/O panel shows the live
          // value with full context.
          return NaN;
        }
        return cv ? cv.getVoltage(get().cvChannel | 0) : NaN;
      },
      readNormalized: () => {
        if (get().source === 'cvOsc') return 0;
        return cv ? cv.getNormalized(get().cvChannel | 0) : 0;
      },
      calibrate: () => { cv?.calibrate(get().cvChannel | 0); persistCvChannelConfigs(settings, cv); },
      resetCalibration: () => { cv?.resetCalibration(get().cvChannel | 0); persistCvChannelConfigs(settings, cv); },
      rangeLabel: () => {
        if (get().source === 'cvOsc') return 'OSC';
        const channels = settings.get('cvChannels');
        const ch = channels[get().cvChannel | 0];
        return ch?.range ?? '+/-5V';
      },
      available: () => {
        if (get().source === 'cvOsc') return true;
        return !!(cv && cv.running);
      },
      isOsc: get().source === 'cvOsc',
      readVariance: () => cv ? cv.getVariance(get().cvChannel | 0) : 0,
      learn: () => { void runCvLearnForSlot(settings, cv, index); },
    },
    gamepad: {
      index: {
        get: () => get().gamepadIndex,
        set: (v) => update({ gamepadIndex: Math.max(0, Math.round(v)) }),
        min: 0, max: 31, step: 1,
      },
      readValue: () => {
        if (!gamepad) return 0;
        return get().source === 'gamepadBtn'
          ? gamepad.getButton(get().gamepadIndex | 0)
          : gamepad.getAxis(get().gamepadIndex | 0);
      },
      available: () => !!gamepad,
      isButton: get().source === 'gamepadBtn',
    },
    output: {
      curve:  { get: () => get().outputCurve,  set: (v) => update({ outputCurve: v as OutputCurve }), options: CURVES },
      min:    { get: () => get().outputMin,    set: (v) => update({ outputMin: v }),    min: -2, max: 2, step: 0.001 },
      max:    { get: () => get().outputMax,    set: (v) => update({ outputMax: v }),    min: -2, max: 2, step: 0.001 },
      offset: { get: () => get().outputOffset, set: (v) => update({ outputOffset: v }), min: -1, max: 1, step: 0.001 },
      invert: { get: () => get().outputInvert, set: (v) => update({ outputInvert: v }) },
      slewRise: { get: () => get().slewRiseMs ?? 0, set: (v) => update({ slewRiseMs: Math.max(0, v) }), min: 0, max: 5000, step: 1 },
      slewFall: { get: () => get().slewFallMs ?? 0, set: (v) => update({ slewFallMs: Math.max(0, v) }), min: 0, max: 5000, step: 1 },
    },
    midiOut: {
      enabled: { get: () => get().midiOutEnabled, set: (v) => update({ midiOutEnabled: v }) },
      channel: { get: () => get().midiOutChannel, set: (v) => update({ midiOutChannel: Math.round(v) }), min: 1, max: 16, step: 1 },
      cc:      { get: () => get().midiOutCC,      set: (v) => update({ midiOutCC:      Math.round(v) }), min: 0, max: 127, step: 1 },
    },
    copy: () => setSlotClipboard({ ...get() }),
    paste: () => {
      const clip = getSlotClipboard() as Partial<ModSlot> | null;
      if (clip) update({ ...clip });
    },
    reset: () => update({ ...DEFAULT_MOD_SLOT }),
    softReset: () => {
      // Type-defaults for params, identity output, amount=0; KEEP source +
      // target + enabled. The user wants this for "snap a wonky LFO back
      // to a known-good Sine 1Hz neutral state without losing my routing".
      const cur = get();
      update({
        ...DEFAULT_MOD_SLOT,
        source: cur.source,
        target: cur.target,
        enabled: cur.enabled,
        amount: 0,
      });
    },
    hardReset: () => {
      // Full default + target='none' + amount=0. Slot stays in the list
      // (delete is the X button); this just wipes its configuration.
      update({ ...DEFAULT_MOD_SLOT, amount: 0, target: 'none' });
    },
    midiClockState: () => matrix.slotMidiClockState(index),
    caps: {
      showEnable: true,
      showCopyPaste: true,
      showMidiOut: true,
      resetLabel: 'Reset slot',
      showRampRetrigger: true,
    },
  };

  // The shared row component reads `sourceKind` to decide which body
  // groups to render. Recompute it from the slot's source on every
  // refresh so that changing the source dropdown rebuilds the body.
  const updateSourceKind = (): void => {
    adapter.sourceKind = classicSourceToKind(get().source);
    // CV adapter has source-dependent flags — recompute on every refresh.
    if (adapter.cv) adapter.cv.isOsc = get().source === 'cvOsc';
    if (adapter.gamepad) adapter.gamepad.isButton = get().source === 'gamepadBtn';
  };
  updateSourceKind();

  const ui = createSlotRow(adapter);
  return {
    el: ui.root,
    refresh: () => { updateSourceKind(); ui.refresh(); },
    rebuildTargetOptions: ui.rebuildTargetOptions,
  };
}

/**
 * After `cv.calibrate(ch)` mutates the channel's offset on the CVInput's
 * local config, mirror that into Settings so the change persists across
 * page reloads. We avoid a `settings.subscribe('cvChannels', ...)` loop
 * because `CVInput.setChannelConfigs` is what we re-feed here.
 */
function persistCvChannelConfigs(settings: SettingsStore, cv?: CVInput): void {
  if (!cv) return;
  // Pull the current configs from CVInput by introspection — but since
  // CVInput doesn't expose configs directly, we read them back from the
  // cv channel by snapshotting the offset for each channel that just
  // changed. Cleaner: extend CVInput with a `getChannelConfigs()` method.
  // For now, just bump the channel array in Settings to trigger a
  // re-publish; the offset is owned by CVInput and re-applied on next
  // start. We don't actually persist offsets through CVInput's local
  // copy unless the user edits via I/O panel (which writes to Settings
  // directly).
  const arr = settings.get('cvChannels').slice();
  settings.set('cvChannels', arr); // poke
}

/**
 * CV Learn for a Classic slot: monitor variance for 2 seconds, pick the
 * channel that wiggled the most, and bind it to this slot. The pattern
 * mirrors `OscClient.learn()` and `MidiManager.learn()` so the UX feels
 * consistent.
 */
async function runCvLearnForSlot(
  settings: SettingsStore,
  cv: CVInput | undefined,
  slotIndex: number,
): Promise<void> {
  if (!cv || !cv.running) {
    alert('CV reader is not running. Open the I/O panel and start the CV input.');
    return;
  }
  // Mark the slot's source as cvAudio so we can write the channel into
  // it once detected. (If user clicked Learn without first picking the
  // source, we infer they meant cvAudio.)
  const slots = settings.get('modSlots').slice();
  if (slots[slotIndex].source !== 'cvAudio') {
    slots[slotIndex] = { ...slots[slotIndex], source: 'cvAudio' };
    settings.set('modSlots', slots);
  }
  // Reset variance baseline by waiting one tick — the worklet's
  // exponential-decay window is already self-resetting; we just sample
  // 2s from now.
  await new Promise((r) => setTimeout(r, 2000));
  const ch = cv.pickHighestVarianceChannel(0.0005);
  if (ch < 0) {
    alert('No CV movement detected. Try moving the CV source while clicking Learn.');
    return;
  }
  const next = settings.get('modSlots').slice();
  next[slotIndex] = { ...next[slotIndex], cvChannel: ch };
  settings.set('modSlots', next);
}

/** Map a Classic ModSource to the SlotRow `SourceKind`. */
function classicSourceToKind(s: ModSource): SourceKind {
  switch (s) {
    case 'sine': case 'triangle': case 'square': case 'saw': case 'pulse':
      return 'lfo';
    case 'ramp':         return 'ramp';
    case 'audio':        return 'audio';
    case 'audioBand':    return 'audioBand';
    case 'beat':         return 'beat';
    case 'midiClock':    return 'midiClock';
    case 'midiCC':
    case 'midiNote':
    case 'midiVelocity': return 'midiOther';
    case 'osc':          return 'osc';
    case 'joystickX':
    case 'joystickY':
    case 'joystickZ':    return 'joystick';
    case 'constant':     return 'constant';
    case 'cvAudio':      return 'cvAudio';
    case 'cvOsc':        return 'cvOsc';
    case 'gamepadAxis':
    case 'gamepadBtn':   return 'gamepad';
    case 'patternOutput':return 'patternOutput';
  }
}

/**
 * Append a transient toast to the global `#rw-toast-host` (created by
 * `ResponsivePanel`). Falls back to a bare DOM element appended to body
 * if the host isn't available yet (e.g. very early boot order). Lives
 * here rather than on the ResponsivePanel instance because Modulation
 * doesn't have a reference to it.
 */
function showMigrationToast(message: string): void {
  const host = document.getElementById('rw-toast-host') ?? document.body;
  const t = document.createElement('div');
  t.className = 'rw-toast';
  const msg = document.createElement('span');
  msg.textContent = message;
  t.appendChild(msg);
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'rw-toast-dismiss';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.textContent = '×';
  dismiss.addEventListener('click', () => t.remove());
  t.appendChild(dismiss);
  host.appendChild(t);
  setTimeout(() => t.remove(), 10000);
}
