/**
 * Source section — pick a video source (webcam / screen / file / stream URL)
 * plus mirror toggles and capture-quality settings.
 *
 * As of v10 also hosts the Pattern Generator group: a parallel
 * synthesized layer with its own enable toggle, kind / blend / mix
 * controls, and a per-pattern dynamic params host that rebuilds itself
 * each time `patternKind` changes.
 *
 * The webcam/screen/file/stream picker itself is `buildVideoSourcePicker`
 * — a reusable unit parameterized by which `VideoSourceManager` and
 * Settings keys to drive, so `createSourceBSection` (Source B, the
 * Patch Bay's second video feed) gets the identical picker instead of a
 * hand-duplicated copy.
 */

import {
  SettingsStore, PatternKind, PatternBlendMode, ModTarget, ModSlot, DEFAULT_MOD_SLOT,
} from '../../state/Settings';
import { VideoSourceManager } from '../../input/sources';
import { layoutManager } from '../layout/LayoutManager';
import { row, group, toggle, button, readout, slider, dropdown, markParamKey } from '../widgets';

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
  AXIS_OPTIONS, GRAD_SHAPE_OPTIONS, SCOPE_SOURCE_OPTIONS, prettyParamLabel,
} from '../../renderer/patterns/PatternRegistry';
import type { PatternParamKey } from '../../renderer/patterns/PatternRegistry';

const WEBCAM_RESOLUTIONS = [
  { label: 'Auto (native)',   w: 0,    h: 0    },
  { label: 'VGA (640×480)',   w: 640,  h: 480  },   // the default
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
  markParamKey(resSel, 'requestedWidth');
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
    if (!match && ![...resSel.options].some((o) => o.value === `${w}x${h}`)) {
      // A saved size that isn't one of the presets still shows (never a blank dropdown).
      const o = document.createElement('option');
      o.value = `${w}x${h}`; o.textContent = `${w}×${h} (custom)`;
      resSel.appendChild(o);
    }
    resSel.value = `${w}x${h}`;
  }
  syncResDropdown();
  resSel.addEventListener('change', () => {
    const [w, h] = resSel.value.split('x').map(Number);
    settings.set('requestedWidth',  w);
    settings.set('requestedHeight', h);
    void applyToLiveCamera();
  });

  const fpsInp = document.createElement('input');
  fpsInp.type = 'number'; fpsInp.min = '1'; fpsInp.max = '120'; fpsInp.step = '1';
  fpsInp.className = 'rw-text'; fpsInp.style.width = '64px';
  markParamKey(fpsInp, 'requestedFps');
  fpsInp.value = String(settings.get('requestedFps'));
  fpsInp.addEventListener('change', () => {
    const v = Math.max(1, Math.min(120, Math.round(+fpsInp.value) || 30));
    fpsInp.value = String(v);
    settings.set('requestedFps', v);
    void applyToLiveCamera();
  });

  const capNote = readout();
  capNote.style.color = 'var(--re-text-dim)';
  const IDLE_NOTE = '"Auto" lets the browser pick the camera\'s native resolution. With a camera running, a change restarts it right away; otherwise it applies on the next "Use Webcam".';
  capNote.textContent = IDLE_NOTE;

  /** A running webcam keeps the resolution it was opened with, so a changed
   *  Resolution/FPS restarts it (same device) and says what it got — never
   *  a silent no-op (principle 3). A camera may offer less than asked (4K
   *  on a 1080p webcam): the readout then shows the actual size. */
  let applySeq = 0;
  async function applyToLiveCamera(): Promise<void> {
    if (source.getState().kind !== 'webcam') { capNote.textContent = IDLE_NOTE; return; }
    const seq = ++applySeq;
    const w = settings.get('requestedWidth'), h = settings.get('requestedHeight');
    capNote.textContent = w > 0 ? `Restarting the camera at ${w}×${h}…` : 'Restarting the camera at its native size…';
    try {
      const deviceId = settings.get('deviceId');
      await source.useWebcam({
        deviceId: deviceId || undefined,
        width: w || undefined, height: h || undefined,
        fps: settings.get('requestedFps'),
        facingMode: !deviceId && layoutManager().hasTouch ? settings.get('cameraFacing') : undefined,
      });
      if (seq !== applySeq) return;   // a newer change superseded this one
      const st = source.getState();
      capNote.textContent = w > 0 && (st.width !== w || st.height !== h)
        ? `Camera is now ${st.width}×${st.height} — it can't do ${w}×${h}, so the browser picked the closest size it offers.`
        : `Camera is now ${st.width}×${st.height}.`;
    } catch (err) {
      if (seq === applySeq) capNote.textContent = `Couldn't apply that: ${(err as Error).message}. The camera is stopped — press Use Webcam to start it again.`;
    }
  }

  capGrp.body.append(
    row('Resolution', resSel),
    row('FPS',        fpsInp),
    capNote,
  );
  root.appendChild(capGrp.root);

  // Status readout — declared here (before the picker groups that write
  // into it via `info.textContent = ...` in their error handlers) but
  // appended to the DOM further down, in its original position. Event
  // handlers only fire long after this whole function body has finished
  // running, so the variable just needs to exist by then, not be
  // textually declared before every closure that captures it.
  const info = readout();

  root.appendChild(buildVideoSourcePicker({
    settings, source, kindKey: 'sourceKind', deviceIdKey: 'deviceId', info,
  }));

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
// Shared video-source picker (webcam / screen / file / stream URL)
// =====================================================================

export interface VideoSourcePickerOpts {
  settings: SettingsStore;
  source: VideoSourceManager;
  /** Which Settings key records the active source kind — 'sourceKind'
   *  for Source A, 'sourceBKind' for Source B. */
  kindKey: 'sourceKind' | 'sourceBKind';
  /** Which Settings key remembers the chosen webcam device — separate
   *  per source so A and B can independently pick different (or the
   *  SAME) physical camera. */
  deviceIdKey: 'deviceId' | 'deviceIdB';
  /** Error/status line the caller creates, appends wherever it wants,
   *  and (usually) also drives from `source.subscribe()` for a
   *  kind/label/size readout — shared with any inline error messages
   *  raised here, same "last write wins, and a real state change wins
   *  right back" behavior the original Source A section already had. */
  info: HTMLElement;
}

/**
 * Builds the Webcam / Screen Capture / Video File / Stream URL groups
 * — the actual "what feeds this raster" picker — as one reusable unit.
 * Extracted from `createSourceSection` so Source B's Controls-tab
 * section (owner: "shouldn't I be able to specify what the second
 * raster is — another webcam, same webcam, video, stream, etc?") gets
 * the exact same picker Source A has, not a second hand-maintained
 * copy. Capture Settings (resolution/fps — shared, applies to
 * whichever source opens a webcam next), Video Audio, Mirror, and
 * Pattern Generator stay Source-A-specific concepts in
 * `createSourceSection` itself.
 */
export function buildVideoSourcePicker(opts: VideoSourcePickerOpts): HTMLElement {
  const { settings, source, kindKey, deviceIdKey, info } = opts;
  const wrap = document.createElement('div');

  // ---- Webcam device selector ----
  const wc = group('Webcam');

  const select = document.createElement('select');
  select.className = 'rw-select';
  // Refresh is a click, so it may ask for camera permission (browsers hide
  // device labels until it's granted). Building the picker never asks.
  const refreshBtn = button('Refresh', async () => populateDevices(false));

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
    if (settings.get(deviceIdKey)) select.value = settings.get(deviceIdKey);
  }
  // List whatever the browser reveals WITHOUT prompting: labels appear once
  // camera permission exists (after WEBCAM or Refresh). Asking here fired a
  // camera prompt ~1 s after page load, before the visitor chose anything.
  populateDevices(true).catch(() => {});

  select.addEventListener('change', async () => {
    const id = select.value;
    settings.set(deviceIdKey, id);
    try {
      await source.useWebcam({
        deviceId: id,
        width:  settings.get('requestedWidth'),
        height: settings.get('requestedHeight'),
        fps:    settings.get('requestedFps'),
      });
      settings.set(kindKey, 'webcam');
    } catch (err) {
      info.textContent = `Webcam error: ${(err as Error).message}`;
    }
  });

  const startWebcam = button('Use Webcam', async () => {
    try {
      await source.useWebcam({
        deviceId: settings.get(deviceIdKey) || undefined,
        width:  settings.get('requestedWidth'),
        height: settings.get('requestedHeight'),
        fps:    settings.get('requestedFps'),
      });
      settings.set(kindKey, 'webcam');
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
  wrap.appendChild(wc.root);

  // Screen capture
  const sc = group('Screen Capture');
  sc.body.append(
    row('', button('Capture Screen', async () => {
      try {
        await source.useScreen({ fps: settings.get('requestedFps') });
        settings.set(kindKey, 'screen');
      } catch (err) {
        info.textContent = `Screen error: ${(err as Error).message}`;
      }
    }, 'primary')),
  );
  wrap.appendChild(sc.root);

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
    settings.set(kindKey, 'file');
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
      settings.set(kindKey, 'stream');
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
  // Require an actual video response: a host that answers every unknown
  // path with index.html (200, text/html) would otherwise reveal a Load
  // Sample button that can only fail.
  fetch(SAMPLE_VIDEO_URL, { method: 'HEAD' })
    .then((r) => {
      if (r.ok && (r.headers.get('content-type') ?? '').startsWith('video/')) sampleRow.style.display = '';
    })
    .catch(() => { /* file absent or CORS — keep row hidden */ });

  wrap.appendChild(fl.root);

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
      settings.set(kindKey, 'stream');
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
  wrap.appendChild(su.root);

  return wrap;
}

/**
 * Controls-tab "Video Source B" section — the second, independent video
 * feed the Patch Bay's Composite/Dual Raster nodes can draw from. Until
 * now this was only configurable via the Patch Bay's own VIDEO SOURCE B
 * module (one-click default webcam, no device choice) — owner: "in the
 * controls shouldn't I be able to specify what the second raster is,
 * another webcam, same webcam, video, stream, etc?" Reuses the exact
 * same picker Source A has (`buildVideoSourcePicker`); deliberately
 * skips Capture Settings (shared with A), Video Audio, Mirror, and
 * Pattern Generator — those are Source-A/global concepts, not a second
 * copy this section would need.
 */
export function createSourceBSection(settings: SettingsStore, sourceB: VideoSourceManager): HTMLElement {
  const root = document.createElement('div');

  const note = document.createElement('p');
  note.className = 'section-note';
  note.textContent =
    'A second, independent video feed for the Patch Bay\'s Composite and '
    + 'Dual Raster nodes — pick a different camera, the same camera, a '
    + 'file, or a stream, same as Source A. Has no effect until wired to '
    + 'Composite or Dual Raster in the Patch Bay.';
  root.appendChild(note);

  const info = readout();
  root.appendChild(buildVideoSourcePicker({
    settings, source: sourceB, kindKey: 'sourceBKind', deviceIdKey: 'deviceIdB', info,
  }));

  root.appendChild(button('Stop Source B', () => {
    sourceB.stop();
    settings.set('sourceBKind', 'none');
  }, 'danger'));

  info.style.marginTop = '8px';
  root.appendChild(info);
  sourceB.subscribe((st) => {
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

// AXIS_OPTIONS / GRAD_SHAPE_OPTIONS / SCOPE_SOURCE_OPTIONS / prettyParamLabel
// moved to PatternRegistry.ts (imported below) — pure pattern data belongs
// in the pure-data module, not this Controls-tab-specific section file, so
// the Patch Bay's own Pattern Generator module can reuse them without
// pulling in SourceSection's Controls-only UI code.

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
  btn.className = 'rw-btn rw-patch-toggle';
  btn.style.flex = '0 0 auto';
  btn.style.minWidth = '24px';
  btn.style.padding = '0 8px';
  const slotFor = (): number =>
    settings.get('modSlots').findIndex((s: ModSlot) => s.enabled && s.target === target);
  // "+" patches a Classic LFO into this param; once patched it reads "LFO" (click: show it in
  // Modulation, where its rate / amount live) and the ✕ beside it removes the patch.
  const sync = (): void => {
    const patched = slotFor() >= 0;
    btn.textContent = patched ? 'LFO' : '+';
    btn.classList.toggle('active', patched);
    btn.title = patched
      ? `Patched from Classic slot ${slotFor() + 1} — click to show its controls in Modulation. Use ✕ to remove it.`
      : `Patch a Classic LFO -> ${String(target)}`;
    rm.hidden = !patched;
  };
  const rm = document.createElement('button');
  rm.type = 'button';
  rm.className = 'rw-btn rw-patch-remove rw-x';
  rm.textContent = '✕';
  rm.title = 'Remove this LFO patch';
  rm.style.flex = '0 0 auto';
  rm.style.padding = '0 6px';
  rm.addEventListener('click', () => {
    const i = slotFor();
    if (i < 0) return;
    const slots = settings.get('modSlots').slice();
    slots[i] = { ...slots[i], enabled: false, target: 'none' as ModTarget };
    settings.set('modSlots', slots);
  });
  const reveal = (idx: number): void => {
    const card = document.querySelector<HTMLElement>(`.rw-mod-slot[data-mod-slot="${idx}"]`);
    const sec = card?.closest<HTMLElement>('.rw-section');
    sec?.classList.remove('collapsed');
    window.setTimeout(() => card?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  };
  btn.addEventListener('click', () => {
    const existing = slotFor();
    if (existing >= 0) { reveal(existing); return; }
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
    reveal(idx);
  });
  settings.subscribe('modSlots', sync);
  sync();
  const wrap = document.createElement('span');
  wrap.style.display = 'inline-flex';
  wrap.style.gap = '4px';
  wrap.style.alignItems = 'center';
  wrap.append(btn, rm);
  return wrap;
}
