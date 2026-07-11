/**
 * I/O panel section for the Sonification voice — the synth's first
 * audible-output feature. Lives below CV Out in the I/O tab.
 *
 * Three layers:
 *   - Master: enable toggle, master volume, autoplay-gate / mic-feedback
 *     status indicators, Test Tone + Mute Briefly buttons.
 *   - Voice: waveform / filter type / pitch range + quantize.
 *   - Mapping: 4 rows (Pitch / Amplitude / Cutoff / Resonance) each
 *     with a "← stat" dropdown and a curve dropdown. One global
 *     Smoothing slider drives all four mappings' time constant.
 *
 * Persistence: every control writes back to `settings.sonification`
 * via a single setter helper so subscribers (the `Sonification`
 * instance and any future preset-aware listeners) get a coherent
 * snapshot per change.
 *
 * Safety:
 *   - The Enable toggle is the natural user-gesture event for the
 *     AudioContext to actually run (browser autoplay rules). Any
 *     other path (URL config, preset import) hits the migration's
 *     "always force enabled=false" rule and the canvas-click
 *     fallback in main.ts.
 *   - When `sonificationStatus.micFeedbackMuted === true`, this
 *     section shows a non-dismissable banner explaining why no
 *     audio is being produced.
 */

import {
  SettingsStore, SonificationConfig, SonificationParam,
  SonificationWaveform, SonificationFilterType, MappingCurve,
  DEFAULT_SONIFICATION,
} from '../../state/Settings';
import {
  Sonification, midiToName,
} from '../../audio/Sonification';
import { MESH_STAT_IDS, MESH_STAT_DOCS } from '../../audio/MeshAnalyzer';
import { group, button, row } from '../widgets';

interface SonificationSectionDeps {
  settings: SettingsStore;
  sonification: Sonification;
}

const WAVEFORM_OPTIONS: { v: SonificationWaveform; l: string }[] = [
  { v: 'sine',     l: 'Sine' },
  { v: 'triangle', l: 'Triangle' },
  { v: 'saw',      l: 'Saw' },
  { v: 'square',   l: 'Square' },
];

const FILTER_OPTIONS: { v: SonificationFilterType; l: string }[] = [
  { v: 'lowpass',  l: 'Lowpass' },
  { v: 'bandpass', l: 'Bandpass' },
  { v: 'highpass', l: 'Highpass' },
  { v: 'notch',    l: 'Notch' },
];

const CURVE_OPTIONS: { v: MappingCurve; l: string; hint: string }[] = [
  { v: 'linear',      l: 'Linear',       hint: 'Straight-through mapping. The default for amplitude / resonance.' },
  { v: 'exponential', l: 'Exponential',  hint: 'Emphasizes the high end. Musical for pitch (perception is logarithmic).' },
  { v: 'logarithmic', l: 'Logarithmic',  hint: 'Emphasizes the low end — small stat changes get amplified at the bottom of the range.' },
  { v: 'sCurve',      l: 'S-Curve',      hint: 'Smoothstep. Flattens both ends, accentuates the middle.' },
];

const PARAM_ROWS: { p: SonificationParam; label: string; hint: string }[] = [
  { p: 'pitch',     label: 'Pitch',     hint: 'Oscillator frequency, mapped across the configured pitch range.' },
  { p: 'amplitude', label: 'Amplitude', hint: 'Voice level. 0 = silent.' },
  { p: 'cutoff',    label: 'Cutoff',    hint: 'Filter cutoff frequency (60 Hz to 16 kHz, exponential).' },
  { p: 'resonance', label: 'Resonance', hint: 'Filter Q. High values ring or self-oscillate (limiter catches runaway).' },
];

/** Pitch range dropdown options: every C and G across MIDI 24..108
 *  (C1..C8). Keeps the picker short — finer pitches are reachable
 *  by typing a custom MIDI number into a paired number input below. */
const PITCH_RANGE_NOTES: { midi: number; label: string }[] = (() => {
  const out: { midi: number; label: string }[] = [];
  for (let m = 24; m <= 108; m += 1) {
    out.push({ midi: m, label: `${midiToName(m)}  (${m})` });
  }
  return out;
})();

export function createSonificationSection(deps: SonificationSectionDeps): HTMLElement {
  const { settings, sonification } = deps;
  const root = document.createElement('div');

  const grp = group('Sonification (audible voice)');
  root.appendChild(grp.root);

  const blurb = document.createElement('div');
  blurb.className = 'rw-hint';
  blurb.innerHTML =
    'A single audio voice driven by statistics computed from the scanline mesh — ' +
    'the visual signal made audible. Bright = louder; high in frame = higher pitch ' +
    '(default mapping). Always starts <b>disabled</b>; click Enable to begin.';
  grp.body.appendChild(blurb);

  // ----------------------------------------------------------------
  // Status indicators (autoplay gate / mic-feedback / error)
  // ----------------------------------------------------------------
  const statusBar = document.createElement('div');
  statusBar.className = 'rw-hint';
  statusBar.style.color = '#f7c66e';
  statusBar.style.display = 'none';
  grp.body.appendChild(statusBar);

  const updateStatusBar = () => {
    const st = sonification.getStatus();
    let msg = '';
    if (st.micFeedbackMuted) {
      msg = '⚠ Sonification auto-muted: the audio envelope follower is using mic input. ' +
            'Disable mic-as-envelope-source (Audio panel) to enable both at once safely.';
    } else if (st.awaitingUserGesture && settings.get('sonification').enabled) {
      msg = '⚠ Click anywhere on the canvas to start audio (browser autoplay policy).';
    } else if (st.lastError) {
      msg = `⚠ Audio error: ${st.lastError}`;
    }
    if (msg) {
      statusBar.textContent = msg;
      statusBar.style.display = '';
    } else {
      statusBar.style.display = 'none';
    }
  };
  sonification.subscribe(updateStatusBar);
  settings.subscribe('sonification', updateStatusBar);

  // ----------------------------------------------------------------
  // Master row: enable toggle, master volume, Test Tone, Mute Briefly
  // ----------------------------------------------------------------
  const masterRow = document.createElement('div');
  masterRow.className = 'rw-row';
  masterRow.style.gap = '8px';

  const enableLabel = document.createElement('label');
  enableLabel.className = 'rw-toggle';
  const enableCb = document.createElement('input');
  enableCb.type = 'checkbox';
  const enableSw = document.createElement('span');
  enableSw.className = 'rw-toggle-sw';
  const enableTxt = document.createElement('span');
  enableTxt.className = 'rw-toggle-txt';
  enableTxt.textContent = 'Enable';
  enableLabel.append(enableCb, enableSw, enableTxt);
  enableCb.addEventListener('change', () => {
    updateConfig({ enabled: enableCb.checked });
    if (enableCb.checked) {
      // Click is itself a user gesture — kick the AudioContext just
      // in case the system was waiting on one.
      void sonification.userGesture();
    }
  });
  masterRow.appendChild(enableLabel);
  grp.body.appendChild(masterRow);

  // Master volume row.
  const volRange = document.createElement('input');
  volRange.type = 'range';
  volRange.min = '-60';
  volRange.max = '0';
  volRange.step = '1';
  volRange.className = 'rw-slider';
  const volReadout = document.createElement('span');
  volReadout.className = 'rw-readout';
  volReadout.style.minWidth = '5em';
  volRange.addEventListener('input', () => {
    const db = parseFloat(volRange.value);
    updateConfig({ masterVolumeDb: db });
    volReadout.textContent = `${db} dB`;
  });
  const volGroup = document.createElement('div');
  volGroup.className = 'rw-inline-group';
  volGroup.append(volRange, volReadout);
  grp.body.appendChild(row('Master Volume', volGroup));

  // Test Tone + Mute Briefly buttons.
  const btnRow = document.createElement('div');
  btnRow.className = 'rw-row';
  btnRow.appendChild(button('Test Tone (440 Hz, 1s)', () => {
    void sonification.testTone();
  }));
  btnRow.appendChild(button('Mute Briefly (2s)', () => {
    sonification.muteBriefly();
  }));
  grp.body.appendChild(btnRow);

  // ----------------------------------------------------------------
  // Voice config: waveform, filter type, pitch range, quantize
  // ----------------------------------------------------------------
  const voiceGrp = group('Voice');
  grp.body.appendChild(voiceGrp.root);

  const waveSel = makeEnumSelect(WAVEFORM_OPTIONS,
    () => settings.get('sonification').waveform,
    (v) => updateConfig({ waveform: v }));
  voiceGrp.body.appendChild(row('Waveform', waveSel));

  const filterSel = makeEnumSelect(FILTER_OPTIONS,
    () => settings.get('sonification').filterType,
    (v) => updateConfig({ filterType: v }));
  voiceGrp.body.appendChild(row('Filter Type', filterSel));

  // Pitch range as two paired dropdowns.
  const lowSel = makePitchSelect(
    () => settings.get('sonification').pitchRangeMidi[0],
    (m) => {
      const cur = settings.get('sonification').pitchRangeMidi;
      const high = Math.max(m + 1, cur[1]);
      updateConfig({ pitchRangeMidi: [m, high] });
    });
  const sep = document.createElement('span');
  sep.textContent = ' to ';
  sep.style.padding = '0 6px';
  const highSel = makePitchSelect(
    () => settings.get('sonification').pitchRangeMidi[1],
    (m) => {
      const cur = settings.get('sonification').pitchRangeMidi;
      const low = Math.min(m - 1, cur[0]);
      updateConfig({ pitchRangeMidi: [low, m] });
    });
  const rangeGroup = document.createElement('div');
  rangeGroup.className = 'rw-inline-group';
  rangeGroup.append(lowSel, sep, highSel);
  voiceGrp.body.appendChild(row('Pitch Range', rangeGroup));

  // Quantize toggle.
  const quantWrap = document.createElement('label');
  quantWrap.className = 'rw-toggle';
  const quantCb = document.createElement('input');
  quantCb.type = 'checkbox';
  const quantSw = document.createElement('span');
  quantSw.className = 'rw-toggle-sw';
  const quantTxt = document.createElement('span');
  quantTxt.className = 'rw-toggle-txt';
  quantTxt.textContent = 'Quantize pitch to semitones';
  quantWrap.append(quantCb, quantSw, quantTxt);
  quantCb.addEventListener('change', () => updateConfig({ quantize: quantCb.checked }));
  voiceGrp.body.appendChild(quantWrap);

  // ----------------------------------------------------------------
  // Mapping: param ← stat + curve, plus smoothing slider
  // ----------------------------------------------------------------
  const mapGrp = group('Mapping');
  grp.body.appendChild(mapGrp.root);

  const mapHint = document.createElement('div');
  mapHint.className = 'rw-hint';
  mapHint.textContent =
    'Each voice parameter is driven by one mesh statistic. Curve shapes the 0..1 stat ' +
    'before scaling to the parameter\'s range — Exponential is musical for pitch.';
  mapGrp.body.appendChild(mapHint);

  // Per-param mapping rows.
  const sourceSels = new Map<SonificationParam, HTMLSelectElement>();
  const curveSels = new Map<SonificationParam, HTMLSelectElement>();
  for (const def of PARAM_ROWS) {
    const srcSel = document.createElement('select');
    srcSel.className = 'rw-select rw-control';
    {
      const noneOpt = document.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = '(unmapped)';
      srcSel.appendChild(noneOpt);
      for (const id of MESH_STAT_IDS) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = MESH_STAT_DOCS[id].label;
        opt.title = MESH_STAT_DOCS[id].description;
        srcSel.appendChild(opt);
      }
    }
    srcSel.addEventListener('change', () => {
      const cfg = settings.get('sonification');
      const mappings = { ...cfg.mappings };
      mappings[def.p] = { ...mappings[def.p], source: srcSel.value as never };
      updateConfig({ mappings });
    });
    sourceSels.set(def.p, srcSel);

    const curveSel = document.createElement('select');
    curveSel.className = 'rw-select rw-control';
    for (const co of CURVE_OPTIONS) {
      const opt = document.createElement('option');
      opt.value = co.v;
      opt.textContent = co.l;
      opt.title = co.hint;
      curveSel.appendChild(opt);
    }
    curveSel.addEventListener('change', () => {
      const cfg = settings.get('sonification');
      const mappings = { ...cfg.mappings };
      mappings[def.p] = { ...mappings[def.p], curve: curveSel.value as MappingCurve };
      updateConfig({ mappings });
    });
    curveSels.set(def.p, curveSel);

    const mapGroup = document.createElement('div');
    mapGroup.className = 'rw-inline-group';
    mapGroup.append(srcSel, curveSel);
    const mapRow = row(def.label, mapGroup);
    mapRow.querySelector('.rw-label')!.setAttribute('title', def.hint);
    mapGrp.body.appendChild(mapRow);
  }

  // Smoothing slider — global 1-pole time constant (ms).
  const smoothRange = document.createElement('input');
  smoothRange.type = 'range';
  smoothRange.min = '0';
  smoothRange.max = '500';
  smoothRange.step = '1';
  smoothRange.className = 'rw-slider';
  const smoothReadout = document.createElement('span');
  smoothReadout.className = 'rw-readout';
  smoothReadout.style.minWidth = '5em';
  smoothRange.addEventListener('input', () => {
    const ms = parseFloat(smoothRange.value);
    updateConfig({ smoothingMs: ms });
    smoothReadout.textContent = `${ms} ms`;
  });
  const smoothGroup = document.createElement('div');
  smoothGroup.className = 'rw-inline-group';
  smoothGroup.append(smoothRange, smoothReadout);
  mapGrp.body.appendChild(row('Smoothing', smoothGroup));

  // Reset-to-defaults helper.
  const resetRow = document.createElement('div');
  resetRow.className = 'rw-row';
  resetRow.appendChild(button('Reset to default mapping', () => {
    updateConfig({
      waveform: DEFAULT_SONIFICATION.waveform,
      filterType: DEFAULT_SONIFICATION.filterType,
      pitchRangeMidi: [...DEFAULT_SONIFICATION.pitchRangeMidi] as [number, number],
      quantize: DEFAULT_SONIFICATION.quantize,
      smoothingMs: DEFAULT_SONIFICATION.smoothingMs,
      mappings: {
        pitch:     { ...DEFAULT_SONIFICATION.mappings.pitch },
        amplitude: { ...DEFAULT_SONIFICATION.mappings.amplitude },
        cutoff:    { ...DEFAULT_SONIFICATION.mappings.cutoff },
        resonance: { ...DEFAULT_SONIFICATION.mappings.resonance },
      },
    });
  }));
  mapGrp.body.appendChild(resetRow);

  // ----------------------------------------------------------------
  // Settings → UI sync
  // ----------------------------------------------------------------
  const sync = (cfg: SonificationConfig) => {
    enableCb.checked = cfg.enabled;
    volRange.value = String(cfg.masterVolumeDb);
    volReadout.textContent = `${cfg.masterVolumeDb} dB`;
    waveSel.value = cfg.waveform;
    filterSel.value = cfg.filterType;
    lowSel.value = String(cfg.pitchRangeMidi[0]);
    highSel.value = String(cfg.pitchRangeMidi[1]);
    quantCb.checked = cfg.quantize;
    smoothRange.value = String(cfg.smoothingMs);
    smoothReadout.textContent = `${cfg.smoothingMs} ms`;
    for (const def of PARAM_ROWS) {
      const m = cfg.mappings[def.p];
      const ss = sourceSels.get(def.p);
      if (ss) ss.value = m.source;
      const cs = curveSels.get(def.p);
      if (cs) cs.value = m.curve;
    }
  };
  settings.subscribe('sonification', sync);
  // Initial sync.
  sync(settings.get('sonification'));
  updateStatusBar();

  return root;

  // -------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------
  function updateConfig(patch: Partial<SonificationConfig>): void {
    const cur = settings.get('sonification');
    settings.set('sonification', { ...cur, ...patch });
  }
}

// --------------------------------------------------------------------
// Local helpers
// --------------------------------------------------------------------

function makeEnumSelect<T extends string>(
  options: { v: T; l: string }[],
  get: () => T,
  set: (v: T) => void,
): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = 'rw-select';
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.v;
    opt.textContent = o.l;
    sel.appendChild(opt);
  }
  sel.value = get();
  sel.addEventListener('change', () => set(sel.value as T));
  return sel;
}

function makePitchSelect(get: () => number, set: (m: number) => void): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = 'rw-select rw-control';
  for (const n of PITCH_RANGE_NOTES) {
    const opt = document.createElement('option');
    opt.value = String(n.midi);
    opt.textContent = n.label;
    sel.appendChild(opt);
  }
  sel.value = String(get());
  sel.addEventListener('change', () => set(parseInt(sel.value, 10)));
  return sel;
}
