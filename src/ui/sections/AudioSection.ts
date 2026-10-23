/**
 * Audio / FFT section UI.
 *
 * - Input picker (mic / file dropzone / tab capture / off).
 * - File transport with play/pause/loop/scrub when input is 'file'.
 * - FFT params (size, band count, spacing) and band-shape (attack/release,
 *   gain, floor, threshold).
 * - Live band-bar visualizer drawn each frame on a <canvas>.
 * - Spectrum routing controls (enable / amount / stride).
 * - Beat detection controls.
 * - Monitor toggle (default off, with feedback warning).
 */

import { AudioInputKind, BandCount, BandSpacing, FftSize, SettingsStore } from '../../state/Settings';
import { FFTAnalyzer } from '../../audio/FFTAnalyzer';
import { BeatDetector } from '../../audio/BeatDetector';
import { LiveValuesStore } from '../../modulation/LiveValues';
import { row, group, button, slider, dropdown, toggle } from '../widgets';

export function createAudioSection(
  settings: SettingsStore,
  fft: FFTAnalyzer,
  beat: BeatDetector,
  live: LiveValuesStore,
): HTMLElement {
  const root = document.createElement('div');

  // ---- Input picker ----
  const inputGroup = group('Input');

  const inputSel = dropdown<'audioInputKind'>(settings, 'audioInputKind', [
    { value: 'none', label: '— none —' },
    { value: 'mic',  label: 'Microphone' },
    { value: 'file', label: 'Audio file' },
    { value: 'tab',  label: 'Tab / system audio' },
    { value: 'demo', label: 'Demo beat (no mic needed)' },
  ]);
  inputGroup.body.appendChild(row('Source', inputSel));

  // File element + dropzone (rendered conditionally).
  const audioEl = document.createElement('audio');
  audioEl.controls = true;
  audioEl.style.width = '100%';
  audioEl.crossOrigin = 'anonymous';
  audioEl.preload = 'auto';

  const fileInp = document.createElement('input');
  fileInp.type = 'file';
  fileInp.accept = 'audio/*';
  fileInp.className = 'rw-text';

  const fileWrap = document.createElement('div');
  fileWrap.append(fileInp, audioEl);
  fileWrap.style.display = 'none';

  fileInp.addEventListener('change', () => {
    const f = fileInp.files?.[0];
    if (!f) return;
    audioEl.src = URL.createObjectURL(f);
    audioEl.play().catch(() => { /* user must press play */ });
    fft.attachAudioElement(audioEl);
  });

  const loopCheckbox = toggle(settings, 'audioMonitor' as never, 'loop'); // placeholder; loop has its own state below
  // Actually loop toggle is element-local since it's not in Settings.
  const loopWrap = document.createElement('label');
  loopWrap.className = 'rw-toggle';
  const cb = document.createElement('input'); cb.type = 'checkbox';
  const sw = document.createElement('span'); sw.className = 'rw-toggle-sw';
  const tx = document.createElement('span'); tx.className = 'rw-toggle-txt'; tx.textContent = 'loop';
  loopWrap.append(cb, sw, tx);
  cb.addEventListener('change', () => { audioEl.loop = cb.checked; });
  fileWrap.appendChild(loopWrap);
  // (loopCheckbox above is unused — kept the explicit loopWrap for the toggle UX.)
  void loopCheckbox;

  inputGroup.body.appendChild(fileWrap);

  // Status line — shows the live state of the input attempt + any errors so
  // the user isn't confused when, say, the browser silently denies mic
  // permission. Hidden when there's nothing to say.
  const statusLine = document.createElement('div');
  statusLine.className = 'rw-hint';
  statusLine.style.marginTop = '4px';
  statusLine.style.whiteSpace = 'pre-wrap';
  statusLine.style.color = 'var(--re-text-dim)';
  statusLine.textContent = '';
  inputGroup.body.appendChild(statusLine);

  root.appendChild(inputGroup.root);

  const DEMO_NOTE = 'Demo beat playing (drums and bass at the tempo BPM). It is silent: turn on Monitor below to hear it.';

  // Helper to translate the assorted DOMException names from getUserMedia /
  // getDisplayMedia into actionable copy.
  const explainMediaError = (err: unknown, source: 'mic' | 'tab'): string => {
    const name = (err as { name?: string }).name ?? '';
    const message = (err as { message?: string }).message ?? String(err);
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return source === 'mic'
        ? `Microphone blocked by the browser. Click the lock icon in the address bar → Site settings → set Microphone to "Allow", then reload.`
        : `Tab capture blocked. The browser denied screen/tab capture; check the lock icon in the address bar.`;
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return source === 'mic'
        ? `No microphone found. Plug one in and try again.`
        : `No capturable tab/screen found.`;
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return `Audio device is in use by another app. Close other tabs/apps using the ${source}, then retry.`;
    }
    if (name === 'AbortError') {
      return `${source === 'mic' ? 'Microphone' : 'Tab capture'} request was aborted.`;
    }
    if (name === 'OverconstrainedError') {
      return `${source === 'mic' ? 'Microphone' : 'Tab'} doesn't support the requested constraints.`;
    }
    return `${source === 'mic' ? 'Microphone' : 'Tab capture'} failed: ${name || message}`;
  };

  // Wire input source changes.
  //
  // Initialize `lastKind` to the *current* persisted value so the immediate
  // subscribe-fire (Settings.subscribe replays the current value) doesn't
  // silently try to auto-start mic / tab on page load — those require a
  // user gesture in Chrome and would fail before the user has clicked
  // anything. The user's first dropdown change is what activates input.
  let lastKind: AudioInputKind = settings.get('audioInputKind');
  // If the persisted source needs a gesture, reset to 'none' so the dropdown
  // doesn't lie about what's actually running.
  if (lastKind === 'mic' || lastKind === 'tab' || lastKind === 'demo') {
    queueMicrotask(() => settings.set('audioInputKind', 'none'));
  }
  fileWrap.style.display = lastKind === 'file' ? '' : 'none';

  // The demo beat plays at the shared tempo.
  fft.setDemoBpm(settings.get('internalBpm'));
  settings.subscribe('internalBpm', (bpm) => fft.setDemoBpm(bpm));

  settings.subscribe('audioInputKind', async (kind) => {
    if (kind === lastKind) return;
    lastKind = kind;
    fileWrap.style.display = kind === 'file' ? '' : 'none';
    statusLine.textContent = '';
    // Already running (started by Modulation's Enable Mic / Demo beat, or by
    // another panel instance): don't start it a second time.
    if ((kind === 'mic' || kind === 'demo' || kind === 'tab') && fft.currentKind === kind) {
      statusLine.textContent = kind === 'demo' ? DEMO_NOTE : '';
      return;
    }
    try {
      if (kind === 'mic') {
        statusLine.textContent = 'Requesting microphone…';
        await fft.start('mic');
        statusLine.textContent = 'Microphone connected.';
      } else if (kind === 'tab') {
        statusLine.textContent = 'Requesting tab/system audio…';
        await fft.start('tab');
        statusLine.textContent = 'Tab audio connected.';
      } else if (kind === 'demo') {
        await fft.start('demo');
        statusLine.textContent = DEMO_NOTE;
      } else if (kind === 'file') {
        await fft.start('file');
        if (audioEl.src) fft.attachAudioElement(audioEl);
      } else {
        await fft.stop();
      }
    } catch (err) {
      console.warn('audio start failed', err);
      const source = kind === 'tab' ? 'tab' : 'mic';
      statusLine.textContent = explainMediaError(err, source);
      settings.set('audioInputKind', 'none');
    }
  });

  // ---- FFT controls ----
  const fftGroup = group('FFT');
  const sizeSel = dropdown<'audioFftSize'>(settings, 'audioFftSize', [512, 1024, 2048, 4096].map((n) => ({ value: n as FftSize, label: String(n) })));
  fftGroup.body.appendChild(row('FFT size', sizeSel));

  const bandSel = dropdown<'audioBandCount'>(settings, 'audioBandCount', [8, 16, 32, 64, 128].map((n) => ({ value: n as BandCount, label: String(n) })));
  fftGroup.body.appendChild(row('Bands', bandSel));

  const spacingSel = dropdown<'audioBandSpacing'>(settings, 'audioBandSpacing', [
    { value: 'linear', label: 'Linear' },
    { value: 'log',    label: 'Logarithmic' },
    { value: 'mel',    label: 'Mel' },
  ] satisfies { value: BandSpacing; label: string }[]);
  fftGroup.body.appendChild(row('Spacing', spacingSel));

  fftGroup.body.appendChild(row('Attack',  slider(settings, 'audioAttackMs',  1, 500, 1)));
  fftGroup.body.appendChild(row('Release', slider(settings, 'audioReleaseMs', 1, 2000, 1)));
  fftGroup.body.appendChild(row('Gain',    slider(settings, 'audioGain',  0.1, 4, 0.01)));
  fftGroup.body.appendChild(row('Floor',   slider(settings, 'audioFloor', 0,  0.5, 0.001)));
  fftGroup.body.appendChild(row('Threshold (dB)', slider(settings, 'audioThresholdDb', -120, -20, 1)));
  root.appendChild(fftGroup.root);

  // Wire FFT settings -> analyzer
  settings.subscribe('audioFftSize',     (n) => fft.setFftSize(n));
  settings.subscribe('audioBandCount',   (n) => fft.setBandCount(n));
  settings.subscribe('audioBandSpacing', (m) => fft.setSpacing(m));
  // gain/floor are modulatable: pull from `live` so an LFO/Mod patch on
  // audioGain actually changes the band shaper (otherwise the shaper
  // would silently use the unmodulated base value).
  const reapplyShape = () => fft.setBandShape({
    attackMs:    settings.get('audioAttackMs'),
    releaseMs:   settings.get('audioReleaseMs'),
    gain:        live.getLive('audioGain'),
    floor:       live.getLive('audioFloor'),
    thresholdDb: settings.get('audioThresholdDb'),
  });
  settings.subscribe('audioAttackMs',    reapplyShape);
  settings.subscribe('audioReleaseMs',   reapplyShape);
  live.subscribe('audioGain',            reapplyShape);
  live.subscribe('audioFloor',           reapplyShape);
  settings.subscribe('audioThresholdDb', reapplyShape);

  // ---- Visualizer ----
  const visGroup = group('Bands');
  const canvas = document.createElement('canvas');
  canvas.className = 'rw-vis';
  canvas.width = 320; canvas.height = 64;
  visGroup.body.appendChild(canvas);
  root.appendChild(visGroup.root);

  startVisualizer(canvas, fft);

  // ---- Spectrum routing ----
  const specGroup = group('Spectrum -> Z displacement');
  const specOn = document.createElement('label');
  specOn.className = 'rw-toggle';
  const specCb = document.createElement('input');
  specCb.type = 'checkbox';
  const specSw = document.createElement('span'); specSw.className = 'rw-toggle-sw';
  const specTx = document.createElement('span'); specTx.className = 'rw-toggle-txt'; specTx.textContent = 'enabled';
  specOn.append(specCb, specSw, specTx);
  specCb.addEventListener('change', () => {
    const cur = settings.get('audioSpectrum');
    settings.set('audioSpectrum', { ...cur, enabled: specCb.checked });
  });
  settings.subscribe('audioSpectrum', (v) => { specCb.checked = v.enabled; });
  specGroup.body.appendChild(row('Enable', specOn));

  specGroup.body.appendChild(row('Amount', slider(settings, 'spectrumAmount', 0, 2, 0.01)));
  specGroup.body.appendChild(row('Stride', slider(settings, 'spectrumStride', 0.1, 4, 0.01)));

  // Mirror spectrumAmount/spectrumStride into audioSpectrum so the renderer
  // (which subscribes to audioSpectrum) sees BASE changes from sliders too.
  // We mirror the BASE value here, not the live value — `audioSpectrum`
  // is a config object the user owns, and the renderer already
  // re-overlays modulation via its `live.subscribe('spectrumAmount', ...)`.
  settings.subscribe('spectrumAmount', (v) => {
    const cur = settings.get('audioSpectrum');
    if (cur.amount !== v) settings.set('audioSpectrum', { ...cur, amount: v });
  });
  settings.subscribe('spectrumStride', (v) => {
    const cur = settings.get('audioSpectrum');
    if (cur.stride !== v) settings.set('audioSpectrum', { ...cur, stride: v });
  });

  const desc = document.createElement('div');
  desc.className = 'rw-hint';
  desc.textContent = 'Routes per-band FFT into per-row Z displacement.';
  specGroup.body.appendChild(desc);
  root.appendChild(specGroup.root);

  // ---- Beat detector ----
  const beatGroup = group('Beat detector');
  const beatRow = row('Enable', toggle(settings, 'beatEnabled', 'beat'));
  beatGroup.body.appendChild(beatRow);
  beatGroup.body.appendChild(row('Sensitivity', slider(settings, 'beatSensitivity', 0.5, 4, 0.05)));

  const beatDot = document.createElement('span');
  beatDot.className = 'rw-status-dot';
  const beatStatus = document.createElement('div');
  beatStatus.className = 'rw-status';
  const beatLabel = document.createElement('span');
  beatLabel.textContent = 'pulse';
  beatStatus.append(beatDot, beatLabel);
  beatGroup.body.appendChild(beatStatus);

  setInterval(() => beatDot.classList.toggle('on', beat.pulse > 0.3), 30);
  settings.subscribe('beatEnabled',     (v) => beat.setEnabled(v));
  // beatSensitivity is modulatable.
  live.subscribe('beatSensitivity', (v) => beat.setSensitivity(v));

  root.appendChild(beatGroup.root);

  // ---- Monitor ----
  const monGroup = group('Monitor');
  const monLabel = toggle(settings, 'audioMonitor', 'route to speakers');
  monGroup.body.appendChild(monLabel);
  const warn = document.createElement('div');
  warn.className = 'rw-hint';
  warn.textContent = 'Off by default. Turning this on with mic input may cause feedback.';
  monGroup.body.appendChild(warn);
  settings.subscribe('audioMonitor', (on) => fft.setMonitor(on));
  root.appendChild(monGroup.root);

  // Restart audio if FFT params changed and analyzer was running.
  return root;
}

// ----------------------------------------------------------------------
// Visualizer
// ----------------------------------------------------------------------
function startVisualizer(canvas: HTMLCanvasElement, fft: FFTAnalyzer): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let raf = 0;
  const draw = () => {
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, w, h);

    const bands = fft.bands;
    const N = bands.length;
    if (N > 0) {
      const bw = w / N;
      for (let i = 0; i < N; i++) {
        const v = bands[i];
        const bh = Math.max(1, v * h);
        const hue = 130 - (i / N) * 60;
        ctx.fillStyle = `hsl(${hue} 100% ${30 + v * 30}%)`;
        ctx.fillRect(i * bw, h - bh, Math.max(1, bw - 1), bh);
      }
    }
    raf = requestAnimationFrame(draw);
  };
  draw();

  // Stop drawing when canvas is detached (rough cleanup if section is removed).
  const obs = new MutationObserver(() => {
    if (!canvas.isConnected) {
      cancelAnimationFrame(raf);
      obs.disconnect();
    }
  });
  if (canvas.parentNode) obs.observe(canvas.parentNode, { childList: true });
}
