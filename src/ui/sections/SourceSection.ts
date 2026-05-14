/**
 * Source section — pick a video source (webcam / screen / file)
 * plus mirror toggles and capture-quality settings.
 */

import { SettingsStore } from '../../state/Settings';
import { VideoSourceManager } from '../../input/sources';
import { row, group, toggle, button, readout } from '../widgets';

const WEBCAM_RESOLUTIONS = [
  { label: 'Auto (native)',   w: 0,    h: 0    },
  { label: 'SD  (480p)',      w: 854,  h: 480  },
  { label: 'HD  (720p)',      w: 1280, h: 720  },
  { label: 'Full HD (1080p)', w: 1920, h: 1080 },
  { label: '4K UHD (2160p)', w: 3840, h: 2160 },
] as const;

export function createSourceSection(settings: SettingsStore, source: VideoSourceManager): HTMLElement {
  const root = document.createElement('div');

  // ---- Capture Settings (resolution + fps for webcam) ----
  const capGrp = group('Capture Settings');

  const resSel = document.createElement('select');
  resSel.className = 'rw-select';
  for (const r of WEBCAM_RESOLUTIONS) {
    const o = document.createElement('option');
    o.value = `${r.w}x${r.h}`;
    o.textContent = r.label;
    resSel.appendChild(o);
  }
  // Sync dropdown to current stored values.
  function syncResDropdown(): void {
    const w = settings.get('requestedWidth');
    const h = settings.get('requestedHeight');
    const match = WEBCAM_RESOLUTIONS.find((r) => r.w === w && r.h === h);
    resSel.value = match ? `${match.w}x${match.h}` : `${w}x${h}`;
  }
  syncResDropdown();
  resSel.addEventListener('change', () => {
    const [w, h] = resSel.value.split('x').map(Number);
    settings.set('requestedWidth',  w);
    settings.set('requestedHeight', h);
  });

  const fpsInp = document.createElement('input');
  fpsInp.type = 'number'; fpsInp.min = '1'; fpsInp.max = '120'; fpsInp.step = '1';
  fpsInp.className = 'rw-text'; fpsInp.style.width = '64px';
  fpsInp.value = String(settings.get('requestedFps'));
  fpsInp.addEventListener('change', () => {
    const v = Math.max(1, Math.min(120, Math.round(+fpsInp.value) || 30));
    fpsInp.value = String(v);
    settings.set('requestedFps', v);
  });

  const capNote = readout();
  capNote.style.color = 'var(--re-text-dim)';
  capNote.textContent = '"Auto" lets the browser pick the camera\'s native resolution. Changes apply on next "Use Webcam".';

  capGrp.body.append(
    row('Resolution', resSel),
    row('FPS',        fpsInp),
    capNote,
  );
  root.appendChild(capGrp.root);

  // ---- Webcam device selector ----
  const wc = group('Webcam');

  const select = document.createElement('select');
  select.className = 'rw-select';
  const refreshBtn = button('Refresh', async () => populateDevices(true));

  async function populateDevices(reuse = false) {
    if (!reuse) await VideoSourceManager.ensurePermission();
    const list = await source.listDevices();
    select.innerHTML = '';
    for (const d of list) {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label;
      select.appendChild(o);
    }
    if (settings.get('deviceId')) select.value = settings.get('deviceId');
  }
  populateDevices().catch(() => {});

  select.addEventListener('change', async () => {
    const id = select.value;
    settings.set('deviceId', id);
    try {
      await source.useWebcam({
        deviceId: id,
        width:  settings.get('requestedWidth'),
        height: settings.get('requestedHeight'),
        fps:    settings.get('requestedFps'),
      });
      settings.set('sourceKind', 'webcam');
    } catch (err) {
      info.textContent = `Webcam error: ${(err as Error).message}`;
    }
  });

  const startWebcam = button('Use Webcam', async () => {
    try {
      await source.useWebcam({
        deviceId: settings.get('deviceId') || undefined,
        width:  settings.get('requestedWidth'),
        height: settings.get('requestedHeight'),
        fps:    settings.get('requestedFps'),
      });
      settings.set('sourceKind', 'webcam');
      await populateDevices(true);
    } catch (err) {
      info.textContent = `Webcam error: ${(err as Error).message}`;
    }
  }, 'primary');

  wc.body.append(
    row('Device', select),
    row('', startWebcam),
    row('', refreshBtn),
  );
  root.appendChild(wc.root);

  // Screen capture
  const sc = group('Screen Capture');
  sc.body.append(
    row('', button('Capture Screen', async () => {
      try {
        await source.useScreen({ fps: settings.get('requestedFps') });
        settings.set('sourceKind', 'screen');
      } catch (err) {
        info.textContent = `Screen error: ${(err as Error).message}`;
      }
    }, 'primary')),
  );
  root.appendChild(sc.root);

  // File
  const fl = group('Video File');
  const fileInp = document.createElement('input');
  fileInp.type = 'file';
  fileInp.accept = 'video/*';
  fileInp.className = 'rw-text';
  fileInp.addEventListener('change', () => {
    const f = fileInp.files?.[0];
    if (!f) return;
    source.useFile(f);
    settings.set('sourceKind', 'file');
  });
  fl.body.append(row('File', fileInp));
  root.appendChild(fl.root);

  // Mirror controls
  const m = group('Mirror');
  m.body.append(
    row('Mirror H', toggle(settings, 'mirrorH')),
    row('Mirror V', toggle(settings, 'mirrorV')),
  );
  root.appendChild(m.root);

  // Stop
  root.appendChild(button('Stop Source', () => {
    source.stop();
    settings.set('sourceKind', 'none');
  }, 'danger'));

  // Status readout
  const info = readout();
  info.style.marginTop = '8px';
  root.appendChild(info);
  source.subscribe((st) => {
    info.textContent =
      `kind:   ${st.kind}\n` +
      `label:  ${st.label || '-'}\n` +
      `size:   ${st.width}×${st.height}`;
  });

  return root;
}
