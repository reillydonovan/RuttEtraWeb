/**
 * Modulation matrix UI — 4 slots, each can be a Ramp, Waveform, Audio band,
 * Beat, MIDI / OSC source, or Joystick generator routed to any DCU/post-fx
 * parameter.
 *
 * Includes the joystick pad and the audio enable button.
 *
 * v2 additions per slot:
 *   - Conditional Band Index field for `audioBand` source.
 *   - Clock Sync toggle + Division dropdown (replaces Frequency when sync is on).
 *   - MIDI Out group (channel + CC) for echoing the slot value to a controller.
 */

import { ClockDivision, ModSlot, ModSource, ModTarget, SettingsStore } from '../../state/Settings';
import { ModMatrix } from '../../modulation/ModMatrix';
import { ALL_DIVISIONS } from '../../midi/MidiClock';
import { row, group, button, readout } from '../widgets';
import { TARGETS } from '../targets';

const SOURCES: { v: ModSource; l: string }[] = [
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
];

const TARGET_OPTS: { v: ModTarget | 'none'; l: string }[] = [
  { v: 'none', l: '— none —' },
  ...TARGETS,
];

export function createModulationSection(settings: SettingsStore, matrix: ModMatrix): HTMLElement {
  const root = document.createElement('div');

  const jsGroup = group('Joystick (XY pad + Z)');
  // Live readouts above the pad.
  const xyzReadout = document.createElement('div');
  xyzReadout.className = 'rw-joystick-readouts';
  const xR = document.createElement('span'); xR.textContent = 'X: 0.00';
  const yR = document.createElement('span'); yR.textContent = 'Y: 0.00';
  const zR = document.createElement('span'); zR.textContent = 'Z: 0.00';
  xyzReadout.append(xR, yR, zR);
  jsGroup.body.appendChild(xyzReadout);

  // Lock-axis selector (compact mode one-handed use; hidden on desktop).
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

  // Layout: pad + vertical Z slider beside it.
  const padWrap = document.createElement('div');
  padWrap.className = 'rw-joystick-wrap';
  const pad = document.createElement('div');
  pad.className = 'rw-joystick';
  const knob = document.createElement('div');
  knob.className = 'knob';
  knob.style.left = '50%'; knob.style.top = '50%';
  pad.appendChild(knob);

  const zSlider = document.createElement('input');
  zSlider.type = 'range';
  zSlider.min = '-1'; zSlider.max = '1'; zSlider.step = '0.01';
  zSlider.value = '0';
  zSlider.className = 'rw-joystick-z';
  zSlider.setAttribute('aria-label', 'Joystick Z axis');
  // CSS rotates -90deg to make it visually vertical.
  padWrap.append(pad, zSlider);
  jsGroup.body.appendChild(padWrap);

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
    zSlider.value = String(jz);
    emit();
  }, { passive: false });
  zSlider.addEventListener('input', () => {
    jz = parseFloat(zSlider.value);
    emit();
  });
  root.appendChild(jsGroup.root);

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

  const slots = settings.get('modSlots');
  for (let i = 0; i < slots.length; i++) {
    root.appendChild(createSlot(settings, matrix, i));
  }

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

  const tgtSel = document.createElement('select');
  tgtSel.className = 'rw-select';
  for (const t of TARGET_OPTS) {
    const o = document.createElement('option');
    o.value = t.v as string;
    o.textContent = t.l;
    tgtSel.appendChild(o);
  }
  tgtSel.value = get().target;
  tgtSel.addEventListener('change', () => update({ target: tgtSel.value as ModTarget | 'none' }));
  g.body.appendChild(row('Target', tgtSel));

  g.body.appendChild(numRow('Amount', () => get().amount, (v) => update({ amount: v }), -2, 2, 0.001));

  // Frequency / Clock-sync toggle.
  const freqRow = numRow('Frequency', () => get().frequency, (v) => update({ frequency: v }), 0.001, 20, 0.001);
  g.body.appendChild(freqRow);

  const syncLabel = document.createElement('label');
  syncLabel.className = 'rw-toggle';
  const syncCb = document.createElement('input'); syncCb.type = 'checkbox';
  const syncSw = document.createElement('span'); syncSw.className = 'rw-toggle-sw';
  const syncTx = document.createElement('span'); syncTx.className = 'rw-toggle-txt'; syncTx.textContent = 'sync to MIDI clock';
  syncLabel.append(syncCb, syncSw, syncTx);
  syncCb.checked = get().clockSync;
  syncCb.addEventListener('change', () => update({ clockSync: syncCb.checked }));
  g.body.appendChild(row('Clock Sync', syncLabel));

  const divSel = document.createElement('select');
  divSel.className = 'rw-select';
  for (const d of ALL_DIVISIONS) {
    const o = document.createElement('option');
    o.value = d; o.textContent = d;
    divSel.appendChild(o);
  }
  divSel.value = get().clockDivision;
  divSel.addEventListener('change', () => update({ clockDivision: divSel.value as ClockDivision }));
  const divisionRow = row('Division', divSel);
  g.body.appendChild(divisionRow);

  const applyClockVisibility = () => {
    const synced = get().clockSync;
    freqRow.style.display    = synced ? 'none' : '';
    divisionRow.style.display = synced ? '' : 'none';
  };
  applyClockVisibility();
  syncCb.addEventListener('change', applyClockVisibility);

  g.body.appendChild(numRow('Phase', () => get().phase, (v) => update({ phase: v }), 0, 1, 0.001));
  g.body.appendChild(numRow('Duty',  () => get().duty,  (v) => update({ duty: v }),  0.05, 0.95, 0.001));
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

  // Conditional band index (only for `audioBand` source).
  const bandRow = numRow('Band Index', () => get().bandIndex, (v) => update({ bandIndex: Math.round(v) }), 0, 127, 1);
  g.body.appendChild(bandRow);
  const applyBandVisibility = () => {
    bandRow.style.display = get().source === 'audioBand' ? '' : 'none';
  };
  applyBandVisibility();
  srcSel.addEventListener('change', applyBandVisibility);

  // MIDI Out group (collapsed by default).
  const moutGroup = group('MIDI Out');
  const moutEn = document.createElement('label');
  moutEn.className = 'rw-toggle';
  const moutCb = document.createElement('input'); moutCb.type = 'checkbox';
  const moutSw = document.createElement('span'); moutSw.className = 'rw-toggle-sw';
  const moutTx = document.createElement('span'); moutTx.className = 'rw-toggle-txt'; moutTx.textContent = 'send CC';
  moutEn.append(moutCb, moutSw, moutTx);
  moutCb.checked = get().midiOutEnabled;
  moutCb.addEventListener('change', () => update({ midiOutEnabled: moutCb.checked }));
  moutGroup.body.appendChild(row('Enable', moutEn));
  moutGroup.body.appendChild(numRow('Channel', () => get().midiOutChannel, (v) => update({ midiOutChannel: Math.round(v) }), 1, 16, 1));
  moutGroup.body.appendChild(numRow('CC',      () => get().midiOutCC,      (v) => update({ midiOutCC:      Math.round(v) }), 0, 127, 1));
  g.body.appendChild(moutGroup.root);

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
