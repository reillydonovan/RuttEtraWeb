/**
 * I/O panel section for external voltage control (CV) input.
 *
 * Lives in the I/O tab alongside MIDI / Audio / OSC. Covers all four
 * voltage-control routes from the v9 spec:
 *
 *   - Route A — DC-coupled audio interface (`CVInput`)
 *   - Route B — CV-to-MIDI converters: surfaced here as a hint pointing
 *               the user at MIDI Learn; no dedicated UI needed
 *   - Route C — OSC bridge (`/cv/<n>`): per-channel address mappings
 *               written to `Settings.cvBridgeChannels`
 *   - Route D — Gamepad / HID: device picker + live axis/button readout
 *
 * Per-channel rows include:
 *   - 1-Hz live voltage label + bar (`+2.34V`, `-1.20V`, or `—V` for
 *     "no signal yet")
 *   - Range / polarity / smoothing dropdowns
 *   - Calibrate button (capture current sample as zero)
 *
 * The polled live readouts come from a single `requestAnimationFrame`
 * loop scoped to the section's lifetime; the loop disposes when the
 * panel is unmounted (best-effort; the IDs go stale if the user
 * never reopens the panel, which is fine).
 */

import {
  CVChannel, CVRange, CVPolarity, CVControlRate,
  CVBridgeChannel, DEFAULT_CV_CHANNEL, DEFAULT_CV_BRIDGE_CHANNEL,
  SettingsStore,
} from '../../state/Settings';
import { CVInput } from '../../audio/CVInput';
import { GamepadInput } from '../../input/GamepadInput';
import { OscClient } from '../../osc/OscClient';
import { group } from '../widgets';

interface CVSectionDeps {
  settings: SettingsStore;
  cv: CVInput;
  gamepad: GamepadInput;
  osc: OscClient;
}

export function createCVSection(deps: CVSectionDeps): HTMLElement {
  const { settings, cv, gamepad, osc } = deps;
  const root = document.createElement('div');

  // ===================================================================
  // Route A — DC-coupled audio interface
  // ===================================================================
  const audioGroup = group('CV Inputs (audio interface)');
  root.appendChild(audioGroup.root);

  // Device picker. We list audio inputs from `enumerateDevices()`. A
  // first getUserMedia({audio:true}) is required before labels become
  // populated in most browsers; if the user hasn't granted permission
  // yet, the picker still works but shows generic labels.
  const deviceRow = document.createElement('div');
  deviceRow.className = 'rw-row';
  const deviceLabel = document.createElement('label');
  deviceLabel.className = 'rw-label';
  deviceLabel.textContent = 'Interface';
  const deviceSel = document.createElement('select');
  deviceSel.className = 'rw-select rw-control';
  deviceRow.append(deviceLabel, deviceSel);
  audioGroup.body.appendChild(deviceRow);

  const channelCountRow = document.createElement('div');
  channelCountRow.className = 'rw-row';
  const ccLabel = document.createElement('label');
  ccLabel.className = 'rw-label';
  ccLabel.textContent = 'Request channels';
  const ccInput = document.createElement('input');
  ccInput.type = 'number';
  ccInput.min = '1';
  ccInput.max = '32';
  ccInput.className = 'rw-text rw-control';
  ccInput.value = String(settings.get('cvRequestedChannels'));
  ccInput.addEventListener('change', () => {
    const n = Math.max(1, Math.min(32, parseInt(ccInput.value, 10) || 8));
    settings.set('cvRequestedChannels', n);
  });
  channelCountRow.append(ccLabel, ccInput);
  audioGroup.body.appendChild(channelCountRow);

  const startRow = document.createElement('div');
  startRow.className = 'rw-row';
  const startBtn = document.createElement('button');
  startBtn.className = 'rw-btn';
  startBtn.type = 'button';
  startBtn.textContent = 'Start CV input';
  startRow.appendChild(startBtn);
  audioGroup.body.appendChild(startRow);

  const status = document.createElement('div');
  status.className = 'rw-hint rw-cv-status';
  audioGroup.body.appendChild(status);

  // Channel list (per-channel rows) — built/destroyed when the CV
  // reader's status changes (channelCount updates after `start()`).
  const channelsHost = document.createElement('div');
  channelsHost.className = 'rw-cv-channels';
  audioGroup.body.appendChild(channelsHost);

  // -------------------- device list refresh --------------------
  const refreshDevices = async (): Promise<void> => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      deviceSel.disabled = true;
      return;
    }
    let devices: MediaDeviceInfo[] = [];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch { /* noop — keep empty list */ }
    const inputs = devices.filter((d) => d.kind === 'audioinput');
    const cur = settings.get('cvDeviceId');
    deviceSel.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = inputs.length === 0
      ? 'No audio inputs detected (grant permission first)'
      : '— select an interface —';
    deviceSel.appendChild(placeholder);
    for (const d of inputs) {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Audio input (${d.deviceId.slice(0, 6)})`;
      deviceSel.appendChild(opt);
    }
    deviceSel.value = cur;
  };
  deviceSel.addEventListener('change', () => {
    settings.set('cvDeviceId', deviceSel.value);
  });
  void refreshDevices();
  if (typeof navigator !== 'undefined' && 'mediaDevices' in navigator) {
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
  }

  // -------------------- start / stop --------------------
  startBtn.addEventListener('click', async () => {
    if (cv.running) {
      await cv.stop();
      settings.set('cvEnabled', false);
      return;
    }
    const deviceId = settings.get('cvDeviceId');
    if (!deviceId) {
      status.textContent = 'Pick an audio interface first.';
      return;
    }
    const channelCount = settings.get('cvRequestedChannels');
    try {
      await cv.start({ deviceId, channelCount });
      settings.set('cvEnabled', true);
      // Once we know the actual channel count, ensure Settings.cvChannels
      // has at least that many entries (with sensible defaults).
      const cur = settings.get('cvChannels').slice();
      while (cur.length < cv.channelCount) cur.push({ ...DEFAULT_CV_CHANNEL });
      settings.set('cvChannels', cur);
      // Refresh device labels (now that permission was granted).
      void refreshDevices();
    } catch (err) {
      status.textContent = `Start failed: ${(err as Error).message}`;
    }
  });

  // -------------------- channel rows --------------------
  let channelRowDisposers: Array<() => void> = [];
  const rebuildChannels = (): void => {
    for (const d of channelRowDisposers) d();
    channelRowDisposers = [];
    channelsHost.innerHTML = '';

    if (!cv.running) {
      const empty = document.createElement('div');
      empty.className = 'rw-hint';
      empty.textContent = 'Start the CV reader to see per-channel rows.';
      channelsHost.appendChild(empty);
      return;
    }

    for (let i = 0; i < cv.channelCount; i++) {
      const row = buildChannelRow(settings, cv, i);
      channelsHost.appendChild(row.el);
      channelRowDisposers.push(row.dispose);
    }
  };

  cv.subscribe((s) => {
    if (s.running) {
      const truncatedNote = s.truncated
        ? ` · ${s.requested}-ch requested, browser exposed ${s.channelCount}. Try Chrome/Edge for full multi-channel CV.`
        : '';
      status.innerHTML = '';
      status.append(
        textNode(`Running: ${s.deviceLabel || 'unnamed interface'} · ${s.channelCount} channels${truncatedNote}`),
      );
      startBtn.textContent = 'Stop CV input';
      startBtn.classList.add('primary');
    } else {
      const errorNote = s.error ? ` · ${s.error}` : '';
      status.textContent = `Idle${errorNote}`;
      startBtn.textContent = 'Start CV input';
      startBtn.classList.remove('primary');
    }
    rebuildChannels();
  });

  // ===================================================================
  // Route C — OSC bridge channels
  // ===================================================================
  const oscGroup = group('CV Inputs (OSC bridge)');
  root.appendChild(oscGroup.root);

  const oscHint = document.createElement('div');
  oscHint.className = 'rw-hint';
  oscHint.textContent = 'For ADC bridges (Norns, Bela, RPi). The bridge emits messages like /cv/1 0.234 over the existing OSC connection. See tools/cv-bridge/ for a reference Python script.';
  oscGroup.body.appendChild(oscHint);

  const oscChannelsHost = document.createElement('div');
  oscChannelsHost.className = 'rw-cv-channels';
  oscGroup.body.appendChild(oscChannelsHost);

  const addOscChannelBtn = document.createElement('button');
  addOscChannelBtn.type = 'button';
  addOscChannelBtn.className = 'rw-btn';
  addOscChannelBtn.textContent = 'Add OSC CV channel';
  addOscChannelBtn.addEventListener('click', () => {
    const arr = settings.get('cvBridgeChannels').slice();
    arr.push({
      ...DEFAULT_CV_BRIDGE_CHANNEL,
      address: `/cv/${arr.length + 1}`,
      enabled: true,
    });
    settings.set('cvBridgeChannels', arr);
  });
  oscGroup.body.appendChild(addOscChannelBtn);

  let oscRowDisposers: Array<() => void> = [];
  const rebuildOscChannels = (): void => {
    for (const d of oscRowDisposers) d();
    oscRowDisposers = [];
    oscChannelsHost.innerHTML = '';
    const channels = settings.get('cvBridgeChannels');
    if (channels.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'rw-hint';
      empty.textContent = 'No OSC CV channels configured.';
      oscChannelsHost.appendChild(empty);
      return;
    }
    for (let i = 0; i < channels.length; i++) {
      const row = buildOscChannelRow(settings, osc, i);
      oscChannelsHost.appendChild(row.el);
      oscRowDisposers.push(row.dispose);
    }
  };
  rebuildOscChannels();
  settings.subscribe('cvBridgeChannels', rebuildOscChannels);

  // ===================================================================
  // Route D — Gamepad / HID
  // ===================================================================
  const gamepadGroup = group('Gamepad / HID');
  root.appendChild(gamepadGroup.root);

  const padRow = document.createElement('div');
  padRow.className = 'rw-row';
  const padLabel = document.createElement('label');
  padLabel.className = 'rw-label';
  padLabel.textContent = 'Gamepad';
  const padSel = document.createElement('select');
  padSel.className = 'rw-select rw-control';
  padRow.append(padLabel, padSel);
  gamepadGroup.body.appendChild(padRow);

  const padStatus = document.createElement('div');
  padStatus.className = 'rw-hint';
  padStatus.textContent = 'No gamepad. Plug one in and press a button.';
  gamepadGroup.body.appendChild(padStatus);

  const padLive = document.createElement('div');
  padLive.className = 'rw-cv-pad-live';
  gamepadGroup.body.appendChild(padLive);

  const refreshPads = (): void => {
    const pads = gamepad.list();
    const cur = settings.get('gamepadIndex');
    padSel.innerHTML = '';
    const none = document.createElement('option');
    none.value = '-1';
    none.textContent = '— none —';
    padSel.appendChild(none);
    for (const p of pads) {
      const opt = document.createElement('option');
      opt.value = String(p.index);
      opt.textContent = `${p.index}: ${p.id}`;
      padSel.appendChild(opt);
    }
    padSel.value = String(cur);
  };
  padSel.addEventListener('change', () => {
    settings.set('gamepadIndex', parseInt(padSel.value, 10));
  });
  refreshPads();
  if (typeof window !== 'undefined') {
    window.addEventListener('gamepadconnected', refreshPads);
    window.addEventListener('gamepaddisconnected', refreshPads);
  }

  // Live readout: display every axis + button, polled per frame.
  let padPollAlive = true;
  const padPoll = (): void => {
    if (!padPollAlive) return;
    const idx = settings.get('gamepadIndex');
    if (idx >= 0) {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const pad = pads[idx];
      if (pad) {
        padStatus.textContent = `Connected: ${pad.id} · ${pad.axes.length} axes / ${pad.buttons.length} buttons`;
        padLive.innerHTML = '';
        const axes = document.createElement('div');
        axes.className = 'rw-cv-pad-axes';
        for (let i = 0; i < pad.axes.length; i++) {
          const v = gamepad.getAxis(i);
          axes.appendChild(buildMiniBar(`Axis ${i}`, v, true));
        }
        padLive.appendChild(axes);
        const btns = document.createElement('div');
        btns.className = 'rw-cv-pad-buttons';
        for (let i = 0; i < pad.buttons.length; i++) {
          const v = gamepad.getButton(i);
          btns.appendChild(buildMiniBar(`Btn ${i}`, v, false));
        }
        padLive.appendChild(btns);
      } else {
        idleStatus(`No gamepad at index ${idx}.`);
      }
    } else {
      idleStatus('No gamepad selected.');
    }
    requestAnimationFrame(padPoll);
  };
  requestAnimationFrame(padPoll);
  // No pad: write only on a change. This poll runs every frame, and rewriting the status text
  // (and clearing the readouts) each frame relaid out the page each frame.
  function idleStatus(text: string): void {
    if (padStatus.textContent !== text) padStatus.textContent = text;
    if (padLive.firstChild) padLive.replaceChildren();
  }

  // ===================================================================
  // Help blurb (Route B + general guidance)
  // ===================================================================
  const helpGroup = group('Other CV routes');
  const helpBody = document.createElement('div');
  helpBody.className = 'rw-hint';
  helpBody.innerHTML =
    '<strong>CV-to-MIDI converters</strong> (Expert Sleepers FH-2, Befaco CV Thing, Endorphin.es Shuttle Control, Bastl 1983) emit MIDI CCs that the existing <em>MIDI</em> panel above already reads. Lower resolution than direct CV input (7-bit or 14-bit MIDI vs 24-bit audio) but works with any standard audio interface — no DC coupling required.' +
    '<br><br>' +
    '<strong>AC-coupled interfaces</strong> filter out slow voltages: a steady CV will drift toward zero over a few seconds. Test by sending a steady voltage and watching a channel readout — if it sags, your interface is AC-coupled. The fix is hardware (use a DC-coupled interface) not software; meanwhile, fall back to a CV-to-MIDI converter.';
  helpGroup.body.appendChild(helpBody);
  root.appendChild(helpGroup.root);

  // We don't currently expose teardown to the rest of the UI; the
  // pollers stop themselves on first error. If the I/O panel is ever
  // removed from the DOM we'd want to set `padPollAlive = false`.
  void padPollAlive;

  return root;
}

// =====================================================================
// Per-audio-channel row
// =====================================================================

const RANGES: { v: CVRange; l: string }[] = [
  { v: '+/-5V',  l: '±5V (Eurorack)' },
  { v: '0-5V',   l: '0–5V (gates)' },
  { v: '+/-10V', l: '±10V (industrial)' },
  { v: '0-10V',  l: '0–10V (Buchla)' },
];
const POLARITIES: { v: CVPolarity; l: string }[] = [
  { v: 'bipolar',  l: 'Bipolar' },
  { v: 'unipolar', l: 'Unipolar' },
];
const RATES: { v: CVControlRate; l: string }[] = [
  { v: 100,   l: '100Hz (slow)' },
  { v: 1000,  l: '1kHz (control)' },
  { v: 48000, l: 'Audio rate' },
];

function buildChannelRow(
  settings: SettingsStore,
  cv: CVInput,
  index: number,
): { el: HTMLElement; dispose: () => void } {
  const root = document.createElement('div');
  root.className = 'rw-cv-channel';

  const head = document.createElement('div');
  head.className = 'rw-cv-channel-head';
  const title = document.createElement('span');
  title.className = 'rw-cv-channel-title';
  const enabledCb = document.createElement('input');
  enabledCb.type = 'checkbox';
  enabledCb.title = 'Enable this channel';
  head.appendChild(enabledCb);
  title.textContent = `Ch ${index + 1}`;
  head.appendChild(title);
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'rw-text rw-cv-channel-label';
  labelInput.placeholder = 'Label (e.g. Pitch CV)';
  head.appendChild(labelInput);
  root.appendChild(head);

  // Live readout row.
  const liveRow = document.createElement('div');
  liveRow.className = 'rw-cv-live-row';
  const liveBarWrap = document.createElement('div');
  liveBarWrap.className = 'rw-cv-bar-wrap';
  const liveBar = document.createElement('div');
  liveBar.className = 'rw-cv-bar';
  liveBarWrap.appendChild(liveBar);
  const liveText = document.createElement('span');
  liveText.className = 'rw-cv-text';
  liveText.textContent = '—V';
  liveRow.append(liveBarWrap, liveText);
  root.appendChild(liveRow);

  // Controls row.
  const ctlRow = document.createElement('div');
  ctlRow.className = 'rw-cv-ctl-row';
  const rangeSel = mkSelect(RANGES);
  const polaritySel = mkSelect(POLARITIES);
  const rateSel = mkSelect(RATES);
  const smoothInput = document.createElement('input');
  smoothInput.type = 'number';
  smoothInput.min = '0';
  smoothInput.max = '500';
  smoothInput.step = '1';
  smoothInput.className = 'rw-text rw-cv-smooth';
  smoothInput.title = 'Smoothing time constant (ms)';
  const calBtn = document.createElement('button');
  calBtn.type = 'button';
  calBtn.className = 'rw-btn';
  calBtn.textContent = 'Calibrate';
  calBtn.title = 'Capture current voltage as zero. Shift+click to clear.';
  ctlRow.append(
    labelWrap('Range', rangeSel),
    labelWrap('Polarity', polaritySel),
    labelWrap('Rate', rateSel),
    labelWrap('Smooth (ms)', smoothInput),
    calBtn,
  );
  root.appendChild(ctlRow);

  // -------------------- wiring --------------------
  const readCfg = (): CVChannel =>
    settings.get('cvChannels')[index] ?? { ...DEFAULT_CV_CHANNEL };
  const writeCfg = (patch: Partial<CVChannel>): void => {
    const arr = settings.get('cvChannels').slice();
    while (arr.length <= index) arr.push({ ...DEFAULT_CV_CHANNEL });
    arr[index] = { ...arr[index], ...patch };
    settings.set('cvChannels', arr);
  };
  const sync = (): void => {
    const c = readCfg();
    enabledCb.checked = c.enabled;
    labelInput.value = c.label;
    rangeSel.value = c.range;
    polaritySel.value = c.polarity;
    rateSel.value = String(c.controlRate);
    smoothInput.value = String(c.smoothMs);
  };
  enabledCb.addEventListener('change', () => writeCfg({ enabled: enabledCb.checked }));
  labelInput.addEventListener('input', () => writeCfg({ label: labelInput.value }));
  rangeSel.addEventListener('change', () => writeCfg({ range: rangeSel.value as CVRange }));
  polaritySel.addEventListener('change', () => writeCfg({ polarity: polaritySel.value as CVPolarity }));
  rateSel.addEventListener('change', () => writeCfg({ controlRate: Number(rateSel.value) as CVControlRate }));
  smoothInput.addEventListener('change', () => {
    const ms = Math.max(0, Math.min(500, parseFloat(smoothInput.value) || 0));
    writeCfg({ smoothMs: ms });
  });
  calBtn.addEventListener('click', (e) => {
    if ((e as MouseEvent).shiftKey) cv.resetCalibration(index);
    else cv.calibrate(index);
    // Mirror the offset into Settings so it persists.
    const offset = cv.getRaw(index);
    const isShift = (e as MouseEvent).shiftKey;
    writeCfg({ offset: isShift ? 0 : offset });
  });

  const unsubSettings = settings.subscribe('cvChannels', sync);
  sync();

  // -------------------- live polling --------------------
  let alive = true;
  const tick = (): void => {
    if (!alive) return;
    const v = cv.getVoltage(index);
    const n = cv.getNormalized(index);
    if (!cv.running) {
      liveText.textContent = '—V';
      liveBar.style.width = '0%';
    } else if (Number.isNaN(v)) {
      liveText.textContent = '—V';
      liveBar.style.width = '0%';
    } else {
      liveText.textContent = `${v >= 0 ? '+' : ''}${v.toFixed(2)}V`;
      const pct = Math.min(100, Math.abs(n) * 50);
      liveBar.style.width = `${pct}%`;
      liveBar.classList.toggle('positive', n >= 0);
      liveBar.classList.toggle('negative', n < 0);
      liveBar.style.marginLeft = n >= 0 ? '50%' : `${50 - pct}%`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  return {
    el: root,
    dispose: () => {
      alive = false;
      unsubSettings();
    },
  };
}

function buildOscChannelRow(
  settings: SettingsStore,
  osc: OscClient,
  index: number,
): { el: HTMLElement; dispose: () => void } {
  const root = document.createElement('div');
  root.className = 'rw-cv-channel';

  const head = document.createElement('div');
  head.className = 'rw-cv-channel-head';
  const enabledCb = document.createElement('input');
  enabledCb.type = 'checkbox';
  head.appendChild(enabledCb);
  const title = document.createElement('span');
  title.className = 'rw-cv-channel-title';
  title.textContent = `OSC ${index + 1}`;
  head.appendChild(title);
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'rw-text rw-cv-channel-label';
  labelInput.placeholder = 'Label';
  head.appendChild(labelInput);
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'rw-btn rw-cv-remove rw-x';
  removeBtn.textContent = '✕';
  head.appendChild(removeBtn);
  root.appendChild(head);

  const ctlRow = document.createElement('div');
  ctlRow.className = 'rw-cv-ctl-row';
  const addressInput = document.createElement('input');
  addressInput.type = 'text';
  addressInput.className = 'rw-text rw-cv-address';
  addressInput.placeholder = '/cv/1';
  const inMinInput = mkNumInput();
  const inMaxInput = mkNumInput();
  const polaritySel = mkSelect(POLARITIES);
  const smoothInput = mkNumInput();
  smoothInput.min = '0';
  smoothInput.max = '500';
  ctlRow.append(
    labelWrap('Address', addressInput),
    labelWrap('In Min', inMinInput),
    labelWrap('In Max', inMaxInput),
    labelWrap('Polarity', polaritySel),
    labelWrap('Smooth (ms)', smoothInput),
  );
  root.appendChild(ctlRow);

  const liveRow = document.createElement('div');
  liveRow.className = 'rw-cv-live-row';
  const liveText = document.createElement('span');
  liveText.className = 'rw-cv-text';
  liveText.textContent = '—';
  liveRow.appendChild(liveText);
  root.appendChild(liveRow);

  const readCfg = (): CVBridgeChannel =>
    settings.get('cvBridgeChannels')[index] ?? { ...DEFAULT_CV_BRIDGE_CHANNEL };
  const writeCfg = (patch: Partial<CVBridgeChannel>): void => {
    const arr = settings.get('cvBridgeChannels').slice();
    arr[index] = { ...arr[index], ...patch };
    settings.set('cvBridgeChannels', arr);
  };
  const sync = (): void => {
    const c = readCfg();
    enabledCb.checked = c.enabled;
    labelInput.value = c.label;
    addressInput.value = c.address;
    inMinInput.value = String(c.inMin);
    inMaxInput.value = String(c.inMax);
    polaritySel.value = c.polarity;
    smoothInput.value = String(c.smoothMs);
  };
  enabledCb.addEventListener('change', () => writeCfg({ enabled: enabledCb.checked }));
  labelInput.addEventListener('input', () => writeCfg({ label: labelInput.value }));
  addressInput.addEventListener('change', () => writeCfg({ address: addressInput.value.trim() || '/cv/1' }));
  inMinInput.addEventListener('change', () => writeCfg({ inMin: parseFloat(inMinInput.value) || 0 }));
  inMaxInput.addEventListener('change', () => writeCfg({ inMax: parseFloat(inMaxInput.value) || 0 }));
  polaritySel.addEventListener('change', () => writeCfg({ polarity: polaritySel.value as CVPolarity }));
  smoothInput.addEventListener('change', () => writeCfg({ smoothMs: parseFloat(smoothInput.value) || 0 }));
  removeBtn.addEventListener('click', () => {
    const arr = settings.get('cvBridgeChannels').slice();
    arr.splice(index, 1);
    settings.set('cvBridgeChannels', arr);
  });
  sync();

  let alive = true;
  const tick = (): void => {
    if (!alive) return;
    const c = readCfg();
    if (!c.address) {
      liveText.textContent = '—';
    } else {
      const raw = osc.getValue(c.address, 0);
      // Bridge sends 0..1 typically; if the user wants raw volts they
      // can read the value here directly.
      liveText.textContent = raw === 0 ? '—' : raw.toFixed(3);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  return { el: root, dispose: () => { alive = false; } };
}

// =====================================================================
// DOM helpers
// =====================================================================

function mkSelect<T extends string | number>(
  opts: { v: T; l: string }[],
): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = 'rw-select rw-cv-select';
  for (const o of opts) {
    const op = document.createElement('option');
    op.value = String(o.v);
    op.textContent = o.l;
    sel.appendChild(op);
  }
  return sel;
}

function mkNumInput(): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'number';
  i.className = 'rw-text rw-cv-num';
  return i;
}

function labelWrap(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'rw-cv-field';
  const lab = document.createElement('span');
  lab.className = 'rw-cv-field-label';
  lab.textContent = label;
  wrap.append(lab, control);
  return wrap;
}

function buildMiniBar(label: string, value: number, bipolar: boolean): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'rw-cv-mini-bar';
  const lab = document.createElement('span');
  lab.className = 'rw-cv-mini-bar-label';
  lab.textContent = label;
  const barWrap = document.createElement('div');
  barWrap.className = 'rw-cv-mini-bar-track';
  const bar = document.createElement('div');
  bar.className = 'rw-cv-mini-bar-fill';
  if (bipolar) {
    const pct = Math.min(100, Math.abs(value) * 50);
    bar.style.width = `${pct}%`;
    bar.classList.toggle('positive', value >= 0);
    bar.classList.toggle('negative', value < 0);
    bar.style.marginLeft = value >= 0 ? '50%' : `${50 - pct}%`;
  } else {
    bar.style.width = `${Math.min(100, value * 100)}%`;
    bar.style.marginLeft = '0';
    bar.classList.add('positive');
  }
  barWrap.appendChild(bar);
  const num = document.createElement('span');
  num.className = 'rw-cv-mini-bar-num';
  num.textContent = value.toFixed(2);
  wrap.append(lab, barWrap, num);
  return wrap;
}

function textNode(s: string): Text {
  return document.createTextNode(s);
}
