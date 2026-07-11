/**
 * Source section — pick a video source (webcam / screen / file / stream URL)
 * plus mirror toggles and capture-quality settings.
 *
 * As of v10 also hosts the Pattern Generator group: a parallel
 * synthesized layer with its own enable toggle, kind / blend / mix
 * controls, and a per-pattern dynamic params host that rebuilds itself
 * each time `patternKind` changes.
 */

import {
  SettingsStore, PatternKind, PatternBlendMode, PatternAxis,
  PatternGradientShape, PatternScopeSourceKind, ModTarget, ModSlot, DEFAULT_MOD_SLOT,
} from '../../state/Settings';
import { VideoSourceManager } from '../../input/sources';
import { row, group, toggle, button, readout, slider, dropdown } from '../widgets';

/**
 * URL of the operator-supplied sample video. Falls back to the conventional
 * path `/samples/sample.mp4` (relative to page origin) if no env variable is
 * set. The `public/samples/` folder is tracked in git (via .gitkeep) but its
 * video contents are .gitignored — deploy the file to your server separately.
 */
const SAMPLE_VIDEO_URL: string =
  (import.meta.env.VITE_SAMPLE_VIDEO_URL as string | undefined)?.trim() ||
  '/samples/sample.mp4';
import {
  PATTERN_REGISTRY, PATTERN_ORDER, PATTERN_CATEGORY_LABEL,
} from '../../renderer/patterns/PatternRegistry';
import type { PatternParamKey } from '../../renderer/patterns/PatternRegistry';

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

  // Filename label — shows the active file's name regardless of which entry
  // point loaded it (panel picker or boot overlay). Hidden when no file active.
  const fileLabel = readout();
  fileLabel.style.color = 'var(--re-text-dim)';
  fileLabel.style.fontSize = '0.82em';
  fileLabel.style.display = 'none';

  // Shared notice shown whenever any video file is loaded in this group.
  const videoNotice = readout();
  videoNotice.style.color = 'var(--re-text-dim)';
  videoNotice.style.fontSize = '0.82em';
  videoNotice.style.display = 'none';

  const VIDEO_COLOR_NOTICE =
    'Color mode set to Video — scanlines now use the source\'s own colors. ' +
    'Adjust in the Color / PostFX panel.';

  function applyVideoColorMode(): void {
    settings.set('colorMode', 'video');
    videoNotice.textContent = VIDEO_COLOR_NOTICE;
    videoNotice.style.display = '';
  }

  fileInp.addEventListener('change', () => {
    const f = fileInp.files?.[0];
    if (!f) return;
    source.useFile(f);
    settings.set('sourceKind', 'file');
    applyVideoColorMode();
  });

  // Reactive to any file source activation (panel picker OR boot overlay).
  source.subscribe((st) => {
    if (st.kind === 'file') {
      fileLabel.textContent = st.label || '';
      fileLabel.style.display = st.label ? '' : 'none';
      videoNotice.textContent = VIDEO_COLOR_NOTICE;
      videoNotice.style.display = '';
    } else {
      fileLabel.style.display = 'none';
    }
  });

  fl.body.append(row('File', fileInp), fileLabel, videoNotice);

  // Sample video — only shown when the operator has deployed a file at the
  // sample URL. HEAD request runs once on section creation; the row stays
  // hidden permanently if the file doesn't exist.
  const sampleRow = document.createElement('div');
  sampleRow.style.display = 'none';
  const sampleErr = readout();
  sampleErr.style.color = 'var(--re-warn)';
  sampleErr.style.fontSize = '0.85em';
  sampleErr.textContent = '';

  const loadSampleBtn = button('Load Sample Video', async () => {
    sampleErr.textContent = '';
    videoNotice.style.display = 'none';
    try {
      await source.useStreamUrl(SAMPLE_VIDEO_URL);
      settings.set('sourceKind', 'stream');
      applyVideoColorMode();
    } catch (err) {
      sampleErr.textContent = (err as Error).message;
    }
  });
  const sampleHint = readout();
  sampleHint.style.color = 'var(--re-text-dim)';
  sampleHint.style.fontSize = '0.82em';
  sampleHint.textContent = SAMPLE_VIDEO_URL;
  sampleRow.append(row('', loadSampleBtn), sampleHint, sampleErr);
  fl.body.append(sampleRow);

  // HEAD check — reveal the sample row only if the file is actually present.
  fetch(SAMPLE_VIDEO_URL, { method: 'HEAD' })
    .then((r) => { if (r.ok) sampleRow.style.display = ''; })
    .catch(() => { /* file absent or CORS — keep row hidden */ });

  root.appendChild(fl.root);

  // Stream URL
  const su = group('Stream URL');
  const urlInp = document.createElement('input');
  urlInp.type = 'url';
  urlInp.className = 'rw-text';
  urlInp.placeholder = 'https://…/stream.m3u8';
  urlInp.value = settings.get('streamUrl');
  urlInp.style.width = '100%';
  urlInp.addEventListener('change', () => settings.set('streamUrl', urlInp.value));

  const streamStatus = readout();
  streamStatus.style.color = 'var(--re-text-dim)';
  streamStatus.style.whiteSpace = 'pre-line';
  streamStatus.style.fontSize = '0.85em';
  streamStatus.textContent = '';

  const useStreamBtn = button('Use Stream', async () => {
    const url = urlInp.value.trim();
    if (!url) {
      streamStatus.style.color = 'var(--re-warn)';
      streamStatus.textContent = 'Enter a URL first.';
      return;
    }
    streamStatus.style.color = 'var(--re-text-dim)';
    streamStatus.textContent = 'Connecting…';
    try {
      await source.useStreamUrl(url);
      settings.set('streamUrl', url);
      settings.set('sourceKind', 'stream');
      streamStatus.style.color = 'var(--re-text-dim)';
      streamStatus.textContent = '';
    } catch (err) {
      streamStatus.style.color = 'var(--re-warn)';
      streamStatus.textContent = (err as Error).message;
    }
  }, 'primary');

  const streamNote = readout();
  streamNote.style.color = 'var(--re-text-dim)';
  streamNote.style.fontSize = '0.82em';
  streamNote.textContent =
    'Formats: HLS (.m3u8), direct MP4/WebM URL.\n' +
    'MPEG-DASH (.mpd) not supported — re-mux to HLS.\n' +
    'The URL is remembered but not auto-reconnected on load.';

  su.body.append(
    row('URL', urlInp),
    row('', useStreamBtn),
    streamStatus,
    streamNote,
  );
  root.appendChild(su.root);

  // ── Video Audio ──────────────────────────────────────────────────────
  // Allows playback of the video file or stream's own audio track through
  // the system speakers. Principle 4: disabled by default — the user must
  // explicitly enable it each session (the migration also force-clears
  // videoAudioEnabled on every page load so no audio starts unexpectedly).
  const va = group('Video Audio');

  const audioSafetyNote = document.createElement('p');
  audioSafetyNote.className = 'section-note';
  audioSafetyNote.textContent =
    'Plays the audio track of the active video file or stream. '
    + 'Disabled on every page load — check your speaker volume before enabling.';

  const audioEnabledToggle = toggle(settings, 'videoAudioEnabled');

  va.body.append(
    audioSafetyNote,
    row('Enable', audioEnabledToggle),
    row('Volume', slider(settings, 'videoAudioVolume', 0, 1, 0.01)),
  );
  root.appendChild(va.root);

  // Mirror controls
  const m = group('Mirror');
  m.body.append(
    row('Mirror H', toggle(settings, 'mirrorH')),
    row('Mirror V', toggle(settings, 'mirrorV')),
  );
  root.appendChild(m.root);

  // Pattern Generator (v10) — synthesized layer parallel to the video
  // source. The Enable toggle is intentionally styled identical to
  // Mirror H / Mirror V above: this is a layer you turn on, not a
  // mode you switch into. All per-pattern controls remain editable
  // (and modulatable) regardless of enable state, so users can
  // pre-configure a patch before flipping the layer on.
  root.appendChild(buildPatternGeneratorGroup(settings));

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

// =====================================================================
// Pattern Generator subgroup (v10)
// =====================================================================

const BLEND_OPTIONS: { value: PatternBlendMode; label: string }[] = [
  { value: 'replace',    label: 'Replace'    },
  { value: 'add',        label: 'Add'        },
  { value: 'subtract',   label: 'Subtract'   },
  { value: 'multiply',   label: 'Multiply'   },
  { value: 'screen',     label: 'Screen'     },
  { value: 'difference', label: 'Difference' },
  { value: 'mask',       label: 'Mask'       },
  { value: 'crossfade',  label: 'Crossfade'  },
];

const AXIS_OPTIONS: { value: PatternAxis; label: string }[] = [
  { value: 'h',      label: 'Horizontal' },
  { value: 'v',      label: 'Vertical'   },
  { value: 'both',   label: 'Both (XOR)' },
  { value: 'radial', label: 'Radial'     },
];

const GRAD_SHAPE_OPTIONS: { value: PatternGradientShape; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'radial', label: 'Radial' },
];

const SCOPE_SOURCE_OPTIONS: { value: PatternScopeSourceKind; label: string }[] = [
  { value: 'audio',          label: 'Audio'           },
  { value: 'classic-slot',   label: 'Classic Slot'    },
  { value: 'graph-node',     label: 'Graph Node'      },
  { value: 'settings-param', label: 'Settings Param'  },
  { value: 'beat',           label: 'Beat Pulse'      },
];

interface ParamRange { min: number; max: number; step: number }

/** UI ranges for each modulatable pattern param. The renderer / shaders
 *  accept a wider range; these are the user-friendly slider bounds. */
const PARAM_RANGES: Partial<Record<PatternParamKey, ParamRange>> = {
  patternBrightness:    { min: 0,    max: 1,   step: 0.01 },
  patternContrast:      { min: 0,    max: 2,   step: 0.01 },
  patternFrequency:     { min: 0,    max: 64,  step: 0.1  },
  patternPhase:         { min: 0,    max: Math.PI * 2, step: 0.01 },
  patternScale:         { min: 0.05, max: 16,  step: 0.05 },
  patternThickness:     { min: 0,    max: 1,   step: 0.005 },
  patternDensity:       { min: 1,    max: 64,  step: 1    },
  patternFreqRatio:     { min: 0.1,  max: 16,  step: 0.05 },
  patternPhaseOffset:   { min: 0,    max: Math.PI * 2, step: 0.01 },
  patternArms:          { min: 1,    max: 16,  step: 1    },
  patternOctaves:       { min: 1,    max: 6,   step: 1    },
  patternPointDensity:  { min: 0.5,  max: 32,  step: 0.5  },
  patternScopeSweep:    { min: 0.1,  max: 4,   step: 0.05 },
  patternScopeTrigger:  { min: -1,   max: 1,   step: 0.01 },
  patternScopePersist:  { min: 0,    max: 0.99,step: 0.01 },
  patternScopeThickness:{ min: 0.5,  max: 8,   step: 0.5  },
  patternScopeBeamHue:  { min: 0,    max: 1,   step: 0.01 },
};

function buildPatternGeneratorGroup(settings: SettingsStore): HTMLElement {
  const g = group('Pattern Generator');

  // ---- Top-level: enable, kind, blend, mix ----
  g.body.append(row('Enable', toggle(settings, 'patternEnabled')));

  // Kind dropdown — grouped by category via <optgroup>.
  const kindSel = document.createElement('select');
  kindSel.className = 'rw-select';
  let lastCategory = '';
  let currentGroup: HTMLOptGroupElement | null = null;
  for (const k of PATTERN_ORDER) {
    const def = PATTERN_REGISTRY[k];
    if (def.category !== lastCategory) {
      currentGroup = document.createElement('optgroup');
      currentGroup.label = PATTERN_CATEGORY_LABEL[def.category];
      kindSel.appendChild(currentGroup);
      lastCategory = def.category;
    }
    const o = document.createElement('option');
    o.value = k;
    o.textContent = def.label;
    currentGroup!.appendChild(o);
  }
  kindSel.value = settings.get('patternKind');
  settings.subscribe('patternKind', (v) => { kindSel.value = v; });
  kindSel.addEventListener('change', () => {
    const next = kindSel.value as PatternKind;
    // Apply per-pattern defaults FIRST so the dynamic param host below
    // sees fresh values when it rebuilds via the patternKind subscriber.
    const def = PATTERN_REGISTRY[next];
    if (def) settings.patch(def.defaults);
    settings.set('patternKind', next);
  });
  g.body.append(row('Kind', kindSel));

  g.body.append(row('Blend', dropdown(settings, 'patternBlendMode', BLEND_OPTIONS)));
  g.body.append(row('Mix',   slider(settings, 'patternMix', 0, 1, 0.01)));

  // ---- Dynamic per-pattern params host ----
  const paramsHost = document.createElement('div');
  paramsHost.dataset.patternParams = '1';
  g.body.append(paramsHost);

  rebuildParams(paramsHost, settings, settings.get('patternKind'));
  settings.subscribe('patternKind', (kind) => {
    rebuildParams(paramsHost, settings, kind);
  });

  return g.root;
}

function rebuildParams(host: HTMLElement, settings: SettingsStore, kind: PatternKind): void {
  host.innerHTML = '';
  const def = PATTERN_REGISTRY[kind];
  if (!def) return;

  for (const key of def.paramKeys) {
    const ctrl = buildParamControl(settings, key);
    if (!ctrl) continue;
    const wrap = document.createElement('div');
    wrap.className = 'rw-inline-group';
    wrap.appendChild(ctrl.el);
    if (ctrl.canModulate) {
      wrap.appendChild(buildModPatchButton(settings, key as ModTarget));
    }
    host.appendChild(row(ctrl.label, wrap));
  }

  if (kind === 'oscilloscope') {
    const note = readout();
    note.style.color = 'var(--re-text-dim)';
    note.style.marginTop = '6px';
    note.textContent =
      'Scope source: pick what to sample.\n' +
      'Audio:      live mic / file / tab via FFT analyser.\n' +
      'Classic Slot: 1-4 (mod-matrix slot index).\n' +
      'Graph Node: <nodeId>:<port>, e.g. "lfo-1:out".\n' +
      'Settings Param: any numeric Settings key, e.g. "zPush".\n' +
      'Beat Pulse: BeatDetector pulse (1.0 on hit, decay).';
    host.appendChild(note);
  }
}

interface ParamControl { el: HTMLElement; label: string; canModulate: boolean }

function buildParamControl(settings: SettingsStore, key: PatternParamKey): ParamControl | null {
  switch (key) {
    case 'patternAxis':
      return { el: dropdown(settings, 'patternAxis', AXIS_OPTIONS), label: 'Axis', canModulate: false };
    case 'patternGradientShape':
      return { el: dropdown(settings, 'patternGradientShape', GRAD_SHAPE_OPTIONS), label: 'Shape', canModulate: false };
    case 'patternScopeSourceKind':
      return { el: dropdown(settings, 'patternScopeSourceKind', SCOPE_SOURCE_OPTIONS), label: 'Source', canModulate: false };
    case 'patternScopeSourceRef': {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'rw-text';
      inp.placeholder = 'e.g. 1, lfo-1:out, zPush';
      inp.value = settings.get('patternScopeSourceRef');
      settings.subscribe('patternScopeSourceRef', (v) => { inp.value = v; });
      inp.addEventListener('change', () => settings.set('patternScopeSourceRef', inp.value));
      return { el: inp, label: 'Ref', canModulate: false };
    }
  }
  // Numeric params -> slider
  const r = PARAM_RANGES[key];
  if (!r) return null;
  return {
    el: slider(settings, key as never, r.min, r.max, r.step),
    label: prettyParamLabel(key),
    canModulate: true,
  };
}

function prettyParamLabel(key: string): string {
  return key
    .replace(/^pattern/, '')
    .replace(/^Scope/, 'Scope ')
    .replace(/([A-Z])/g, ' $1')
    .trim();
}

/**
 * "+" button that pre-targets the first available Classic slot at this
 * param, enables it, sets a small default amount, and expands its UI
 * row so the user can see and tweak the new patch immediately.
 *
 * If all slots are taken, falls back to overwriting slot 0. The user
 * still sees the slot expand, signaling that a patch landed.
 */
function buildModPatchButton(settings: SettingsStore, target: ModTarget): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'rw-btn';
  btn.textContent = '+';
  btn.title = `Patch a Classic LFO -> ${String(target)}`;
  btn.style.flex = '0 0 auto';
  btn.style.minWidth = '24px';
  btn.style.padding = '0 8px';
  btn.addEventListener('click', () => {
    const slots = settings.get('modSlots').slice();
    let idx = slots.findIndex((s: ModSlot) => !s.enabled || s.target === 'none');
    if (idx < 0) idx = 0;
    const cur = slots[idx] ?? DEFAULT_MOD_SLOT;
    slots[idx] = {
      ...cur,
      enabled: true,
      source: 'sine',
      target,
      amount: 0.25,
      frequency: cur.frequency || 0.5,
    };
    settings.set('modSlots', slots);
    const expanded = (settings.get('modSlotExpanded') ?? []).slice();
    while (expanded.length <= idx) expanded.push(false);
    expanded[idx] = true;
    settings.set('modSlotExpanded', expanded);
  });
  return btn;
}
