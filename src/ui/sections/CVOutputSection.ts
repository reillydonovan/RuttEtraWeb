/**
 * I/O panel section for CV OUTPUT — symmetric counterpart to CVSection.
 *
 * Lives in the I/O tab beneath "CV Inputs". Owns:
 *
 *   - Output interface picker — `mediaDevices.enumerateDevices` filtered
 *     to `audiooutput` kind (AudioContext.setSinkId target).
 *   - Master channel-count input — capped to the interface's
 *     `maxChannelCount` at runtime; the user can request fewer.
 *   - Start / Stop button — boots `CVOutput`, opens the AudioContext
 *     with the chosen `sinkId`, loads the worklet module. Doubles as the
 *     user-gesture event Chrome needs for AudioContext to actually run.
 *   - Per-channel rows (one per `Settings.cvOutputChannels` entry):
 *     Type, Source, voltage Range, Scale, Offset, Smooth, live voltage
 *     readout, Test button (sends +2.5V steady), Enable toggle.
 *   - Type-specific sub-rows (collapsible per channel):
 *       cv      — none
 *       gate    — threshold, high V, low V
 *       trigger — pulse width (ms), pulse V, edge threshold
 *       clock   — division, pulse width %, amplitude V, source (internal/midi)
 *       pitch   — reference note, reference V, V/oct, glide ms, quantize,
 *                 scale, scale root, calibrate button
 *   - "+ Add output" — appends a fresh channel using the next index.
 *
 * Live readouts use a single requestAnimationFrame loop, throttled to
 * ~10 Hz to keep CPU low. The loop reads the worklet's last-known
 * target by re-running the type processor with the same inputs the
 * worklet sees — true sub-sample voltage isn't available without a
 * loopback, but the displayed value is exactly what's on the wire.
 *
 * Per the v9 spec:
 *   - Channels start with `enabled = false` on every page load (forced
 *     by `migrateSettings`); the user must click Enable per channel
 *     before any voltage actually leaves the interface.
 *   - The master Start / Stop button toggles `cvOutputEnabled` AND
 *     calls `CVOutput.start()` — turning it off triggers a 100ms
 *     ramp-to-zero on every channel and then suspends the AudioContext.
 */

import {
  CVOutputChannel, CVOutScaleType, CVOutType,
  CVRange, CVPolarity, ClockDivision,
  DEFAULT_CV_OUTPUT_CHANNEL, SettingsStore,
  ModSlot,
} from '../../state/Settings';
import { CVOutput, pitchVoltageForNote } from '../../audio/CVOutput';
import { ALL_DIVISIONS } from '../../midi/MidiClock';
import { TARGETS } from '../targets';
import { group, row } from '../widgets';
import { listPatternOutputs } from '../../renderer/patterns/PatternRegistry';

interface CVOutputSectionDeps {
  settings: SettingsStore;
  cvOut: CVOutput;
}

const TYPE_OPTIONS: { v: CVOutType; l: string }[] = [
  { v: 'cv',      l: 'CV (continuous)' },
  { v: 'gate',    l: 'Gate' },
  { v: 'trigger', l: 'Trigger' },
  { v: 'clock',   l: 'Clock' },
  { v: 'pitch',   l: '1V/oct Pitch' },
];

const RANGE_OPTIONS: { v: CVRange; l: string }[] = [
  { v: '+/-5V',  l: '±5V' },
  { v: '+/-10V', l: '±10V' },
  { v: '0-5V',   l: '0–5V' },
  { v: '0-10V',  l: '0–10V' },
];

const POLARITY_OPTIONS: { v: CVPolarity; l: string }[] = [
  { v: 'bipolar',  l: 'Bipolar' },
  { v: 'unipolar', l: 'Unipolar' },
];

const SCALE_OPTIONS: { v: CVOutScaleType; l: string }[] = [
  { v: 'chromatic',        l: 'Chromatic' },
  { v: 'major',            l: 'Major' },
  { v: 'minor',            l: 'Minor (natural)' },
  { v: 'harmonic-minor',   l: 'Harmonic minor' },
  { v: 'pentatonic-major', l: 'Pentatonic major' },
  { v: 'pentatonic-minor', l: 'Pentatonic minor' },
];

const ROOT_NOTES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
];

export function createCVOutputSection(deps: CVOutputSectionDeps): HTMLElement {
  const { settings, cvOut } = deps;
  const root = document.createElement('div');

  // -----------------------------------------------------------------
  // Device picker
  // -----------------------------------------------------------------
  const grp = group('CV Outputs (audio interface)');
  root.appendChild(grp.root);

  const blurb = document.createElement('div');
  blurb.className = 'rw-hint';
  blurb.innerHTML =
    'Sends control voltages OUT to external hardware via a DC-coupled audio interface ' +
    '(Expert Sleepers ES-3/8/9, MOTU UltraLite, some Focusrites). ' +
    '<b>AC-coupled interfaces will not work</b> — slow CV sags toward zero.';
  grp.body.appendChild(blurb);

  // Output device dropdown.
  const deviceRow = document.createElement('div');
  deviceRow.className = 'rw-row';
  const deviceLbl = document.createElement('label');
  deviceLbl.className = 'rw-label';
  deviceLbl.textContent = 'Output interface';
  const deviceSel = document.createElement('select');
  deviceSel.className = 'rw-select rw-control';
  deviceRow.append(deviceLbl, deviceSel);
  grp.body.appendChild(deviceRow);

  // Channel count (how many merger inputs to open).
  const ccRow = document.createElement('div');
  ccRow.className = 'rw-row';
  const ccLbl = document.createElement('label');
  ccLbl.className = 'rw-label';
  ccLbl.textContent = 'Channel count';
  const ccInput = document.createElement('input');
  ccInput.type = 'number';
  ccInput.min = '1';
  ccInput.max = '32';
  ccInput.className = 'rw-text rw-control';
  ccInput.value = String(settings.get('cvOutputChannelCount'));
  ccInput.addEventListener('change', () => {
    const n = Math.max(1, Math.min(32, Number.parseInt(ccInput.value, 10) || 8));
    settings.set('cvOutputChannelCount', n);
  });
  ccRow.append(ccLbl, ccInput);
  grp.body.appendChild(ccRow);

  // Start / Stop master button.
  const startRow = document.createElement('div');
  startRow.className = 'rw-row';
  const startBtn = document.createElement('button');
  startBtn.className = 'rw-btn';
  startBtn.type = 'button';
  startBtn.textContent = 'Start CV output';
  startRow.appendChild(startBtn);
  grp.body.appendChild(startRow);

  // Status line (running / channelCount / errors / setSinkId support).
  const status = document.createElement('div');
  status.className = 'rw-hint rw-cv-status';
  grp.body.appendChild(status);

  // Channel rows host.
  const channelsHost = document.createElement('div');
  channelsHost.className = 'rw-cv-channels';
  grp.body.appendChild(channelsHost);

  // "+ Add output" button.
  const addRow = document.createElement('div');
  addRow.className = 'rw-row';
  const addBtn = document.createElement('button');
  addBtn.className = 'rw-btn';
  addBtn.type = 'button';
  addBtn.textContent = '+ Add output';
  addBtn.addEventListener('click', () => {
    const cur = settings.get('cvOutputChannels');
    // Find the next free channel index — usually `cur.length`, but skip
    // gaps if the user has manually picked indices.
    const used = new Set(cur.map((c) => c.channelIndex));
    let nextIdx = 0;
    while (used.has(nextIdx)) nextIdx++;
    const next: CVOutputChannel = {
      ...DEFAULT_CV_OUTPUT_CHANNEL,
      id: `cvout-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      channelIndex: nextIdx,
    };
    settings.set('cvOutputChannels', [...cur, next]);
  });
  addRow.appendChild(addBtn);
  grp.body.appendChild(addRow);

  // -----------------------------------------------------------------
  // Refresh device list (audiooutput devices)
  // -----------------------------------------------------------------
  const refreshDevices = async (): Promise<void> => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      deviceSel.disabled = true;
      return;
    }
    let devices: MediaDeviceInfo[] = [];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch { /* noop */ }
    const outputs = devices.filter((d) => d.kind === 'audiooutput');
    const cur = settings.get('cvOutputDeviceId');
    deviceSel.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = outputs.length === 0
      ? 'No audio outputs (browser may not list them on macOS)'
      : '— select an output —';
    deviceSel.appendChild(placeholder);
    for (const d of outputs) {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Audio output (${d.deviceId.slice(0, 6)})`;
      deviceSel.appendChild(opt);
    }
    deviceSel.value = cur;
  };
  deviceSel.addEventListener('change', () => {
    settings.set('cvOutputDeviceId', deviceSel.value);
  });
  void refreshDevices();
  navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);

  // -----------------------------------------------------------------
  // Start / Stop wiring
  // -----------------------------------------------------------------
  const updateStartBtn = (): void => {
    const on = settings.get('cvOutputEnabled');
    startBtn.textContent = on ? 'Stop CV output' : 'Start CV output';
    startBtn.classList.toggle('primary', on);
  };
  startBtn.addEventListener('click', async () => {
    const on = settings.get('cvOutputEnabled');
    if (on) {
      settings.set('cvOutputEnabled', false);
      await cvOut.stop();
    } else {
      try {
        await cvOut.start({
          deviceId: settings.get('cvOutputDeviceId'),
          channelCount: settings.get('cvOutputChannelCount'),
        });
        settings.set('cvOutputEnabled', true);
      } catch (err) {
        status.textContent = `Failed to start: ${(err as Error).message}`;
      }
    }
    updateStartBtn();
  });
  updateStartBtn();

  // Subscribe to live status changes from CVOutput.
  cvOut.subscribe((s) => {
    if (!s.running) {
      status.textContent = s.error
        ? `Stopped: ${s.error}`
        : 'Stopped. Click Start to open the output device.';
      return;
    }
    const sinkNote = s.setSinkIdSupported
      ? ''
      : ' — your browser does not support setSinkId; use OS-level routing.';
    status.textContent =
      `Running. ${s.channelCount} channel${s.channelCount === 1 ? '' : 's'} connected${sinkNote}`;
  });

  // -----------------------------------------------------------------
  // Channel rows — rebuild on settings change
  // -----------------------------------------------------------------

  /** Per-row dispose handlers (rAF loops). */
  let rowDisposers: Array<() => void> = [];

  function rebuildChannels(): void {
    for (const d of rowDisposers) d();
    rowDisposers = [];
    channelsHost.replaceChildren();
    const channels = settings.get('cvOutputChannels');
    if (channels.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'rw-hint';
      empty.textContent = 'No CV outputs configured. Click "+ Add output" to create one.';
      channelsHost.appendChild(empty);
      return;
    }
    for (let i = 0; i < channels.length; i++) {
      const { row, dispose } = buildChannelRow({ settings, cvOut }, i);
      channelsHost.appendChild(row);
      rowDisposers.push(dispose);
    }
  }
  rebuildChannels();
  settings.subscribe('cvOutputChannels', rebuildChannels);

  return root;
}

// =====================================================================
// Per-channel row
// =====================================================================

function buildChannelRow(
  deps: { settings: SettingsStore; cvOut: CVOutput },
  index: number,
): { row: HTMLElement; dispose: () => void } {
  const { settings, cvOut } = deps;

  const get = (): CVOutputChannel => settings.get('cvOutputChannels')[index];
  const update = (patch: Partial<CVOutputChannel>): void => {
    const cur = settings.get('cvOutputChannels').slice();
    cur[index] = { ...cur[index], ...patch };
    settings.set('cvOutputChannels', cur);
  };
  const remove = (): void => {
    const cur = settings.get('cvOutputChannels').slice();
    cur.splice(index, 1);
    settings.set('cvOutputChannels', cur);
  };

  const row = document.createElement('div');
  row.className = 'rw-cv-channel';

  // -------------------- header --------------------
  const head = document.createElement('div');
  head.className = 'rw-cv-channel-head';

  const enInput = document.createElement('input');
  enInput.type = 'checkbox';
  enInput.checked = get().enabled;
  enInput.title = 'Enable this CV output';
  enInput.addEventListener('change', () => update({ enabled: enInput.checked }));
  head.appendChild(enInput);

  const idxLabel = document.createElement('span');
  idxLabel.className = 'rw-cv-idx';
  idxLabel.textContent = `Ch ${get().channelIndex + 1}`;
  head.appendChild(idxLabel);

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'rw-text rw-cv-label';
  labelInput.placeholder = 'Label (optional)';
  labelInput.value = get().label;
  labelInput.addEventListener('change', () => update({ label: labelInput.value }));
  head.appendChild(labelInput);

  // Type dropdown.
  const typeSel = buildSelect(TYPE_OPTIONS, get().type, (v) => update({ type: v }));
  head.appendChild(typeSel);

  // Live voltage readout.
  const live = document.createElement('div');
  live.className = 'rw-cv-live';
  live.textContent = '—V';
  head.appendChild(live);

  // Test (+2.5V steady) button.
  const testBtn = document.createElement('button');
  testBtn.className = 'rw-btn small';
  testBtn.type = 'button';
  testBtn.textContent = 'Test';
  testBtn.title = 'Force +2.5V steady on this channel for confirmation with a multimeter or external oscillator.';
  let testActive = false;
  testBtn.addEventListener('click', () => {
    testActive = !testActive;
    cvOut.setTestVoltage(get().id, testActive ? 2.5 : null);
    testBtn.textContent = testActive ? 'Stop Test' : 'Test';
    testBtn.classList.toggle('primary', testActive);
  });
  head.appendChild(testBtn);

  const delBtn = document.createElement('button');
  delBtn.className = 'rw-btn small';
  delBtn.type = 'button';
  delBtn.title = 'Remove this CV output';
  delBtn.textContent = '✕';
  delBtn.addEventListener('click', () => {
    cvOut.setTestVoltage(get().id, null);
    remove();
  });
  head.appendChild(delBtn);

  row.appendChild(head);

  // -------------------- common fields --------------------
  const common = document.createElement('div');
  common.className = 'rw-cv-row';

  // Channel index (the actual mux output on the interface).
  const chIdxInput = buildNumberField('Output ch', get().channelIndex + 1, 1, 32, 1, (v) => {
    update({ channelIndex: Math.max(0, (v | 0) - 1) });
  });
  common.appendChild(chIdxInput);

  // Range / Polarity / Smooth (always visible).
  common.appendChild(buildSelectField('Range', RANGE_OPTIONS, get().voltageRange, (v) => update({ voltageRange: v })));
  common.appendChild(buildSelectField('Polarity', POLARITY_OPTIONS, get().polarity, (v) => update({ polarity: v })));
  common.appendChild(buildNumberField('Scale', get().scale, -20, 20, 0.001, (v) => update({ scale: v })));
  common.appendChild(buildNumberField('Offset (V)', get().offset, -20, 20, 0.01, (v) => update({ offset: v })));
  common.appendChild(buildNumberField('Smooth (ms)', get().smoothMs, 0, 1000, 1, (v) => update({ smoothMs: Math.max(0, v) })));

  row.appendChild(common);

  // -------------------- source row --------------------
  const srcRow = document.createElement('div');
  srcRow.className = 'rw-cv-row';
  srcRow.appendChild(buildSourceControls({ settings, get, update }));
  row.appendChild(srcRow);

  // -------------------- type-specific row --------------------
  const typeRow = document.createElement('div');
  typeRow.className = 'rw-cv-row';
  row.appendChild(typeRow);

  function rebuildTypeRow(): void {
    typeRow.replaceChildren();
    switch (get().type) {
      case 'cv':
        // No extra controls — `cv` is the default.
        break;
      case 'gate':
        typeRow.appendChild(buildNumberField('Threshold', get().gateThreshold ?? 0.5, 0, 1, 0.001, (v) => update({ gateThreshold: v })));
        typeRow.appendChild(buildNumberField('High (V)', get().gateHighV ?? 5, -10, 10, 0.1, (v) => update({ gateHighV: v })));
        typeRow.appendChild(buildNumberField('Low (V)', get().gateLowV ?? 0, -10, 10, 0.1, (v) => update({ gateLowV: v })));
        break;
      case 'trigger':
        typeRow.appendChild(buildNumberField('Pulse (ms)', get().triggerMs ?? 10, 1, 1000, 1, (v) => update({ triggerMs: v })));
        typeRow.appendChild(buildNumberField('Pulse (V)', get().triggerV ?? 5, 0, 10, 0.1, (v) => update({ triggerV: v })));
        typeRow.appendChild(buildNumberField('Edge thresh', get().triggerThreshold ?? 0.1, 0, 1, 0.001, (v) => update({ triggerThreshold: v })));
        break;
      case 'clock': {
        const divOpts = ALL_DIVISIONS.map((d) => ({ v: d as ClockDivision, l: d }));
        typeRow.appendChild(buildSelectField('Division', divOpts, get().clockDivision ?? '1/16', (v) => update({ clockDivision: v })));
        typeRow.appendChild(buildNumberField('Pulse %', (get().clockPulsePct ?? 0.5) * 100, 1, 99, 1, (v) => update({ clockPulsePct: v / 100 })));
        typeRow.appendChild(buildNumberField('Amp (V)', get().clockAmpV ?? 5, 0, 10, 0.1, (v) => update({ clockAmpV: v })));
        break;
      }
      case 'pitch': {
        typeRow.appendChild(buildNumberField('Ref note', get().pitchReferenceNote ?? 60, 0, 127, 1, (v) => update({ pitchReferenceNote: v })));
        typeRow.appendChild(buildNumberField('Ref V', get().pitchReferenceVoltage ?? 0, -10, 10, 0.01, (v) => update({ pitchReferenceVoltage: v })));
        typeRow.appendChild(buildNumberField('V/oct', get().pitchVoltsPerOctave ?? 1, 0.5, 2, 0.001, (v) => update({ pitchVoltsPerOctave: v })));
        typeRow.appendChild(buildNumberField('Glide (ms)', get().pitchGlideMs ?? 0, 0, 5000, 1, (v) => update({ pitchGlideMs: v })));

        const quantizeWrap = document.createElement('label');
        quantizeWrap.className = 'rw-cv-field rw-cv-toggle';
        const qInput = document.createElement('input');
        qInput.type = 'checkbox';
        qInput.checked = get().pitchQuantize ?? true;
        qInput.addEventListener('change', () => update({ pitchQuantize: qInput.checked }));
        quantizeWrap.appendChild(qInput);
        const qSpan = document.createElement('span'); qSpan.textContent = 'Quantize'; quantizeWrap.appendChild(qSpan);
        typeRow.appendChild(quantizeWrap);

        typeRow.appendChild(buildSelectField('Scale', SCALE_OPTIONS, get().pitchScale ?? 'chromatic', (v) => update({ pitchScale: v })));
        typeRow.appendChild(buildSelectField(
          'Root',
          ROOT_NOTES.map((n, i) => ({ v: String(i), l: n })),
          String(get().pitchScaleRoot ?? 0),
          (v) => update({ pitchScaleRoot: Number.parseInt(v, 10) | 0 }),
        ));

        // Calibration: low / high reference notes + scaling trim.
        const calBtn = document.createElement('button');
        calBtn.className = 'rw-btn small';
        calBtn.type = 'button';
        calBtn.textContent = 'Calibrate Pitch';
        calBtn.title = 'Open the pitch calibration helper (low / high reference notes + scaling trim).';
        calBtn.addEventListener('click', () => openPitchCalibration({ settings, cvOut, index }));
        typeRow.appendChild(calBtn);
        break;
      }
    }
  }
  rebuildTypeRow();

  // -------------------- live readout polling --------------------
  let stopped = false;
  let lastT = 0;
  function poll(now: number): void {
    if (stopped) return;
    if (now - lastT > 100) {
      lastT = now;
      const cfg = get();
      // Re-derive the displayed voltage from the most recent test or
      // configured source. We don't query the worklet directly because
      // postMessage is async; this preview matches what the worklet
      // sees (test override > graph drive > classic drive > config).
      let vtxt = '—V';
      if (cfg.enabled && settings.get('cvOutputEnabled')) {
        // Voltage estimation: for CV/gate/trigger we don't have access
        // to the source value here without coupling, so we just show
        // the channel's last computed voltage if cached. For now we
        // present "live" only for pitch (deterministic from MIDI note)
        // and for static sources (constant).
        if (cfg.type === 'pitch') {
          // Use the last-published MIDI note guess.
          const v = pitchVoltageForNote(
            cfg.pitchReferenceNote ?? 60,
            cfg.pitchReferenceNote ?? 60,
            cfg.pitchReferenceVoltage ?? 0,
            cfg.pitchVoltsPerOctave ?? 1,
            cfg.pitchCalibrationScale ?? 1,
          );
          vtxt = `${v.toFixed(2)}V`;
        } else if (cfg.sourceKind === 'constant') {
          vtxt = `${(cfg.sourceConstant ?? 0).toFixed(2)}V`;
        } else {
          vtxt = 'live';
        }
      }
      live.textContent = vtxt;
    }
    requestAnimationFrame(poll);
  }
  requestAnimationFrame(poll);

  return {
    row,
    dispose: () => { stopped = true; },
  };
}

// =====================================================================
// Source controls
// =====================================================================

function buildSourceControls(args: {
  settings: SettingsStore;
  get: () => CVOutputChannel;
  update: (patch: Partial<CVOutputChannel>) => void;
}): HTMLElement {
  const { settings, get, update } = args;
  const wrap = document.createElement('div');
  wrap.className = 'rw-cv-source';

  // Source kind picker.
  const kindOptions: { v: CVOutputChannel['sourceKind']; l: string }[] = [
    { v: 'constant',        l: 'Constant value' },
    { v: 'classic-slot',    l: 'Classic slot' },
    { v: 'graph-node',      l: 'Graph node' },
    { v: 'settings-param',  l: 'Settings param' },
    { v: 'pattern-output',  l: 'Pattern output' },
    { v: 'midi-note',       l: 'MIDI note' },
    { v: 'auto',            l: 'Auto (clock=BPM)' },
  ];
  const kindSel = buildSelectField('Source', kindOptions, get().sourceKind, (v) => update({ sourceKind: v }));
  wrap.appendChild(kindSel);

  // Per-kind extras. Re-rendered when kind changes.
  const extras = document.createElement('div');
  extras.className = 'rw-cv-source-extras';
  wrap.appendChild(extras);

  function rebuildExtras(): void {
    extras.replaceChildren();
    const cfg = get();
    switch (cfg.sourceKind) {
      case 'constant':
        extras.appendChild(buildNumberField('Value', cfg.sourceConstant ?? 0, -10, 10, 0.01, (v) => update({ sourceConstant: v })));
        break;
      case 'classic-slot':
        extras.appendChild(buildNumberField('Slot #', (cfg.sourceSlotIndex ?? 0) + 1, 1, 16, 1, (v) => update({ sourceSlotIndex: Math.max(0, (v | 0) - 1) })));
        // Note: Classic-slot routing actually requires the slot's `target`
        // to point at `cv:<channelIndex>` — show a hint.
        const hint = document.createElement('div');
        hint.className = 'rw-hint small';
        hint.textContent = `↑ also requires the slot's Target to be set to "CV Out: Ch ${cfg.channelIndex + 1}".`;
        extras.appendChild(hint);
        break;
      case 'graph-node': {
        const idInput = document.createElement('input');
        idInput.type = 'text';
        idInput.className = 'rw-text';
        idInput.placeholder = 'Node id';
        idInput.value = cfg.sourceNodeId ?? '';
        idInput.addEventListener('change', () => update({ sourceNodeId: idInput.value }));
        const lbl = document.createElement('label');
        lbl.className = 'rw-cv-field';
        const span = document.createElement('span'); span.textContent = 'Node id'; lbl.appendChild(span);
        lbl.appendChild(idInput);
        extras.appendChild(lbl);
        const portInput = document.createElement('input');
        portInput.type = 'text';
        portInput.className = 'rw-text';
        portInput.placeholder = 'out';
        portInput.value = cfg.sourceNodePort ?? 'out';
        portInput.addEventListener('change', () => update({ sourceNodePort: portInput.value || 'out' }));
        const lbl2 = document.createElement('label');
        lbl2.className = 'rw-cv-field';
        const span2 = document.createElement('span'); span2.textContent = 'Port'; lbl2.appendChild(span2);
        lbl2.appendChild(portInput);
        extras.appendChild(lbl2);
        const hint2 = document.createElement('div');
        hint2.className = 'rw-hint small';
        hint2.textContent = `Or place a "CV Output" node in the graph and set channel = ${cfg.channelIndex} for cleaner wiring.`;
        extras.appendChild(hint2);
        break;
      }
      case 'settings-param': {
        const opts = TARGETS.map((t) => ({ v: t.v as string, l: t.l }));
        extras.appendChild(buildSelectField('Param', opts, cfg.sourceParam ?? '', (v) => update({ sourceParam: v })));
        break;
      }
      case 'pattern-output': {
        const entries = listPatternOutputs();
        if (entries.length === 0) {
          const hint = document.createElement('div');
          hint.className = 'rw-hint small';
          hint.textContent = 'No pattern outputs available.';
          extras.appendChild(hint);
          break;
        }
        const opts = entries.map((e) => ({
          v: e.busId,
          l: `${e.patternLabel}: ${e.signal.label}`,
        }));
        const cur = cfg.sourcePatternOutputId ?? opts[0].v;
        extras.appendChild(buildSelectField(
          'Signal', opts, cur,
          (v) => update({ sourcePatternOutputId: v }),
        ));
        const hint = document.createElement('div');
        hint.className = 'rw-hint small';
        hint.textContent = 'The Pattern Generator must be enabled (Source panel) for the signal to be live.';
        extras.appendChild(hint);
        break;
      }
      case 'midi-note': {
        const hint = document.createElement('div');
        hint.className = 'rw-hint small';
        hint.textContent = 'Pitch type uses this directly. For non-pitch types, the raw MIDI note number is the source value.';
        extras.appendChild(hint);
        break;
      }
      case 'auto': {
        const hint = document.createElement('div');
        hint.className = 'rw-hint small';
        hint.textContent = 'For Clock type, follows internal BPM. For other types, source is silent until repointed.';
        extras.appendChild(hint);
        break;
      }
    }
  }
  rebuildExtras();
  // Rebuild extras when source kind or channelIndex changes (changes the hint text).
  settings.subscribe('cvOutputChannels', rebuildExtras);

  // For visualizing what slots could drive this channel: when sourceKind
  // is 'classic-slot' show which slots have target=cv:<our channel>.
  // (Cheap read; re-evaluated on every cvOutputChannels / modSlots change.)
  void (settings.get('modSlots') as ModSlot[]);

  return wrap;
}

// =====================================================================
// Pitch calibration helper
// =====================================================================

function openPitchCalibration(args: { settings: SettingsStore; cvOut: CVOutput; index: number }): void {
  const { settings, index } = args;
  const get = (): CVOutputChannel => settings.get('cvOutputChannels')[index];
  const update = (patch: Partial<CVOutputChannel>): void => {
    const cur = settings.get('cvOutputChannels').slice();
    cur[index] = { ...cur[index], ...patch };
    settings.set('cvOutputChannels', cur);
  };

  // Modal-ish panel. Inserted after the row; user dismisses via Close.
  const overlay = document.createElement('div');
  overlay.className = 'rw-cv-cal-overlay';
  const panel = document.createElement('div');
  panel.className = 'rw-cv-cal';
  overlay.appendChild(panel);

  const h = document.createElement('div');
  h.className = 'rw-cv-cal-h';
  h.textContent = `Calibrate Pitch — Ch ${get().channelIndex + 1}`;
  panel.appendChild(h);

  const desc = document.createElement('div');
  desc.className = 'rw-hint';
  desc.innerHTML =
    'Patch this channel into your external oscillator\'s 1V/oct pitch input. ' +
    'Click <b>Play C2</b>, tune the oscillator to C2 by ear or with a tuner. ' +
    'Then click <b>Play C6</b> and adjust the <b>Scaling trim</b> until C6 is also in tune. ' +
    'The trim multiplies V/oct (factory: 1.0; ±5% covers nearly all interface drift).';
  panel.appendChild(desc);

  const playRow = document.createElement('div');
  playRow.className = 'rw-row';
  const c2Btn = document.createElement('button');
  c2Btn.className = 'rw-btn'; c2Btn.type = 'button'; c2Btn.textContent = 'Play C2 (note 36)';
  c2Btn.addEventListener('click', () => update({ pitchCalibrationActiveNote: 36 }));
  const c6Btn = document.createElement('button');
  c6Btn.className = 'rw-btn'; c6Btn.type = 'button'; c6Btn.textContent = 'Play C6 (note 84)';
  c6Btn.addEventListener('click', () => update({ pitchCalibrationActiveNote: 84 }));
  const stopBtn = document.createElement('button');
  stopBtn.className = 'rw-btn'; stopBtn.type = 'button'; stopBtn.textContent = 'Stop';
  stopBtn.addEventListener('click', () => update({ pitchCalibrationActiveNote: null }));
  playRow.append(c2Btn, c6Btn, stopBtn);
  panel.appendChild(playRow);

  // Scaling trim slider — multiplier on V/oct.
  const trimRange = document.createElement('input');
  trimRange.type = 'range';
  trimRange.className = 'rw-slider';
  trimRange.min = '0.95'; trimRange.max = '1.05'; trimRange.step = '0.0001';
  trimRange.value = String(get().pitchCalibrationScale ?? 1);
  const trimNum = document.createElement('input');
  trimNum.type = 'number';
  trimNum.min = '0.9'; trimNum.max = '1.1'; trimNum.step = '0.0001';
  trimNum.value = trimRange.value;
  trimNum.className = 'rw-text';
  const sync = (s: number): void => {
    update({ pitchCalibrationScale: s });
    trimRange.value = String(s);
    trimNum.value = String(s);
  };
  trimRange.addEventListener('input', () => sync(Number.parseFloat(trimRange.value)));
  trimNum.addEventListener('change', () => sync(Number.parseFloat(trimNum.value)));
  const trimGroup = document.createElement('div');
  trimGroup.className = 'rw-inline-group';
  trimGroup.append(trimRange, trimNum);
  panel.appendChild(row('Scaling trim', trimGroup));

  // Save / Close.
  const btnRow = document.createElement('div');
  btnRow.className = 'rw-row';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'rw-btn primary';
  closeBtn.type = 'button';
  closeBtn.textContent = 'Done';
  closeBtn.addEventListener('click', () => {
    update({ pitchCalibrationActiveNote: null });
    overlay.remove();
  });
  btnRow.appendChild(closeBtn);
  panel.appendChild(btnRow);

  document.body.appendChild(overlay);
}

// =====================================================================
// Tiny widgets
// =====================================================================

function buildSelect<T extends string>(
  options: { v: T; l: string }[],
  current: T,
  onChange: (v: T) => void,
): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = 'rw-select rw-control';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.v; opt.textContent = o.l;
    sel.appendChild(opt);
  }
  sel.value = current;
  sel.addEventListener('change', () => onChange(sel.value as T));
  return sel;
}

function buildSelectField<T extends string>(
  label: string,
  options: { v: T; l: string }[],
  current: T,
  onChange: (v: T) => void,
): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'rw-cv-field';
  const span = document.createElement('span');
  span.textContent = label;
  wrap.appendChild(span);
  wrap.appendChild(buildSelect(options, current, onChange));
  return wrap;
}

function buildNumberField(
  label: string,
  current: number,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void,
): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'rw-cv-field';
  const span = document.createElement('span');
  span.textContent = label;
  wrap.appendChild(span);
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min); input.max = String(max); input.step = String(step);
  input.value = String(current);
  input.className = 'rw-text';
  input.addEventListener('change', () => {
    const v = Number.parseFloat(input.value);
    if (Number.isFinite(v)) onChange(v);
  });
  wrap.appendChild(input);
  return wrap;
}
