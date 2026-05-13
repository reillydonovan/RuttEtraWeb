/**
 * Modulation matrix UI — 4 slots, each can be a Ramp, Waveform, Audio, or
 * Joystick generator routed to any DCU/post-fx parameter.
 *
 * Also includes the joystick pad and the audio-enable toggle.
 */

import { ModSlot, ModSource, ModTarget, SettingsStore, DEFAULT_MOD_SLOT } from '../../state/Settings';
import { ModMatrix } from '../../modulation/ModMatrix';
import { row, group, button, readout } from '../widgets';

const SOURCES: { v: ModSource; l: string }[] = [
  { v: 'sine',      l: 'Sine' },
  { v: 'triangle',  l: 'Triangle' },
  { v: 'square',    l: 'Square' },
  { v: 'saw',       l: 'Saw' },
  { v: 'pulse',     l: 'Pulse (duty)' },
  { v: 'ramp',      l: 'Ramp' },
  { v: 'audio',     l: 'Audio (mic)' },
  { v: 'joystickX', l: 'Joystick X' },
  { v: 'joystickY', l: 'Joystick Y' },
  { v: 'joystickZ', l: 'Joystick Z (scroll)' },
];

const TARGETS: { v: ModTarget | 'none'; l: string }[] = [
  { v: 'none', l: '— none —' },
  { v: 'hPos', l: 'H Position' }, { v: 'vPos', l: 'V Position' },
  { v: 'hSize', l: 'H Size' },   { v: 'vSize', l: 'V Size' },
  { v: 'aspect', l: 'Aspect' },
  { v: 'zPush', l: 'Z Push' },   { v: 'zBias', l: 'Z Bias' },
  { v: 'intensity', l: 'Intensity' }, { v: 'focus', l: 'Focus' },
  { v: 'hCenter', l: 'H Center' }, { v: 'vCenter', l: 'V Center' },
  { v: 'hSpin', l: 'H Spin' },     { v: 'vSpin', l: 'V Spin' },
  { v: 'hLinearity', l: 'H Linearity' }, { v: 'vLinearity', l: 'V Linearity' },
  { v: 'skip', l: 'Skip' },
  { v: 'threshold', l: 'Threshold' }, { v: 'contrast', l: 'Contrast' }, { v: 'gamma', l: 'Gamma' },
  { v: 'bloomIntensity', l: 'Bloom Intensity' }, { v: 'bloomRadius', l: 'Bloom Radius' },
  { v: 'scanlineIntensity', l: 'Scanline Intensity' },
  { v: 'chromaAmount', l: 'Chroma Amount' },
  { v: 'feedbackDecay', l: 'Feedback Decay' },
  { v: 'cameraFov', l: 'Camera FOV' },
];

export function createModulationSection(settings: SettingsStore, matrix: ModMatrix): HTMLElement {
  const root = document.createElement('div');

  // Joystick pad
  const jsGroup = group('Joystick (XY pad + scroll Z)');
  const pad = document.createElement('div');
  pad.className = 'rw-joystick';
  const knob = document.createElement('div');
  knob.className = 'knob';
  knob.style.left = '50%'; knob.style.top = '50%';
  pad.appendChild(knob);
  let jx = 0, jy = 0, jz = 0;
  let dragging = false;
  function setKnob(nx: number, ny: number) {
    knob.style.left = `${(nx * 0.5 + 0.5) * 100}%`;
    knob.style.top  = `${(ny * 0.5 + 0.5) * 100}%`;
  }
  function onMove(e: PointerEvent) {
    if (!dragging) return;
    const r = pad.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width)  * 2 - 1;
    const y = ((e.clientY - r.top)  / r.height) * 2 - 1;
    jx = Math.max(-1, Math.min(1, x));
    jy = Math.max(-1, Math.min(1, -y)); // invert Y so up = positive
    setKnob(jx, -jy);
    matrix.setJoystick(jx, jy, jz);
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
    matrix.setJoystick(jx, jy, jz);
    zReadout.textContent = `Z: ${jz.toFixed(2)}`;
  }, { passive: false });
  jsGroup.body.appendChild(pad);
  const zReadout = readout();
  zReadout.textContent = 'Z: 0.00';
  jsGroup.body.appendChild(zReadout);
  root.appendChild(jsGroup.root);

  // Audio enable
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
  root.appendChild(audioGroup.root);

  // Slots
  const slots = settings.get('modSlots');
  for (let i = 0; i < slots.length; i++) {
    root.appendChild(createSlot(settings, matrix, i));
  }

  // Retrigger ramps
  root.appendChild(button('Retrigger Ramps', () => matrix.retriggerRamps()));

  return root;
}

function createSlot(settings: SettingsStore, matrix: ModMatrix, index: number): HTMLElement {
  const g = group(`Slot ${index + 1}`);

  const get = () => settings.get('modSlots')[index];
  const update = (patch: Partial<ModSlot>) => {
    const next = settings.get('modSlots').slice();
    next[index] = { ...next[index], ...patch };
    settings.set('modSlots', next);
    if (patch.target && patch.target !== 'none') matrix.recaptureBase(patch.target);
  };

  // Enabled
  const en = document.createElement('input');
  en.type = 'checkbox';
  en.checked = get().enabled;
  en.addEventListener('change', () => update({ enabled: en.checked }));
  const enLabel = document.createElement('label');
  enLabel.className = 'rw-toggle';
  const sw = document.createElement('span'); sw.className = 'rw-toggle-sw';
  const tx = document.createElement('span'); tx.className = 'rw-toggle-txt'; tx.textContent = 'enabled';
  enLabel.append(en, sw, tx);
  g.body.appendChild(row('On/Off', enLabel));

  // Source
  const srcSel = document.createElement('select');
  srcSel.className = 'rw-select';
  for (const s of SOURCES) {
    const o = document.createElement('option');
    o.value = s.v; o.textContent = s.l;
    srcSel.appendChild(o);
  }
  srcSel.value = get().source;
  srcSel.addEventListener('change', () => update({ source: srcSel.value as ModSource }));
  g.body.appendChild(row('Source', srcSel));

  // Target
  const tgtSel = document.createElement('select');
  tgtSel.className = 'rw-select';
  for (const t of TARGETS) {
    const o = document.createElement('option');
    o.value = t.v as string;
    o.textContent = t.l;
    tgtSel.appendChild(o);
  }
  tgtSel.value = get().target;
  tgtSel.addEventListener('change', () => update({ target: tgtSel.value as ModTarget | 'none' }));
  g.body.appendChild(row('Target', tgtSel));

  // Numeric controls — small bespoke sliders that read the slot
  g.body.appendChild(numRow('Amount', () => get().amount, (v) => update({ amount: v }), -2, 2, 0.001));
  g.body.appendChild(numRow('Frequency', () => get().frequency, (v) => update({ frequency: v }), 0.001, 20, 0.001));
  g.body.appendChild(numRow('Phase', () => get().phase, (v) => update({ phase: v }), 0, 1, 0.001));
  g.body.appendChild(numRow('Duty', () => get().duty, (v) => update({ duty: v }), 0.05, 0.95, 0.001));
  g.body.appendChild(numRow('Ramp Time', () => get().rampTimeSec, (v) => update({ rampTimeSec: v }), 0.05, 600, 0.05));

  const rampSel = document.createElement('select');
  rampSel.className = 'rw-select';
  for (const m of ['up', 'down', 'triangle', 'hold']) {
    const o = document.createElement('option');
    o.value = m; o.textContent = m;
    rampSel.appendChild(o);
  }
  rampSel.value = get().rampMode;
  rampSel.addEventListener('change', () => update({ rampMode: rampSel.value as ModSlot['rampMode'] }));
  g.body.appendChild(row('Ramp Mode', rampSel));

  return g.root;
}

function numRow(label: string, get: () => number, set: (v: number) => void, min: number, max: number, step: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'rw-slider';
  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(min); range.max = String(max); range.step = String(step);
  range.value = String(get());
  const num = document.createElement('input');
  num.type = 'number';
  num.min = String(min); num.max = String(max); num.step = String(step);
  num.value = String(get());
  num.className = 'rw-num';
  wrap.append(range, num);
  range.addEventListener('input', () => { set(+range.value); num.value = range.value; });
  num.addEventListener('input', () => {
    const v = parseFloat(num.value);
    if (!Number.isNaN(v)) { set(v); range.value = String(v); }
  });
  return row(label, wrap);
}
