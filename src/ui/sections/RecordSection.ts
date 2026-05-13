/**
 * Record section — start/stop, format choice, optional mic, elapsed timer.
 */

import { SettingsStore } from '../../state/Settings';
import { CanvasRecorder } from '../../record/Recorder';
import { row, group, slider, toggle, dropdown, button, readout } from '../widgets';

export function createRecordSection(settings: SettingsStore, recorder: CanvasRecorder): HTMLElement {
  const root = document.createElement('div');

  const cfg = group('Configuration');
  cfg.body.append(
    row('Format', dropdown(settings, 'recordPreferredFormat', [
      { value: 'auto',     label: 'Auto (best available)' },
      { value: 'mp4',      label: 'MP4 / H.264' },
      { value: 'webm-vp9', label: 'WebM / VP9' },
      { value: 'webm-vp8', label: 'WebM / VP8' },
    ])),
    row('FPS',     slider(settings, 'recordFps',         15, 120, 1)),
    row('Bitrate', slider(settings, 'recordBitrateMbps', 1,  40,  0.5)),
    row('Include Mic', toggle(settings, 'recordIncludeMic')),
  );
  root.appendChild(cfg.root);

  const status = readout();
  const startBtn = button('Start Recording', async () => {
    try {
      await recorder.start({
        fps:             settings.get('recordFps'),
        bitsPerSecond:   settings.get('recordBitrateMbps') * 1_000_000,
        includeMic:      settings.get('recordIncludeMic'),
        preferredFormat: settings.get('recordPreferredFormat'),
      });
    } catch (err) {
      status.textContent = `Error: ${(err as Error).message}`;
    }
  }, 'primary');
  const stopBtn = button('Stop & Download', () => recorder.stop(), 'danger');
  stopBtn.setAttribute('disabled', 'true');

  const btns = document.createElement('div');
  btns.className = 'rw-btn-row';
  btns.append(startBtn, stopBtn);
  root.appendChild(btns);
  root.appendChild(status);

  recorder.subscribe((s) => {
    if (s === 'recording') {
      startBtn.setAttribute('disabled', 'true');
      stopBtn.removeAttribute('disabled');
    } else {
      stopBtn.setAttribute('disabled', 'true');
      startBtn.removeAttribute('disabled');
    }
  });

  // Live timer
  function tick() {
    if (recorder.isRecording()) {
      const ms = recorder.elapsedMs();
      const s = ms / 1000;
      const m = Math.floor(s / 60);
      const sec = (s - m * 60).toFixed(1);
      status.innerHTML = `<span class="rw-rec-dot"></span>recording ${m}:${sec.padStart(4, '0')}`;
    }
    requestAnimationFrame(tick);
  }
  tick();

  // List supported codecs at the bottom for transparency
  const supported = CanvasRecorder.availableFormats();
  const list = readout();
  list.style.marginTop = '6px';
  list.textContent = `supported codecs:\n${supported.map((f) => '  • ' + f.mime).join('\n') || '  none'}`;
  root.appendChild(list);

  return root;
}
