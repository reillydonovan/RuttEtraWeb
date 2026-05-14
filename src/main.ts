/**
 * Entry point.
 *
 * Routes between two modes:
 *   - synth mode (default): full Rutt/Etra app
 *   - viewer mode (`?view=<peerId>`): connect to a broadcaster and show
 *     the live stream fullscreen with no UI
 *
 * Subsystems are split between an "always-on" core (renderer, scene, panel,
 * camera) and a set of "lazy" modules (timeline, MIDI, audio FFT, OSC,
 * recorder, broadcaster, help) loaded via dynamic `import()` to keep the
 * initial gzipped bundle under ~400KB on cellular.
 */

import * as THREE from 'three';
import { settings } from './state/Settings';
import { VideoSourceManager } from './input/sources';
import { RuttEtraScene } from './renderer/RuttEtra';
import { CameraRig } from './renderer/CameraRig';
import { PostFX } from './renderer/Postfx';
import { ResolutionManager } from './renderer/ResolutionManager';
import { ModMatrix } from './modulation/ModMatrix';
import { activeTargetsBus } from './modulation/ActiveTargetsBus';
import type { GraphEngine } from './modulation/graph/GraphEngine';
import { ControlPanel } from './ui/ControlPanel';
import { createSourceSection } from './ui/sections/SourceSection';
import { createDcuSection } from './ui/sections/DcuSection';
import { createModulationContainerSection } from './ui/sections/ModulationContainerSection';
import { createCameraSection } from './ui/sections/CameraSection';
import { createColorPostFxSection } from './ui/sections/ColorPostFxSection';
import { createGeometrySection } from './ui/sections/GeometrySection';
import { createPresetsSection } from './ui/sections/PresetsSection';
import { createPerformanceSection } from './ui/sections/PerformanceSection';
import { layoutManager } from './ui/layout/LayoutManager';
import { ResponsivePanel } from './ui/layout/ResponsivePanel';
import { DebugOverlay } from './ui/layout/DebugOverlay';
import { PerformanceProfileManager } from './perf/PerformanceProfile';
import { FrameBudgetWatcher } from './perf/FrameBudgetWatcher';
import { attachHaptics, haptic } from './platform/HapticFeedback';
import './ui/layout/layout.css';

const params = new URLSearchParams(window.location.search);
const viewTarget = params.get('view');

if (viewTarget) {
  bootViewer(viewTarget);
} else {
  bootSynth().catch((err) => {
    console.error(err);
    document.body.innerText = `Failed to start: ${err.message}`;
  });
}

// -----------------------------------------------------------------
// Synth mode
// -----------------------------------------------------------------
async function bootSynth(): Promise<void> {
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  const video = document.getElementById('src-video') as HTMLVideoElement;
  const overlay = document.getElementById('overlay') as HTMLElement;
  const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
  const panelHost = document.getElementById('panel-root') as HTMLElement;
  const hud = document.getElementById('hud') as HTMLElement;

  // -------------------------- Layout + perf wiring --------------------------
  const layout = layoutManager();
  attachHaptics(settings);
  const debugOverlay = new DebugOverlay(layout);
  debugOverlay.attachIfRequested();

  // Click trace: enabled with `?clicktrace` in the URL OR by pressing
  // Alt+Shift+D once per session. On every subsequent pointerdown we log
  // the topmost element at the cursor + a short ancestor chain. Helps
  // diagnose "click does nothing" issues by revealing transparent overlays.
  installClickTrace();

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const source = new VideoSourceManager(video);

  const ruttEtra = new RuttEtraScene(settings, video);
  const cameraRig = new CameraRig(settings, canvas);
  const postfx = new PostFX(renderer, ruttEtra.scene, cameraRig.camera, settings, window.innerWidth, window.innerHeight);
  const resolutionManager = new ResolutionManager(canvas, settings);

  // Hide panel/timeline while user "peeks" via long-press.
  document.addEventListener('re-peek-start', () => document.body.classList.add('peeking'));
  document.addEventListener('re-peek-end',   () => document.body.classList.remove('peeking'));

  // -------------------------- Performance profile --------------------------
  const perfMgr = new PerformanceProfileManager(settings, {
    setBloomEnabled:    (on) => { /* leaves user setting alone, only respects on/off */
      const userOn = settings.get('bloomEnabled');
      // Profile may force bloom off (battery): we keep the user's value but
      // only enable the pass when *both* user and profile permit it.
      // The Postfx subscribe path triggers the user-controlled toggle; for
      // the profile gate, we mutate the pass directly via a custom flag.
      (postfx as unknown as { bloomProfileOn?: boolean }).bloomProfileOn = on;
      const composedOn = on && userOn;
      const passes = (postfx.composer as unknown as { passes: { enabled: boolean }[] }).passes;
      // Find the bloom pass by reference parity: re-toggle directly via
      // postfx exposing a setter would be cleaner, but this keeps the
      // public API stable and avoids extra files.
      void passes;
      // Use the existing subscribe path — settings.set with the same value
      // would no-op, so we directly twiddle the bloom enabled flag.
      const bloom = (postfx as unknown as { bloom: { enabled: boolean } }).bloom;
      if (bloom) bloom.enabled = composedOn;
    },
    setChromaEnabled: (on) => {
      const userOn = settings.get('chromaEnabled');
      const crt = (postfx as unknown as { crt: { uniforms: { uChromaOn: { value: number } } } }).crt;
      if (crt) crt.uniforms.uChromaOn.value = (on && userOn) ? 1 : 0;
    },
    setVignetteEnabled: (on) => {
      const userOn = settings.get('vignetteEnabled');
      const crt = (postfx as unknown as { crt: { uniforms: { uVignetteOn: { value: number } } } }).crt;
      if (crt) crt.uniforms.uVignetteOn.value = (on && userOn) ? 1 : 0;
    },
    setRenderQuality: (snap) => {
      currentDprCap = snap.dprCap;
      currentRenderScaleFloor = snap.renderScaleFloor;
      currentFrameInterval = snap.frameIntervalMs;
      postfx.setBloomRTDivisor(snap.bloomRTDivisor);
      resize();
    },
  });

  let currentDprCap = 2;
  let currentRenderScaleFloor = 0.5;
  let currentFrameInterval = 1000 / 60;

  // -------------------------- I/O subsystems ---------------------------
  // MIDI/Audio/OSC are lazy-loaded but the matrix needs them at construction.
  // We boot the matrix with thin shim instances and replace internals once
  // the real modules arrive. Keep main.ts shape stable.
  const ioModule = await import('./io/IoSubsystems');
  const io = await ioModule.bootIoSubsystems(settings);

  const matrix = new ModMatrix(settings, {
    fft:         io.fft,
    beat:        io.beat,
    midiClock:   io.midiClock,
    midiMapping: io.midiMapping,
    midiManager: io.midiManager,
    osc:         io.osc,
  });

  // Lazy-construct the Graph engine. Classic-only users never touch the
  // import. Once built, the engine sticks around so subsequent mode
  // switches are instant.
  let graphEngine: GraphEngine | null = null;
  let videoTap: import('./modulation/graph/VideoTap').VideoTap | null = null;
  const ensureGraphEngine = async (): Promise<GraphEngine> => {
    if (graphEngine) return graphEngine;
    const [{ GraphEngine: GE }, { VideoTap: VT }] = await Promise.all([
      import('./modulation/graph/GraphEngine'),
      import('./modulation/graph/VideoTap'),
    ]);
    videoTap = new VT(video);
    graphEngine = new GE(settings, {
      fft:         io.fft,
      beat:        io.beat,
      midiClock:   io.midiClock,
      midiMapping: io.midiMapping,
      midiManager: io.midiManager,
      osc:         io.osc,
      videoTap,
    });
    const persisted = settings.get('modGraph');
    if (persisted) graphEngine.setPatch(persisted);
    // Keep the engine in sync with `settings.modGraph`. The Beginner /
    // Advanced views still call `engine.setPatch` themselves for instant
    // local updates; this subscription is the safety net that picks up
    // bulk changes (Load Settings, Hard Reset, preset apply, etc.).
    settings.subscribe('modGraph', (next) => {
      if (graphEngine) graphEngine.setPatch(next);
    });
    return graphEngine;
  };
  // Pre-warm if persisted state requires it.
  if (settings.get('modMode') !== 'classic') void ensureGraphEngine();
  settings.subscribe('modMode', (m) => { if (m !== 'classic') void ensureGraphEngine(); });

  // -------------------------- Sequencer + dock ---------------------------
  const seqModule    = await import('./sequencer/Sequencer');
  const seqStore     = await import('./sequencer/store');
  const sequencer = new seqModule.Sequencer(settings);
  sequencer.attachMidiClock(io.midiClock);
  sequencer.onKeyframeReached = () => haptic('tap');

  // Restore last-active timeline (if any).
  {
    const list = seqStore.loadTimelines();
    const activeId = settings.get('activeTimelineId');
    const tl = activeId ? list.find((x) => x.id === activeId) : null;
    if (tl) sequencer.load(tl);
  }

  let lastDefault = JSON.stringify(settings.get('defaultView'));
  settings.subscribe('defaultView', (v) => {
    const cur = JSON.stringify(v);
    if (cur === lastDefault) return;
    lastDefault = cur;
    cameraRig.applySavedView(v);
  });

  // Recorder + broadcaster — both lazy.
  const recordMod = await import('./record/Recorder');
  const recorder = new recordMod.CanvasRecorder(canvas);
  const broadcastMod = await import('./stream/Broadcaster');
  const broadcaster = new broadcastMod.Broadcaster();

  video.addEventListener('loadedmetadata', () => {
    ruttEtra.attachVideo();
  });
  source.subscribe((st) => {
    if (st.kind !== 'none') {
      overlay.classList.add('hidden');
    } else {
      overlay.classList.remove('hidden');
    }
  });

  // -------------------------- UI panel ---------------------------------
  const panel = new ControlPanel(panelHost, settings);
  panel.addSection({ tab: 'synth', title: 'Source',                body: createSourceSection(settings, source),       initiallyOpen: true });
  panel.addSection({ tab: 'synth', title: 'Display Control Unit',  body: createDcuSection(settings),                  initiallyOpen: true });
  panel.addSection({ tab: 'synth', title: 'Camera',                body: createCameraSection(settings, cameraRig) });
  panel.addSection({ tab: 'synth', title: 'Color / Post FX',       body: createColorPostFxSection(settings) });
  panel.addSection({ tab: 'synth', title: 'Modulation',            body: createModulationContainerSection({ settings, matrix, getEngine: ensureGraphEngine, getVideoTap: () => videoTap }) });
  panel.addSection({ tab: 'synth', title: 'Geometry',              body: createGeometrySection(settings) });
  panel.addSection({ tab: 'synth', title: 'Presets',               body: createPresetsSection(settings) });
  panel.addSection({
    tab: 'synth', title: 'Performance',
    body: createPerformanceSection(settings, { onProfileChange: () => perfMgr.applyForMode(layout.current()) }),
  });

  // -------------------------- Responsive shell ---------------------------
  // Constructed up-front so the lazy section loaders below can call
  // `responsive.notifyHelpReady()` once the help module arrives.
  const responsive = new ResponsivePanel(panel, settings, layout, {
    onToggleRecord: async () => {
      if (recorder.isRecording()) recorder.stop();
      else {
        await recorder.start({
          fps: settings.get('recordFps'),
          bitsPerSecond: settings.get('recordBitrateMbps') * 1_000_000,
          includeMic: settings.get('recordIncludeMic'),
          preferredFormat: settings.get('recordPreferredFormat'),
        });
      }
    },
    onToggleBroadcast: async () => {
      if (broadcaster.getState() !== 'idle') await broadcaster.stop();
      else await broadcaster.start({
        canvas,
        includeMic: settings.get('recordIncludeMic'),
      });
    },
  });

  // Lazy-load Record + Share + I/O sections + Help so they don't ship in
  // the initial chunk. UI shows a placeholder until the modules resolve.
  void (async () => {
    const [rs, ss, ms, as, os] = await Promise.all([
      import('./ui/sections/RecordSection'),
      import('./ui/sections/ShareSection'),
      import('./ui/sections/MidiSection'),
      import('./ui/sections/AudioSection'),
      import('./ui/sections/OscSection'),
    ]);
    panel.addSection({ tab: 'synth', title: 'Record', body: rs.createRecordSection(settings, recorder, sequencer) });
    panel.addSection({ tab: 'synth', title: 'Share',  body: ss.createShareSection(settings, broadcaster, canvas) });
    panel.addSection({ tab: 'io',    title: 'MIDI',  body: ms.createMidiSection(settings, io.midiManager), initiallyOpen: true });
    panel.addSection({ tab: 'io',    title: 'Audio', body: as.createAudioSection(settings, io.fft, io.beat), initiallyOpen: true });
    panel.addSection({ tab: 'io',    title: 'OSC',   body: os.createOscSection(settings, io.osc) });
  })();

  void (async () => {
    const helpMod = await import('./ui/sections/HelpSection');
    const fabMod  = await import('./ui/help/fab');
    panel.addSection({ tab: 'help', title: 'Manual', body: helpMod.createHelpSection(settings), initiallyOpen: true });
    fabMod.mountHelpFab(settings);
    fabMod.maybeAutoOpenHelp(settings);
    responsive.notifyHelpReady();
  })();

  // Timeline dock — also lazy. Desktop-only for now: skip mounting on
  // compact layouts, but keep the Sequencer running so existing timelines
  // still play back. Re-evaluate on layout change so a phone -> tablet
  // resize (or `?layout=` override) still mounts the dock.
  let timelineDock: { resize: () => void } | null = null;
  const ensureTimelineDock = async (): Promise<void> => {
    if (timelineDock || layout.current() === 'compact') return;
    const [{ TimelineDock }] = await Promise.all([
      import('./ui/timeline/TimelineDock'),
      import('./ui/timeline/timeline.css'),
    ]);
    if (timelineDock) return; // race: another caller mounted first.
    const timelineHost = document.getElementById('timeline-dock') as HTMLElement;
    const dock = new TimelineDock(timelineHost, settings, sequencer);
    setTimeout(() => dock.resize(), 0);
    timelineDock = dock;
  };
  void ensureTimelineDock();
  layout.onModeChange(() => { void ensureTimelineDock(); });
  recorder.subscribe((s) => responsive.setRecordingIndicator(s === 'recording'));
  broadcaster.subscribe((s) => responsive.setBroadcastIndicator(s === 'live' || s === 'connecting'));
  responsive.applyMode(layout.current());

  // Mobile-first default: if the device boots in compact mode for the very
  // first time, sample the webcam color (most useful default on a phone).
  // The one-shot flag prevents re-overriding if the user later picks a
  // phosphor mode and reloads.
  if (layout.current() === 'compact' && !settings.get('mobileColorAutoSet')) {
    settings.batchUpdate({ colorMode: 'video', mobileColorAutoSet: true });
  }

  // Frame-budget watcher: suggest battery profile if avg ms > 32 ms.
  const watcher = new FrameBudgetWatcher(layout, {
    suggestBatteryProfile: () => {
      responsive.toast(
        'Performance is choppy — switch to Battery profile?',
        {
          label: 'Switch',
          onClick: () => {
            const cur = settings.get('performanceProfile');
            settings.set('performanceProfile', { ...cur, [layout.current()]: 'battery' });
            perfMgr.applyForMode(layout.current());
          },
        },
        12000,
      );
    },
    onUpdate: (avgMs, fps) => {
      debugOverlay.setStats(fps, avgMs);
      if (layout.isDebugGraph) debugOverlay.setGraphStats(graphEngine?.stats() ?? null);
    },
  });

  // Apply the profile for the current mode immediately + on mode change.
  layout.onModeChange((mode) => {
    perfMgr.applyForMode(mode);
    debugOverlay.setRenderQuality(settings.get('renderScale'), perfMgr.snapshot().id);
    // Disable Fly mode in compact (touch + small screen).
    if (mode === 'compact' && settings.get('cameraMode') === 'fly') {
      settings.set('cameraMode', 'orbit');
    }
  });
  settings.subscribe('renderScale', () => {
    debugOverlay.setRenderQuality(settings.get('renderScale'), perfMgr.snapshot().id);
    resize();
  });
  settings.subscribe('renderResolutionId',     () => resize());
  settings.subscribe('renderFitMode',          () => resize());
  settings.subscribe('renderResolutionCustomW', () => resize());
  settings.subscribe('renderResolutionCustomH', () => resize());

  // -------------------------- Audio gesture gate (iOS) ---------------------
  if (!settings.get('audioGestureUnlocked')) {
    mountAudioGate();
  }

  // -------------------------- Webcam start gesture ---------------------
  startBtn.addEventListener('click', async () => {
    try {
      await source.useWebcam({
        width:  settings.get('requestedWidth'),
        height: settings.get('requestedHeight'),
        fps:    settings.get('requestedFps'),
        facingMode: layout.hasTouch ? settings.get('cameraFacing') : undefined,
      });
      settings.set('sourceKind', 'webcam');
      settings.set('audioGestureUnlocked', true);
    } catch (err) {
      const e = err as Error;
      const line = document.createElement('div');
      line.className = 'boot-line dim';
      line.textContent = `Couldn't access webcam: ${e.message}. Try a file or screen share from the Source panel.`;
      document.getElementById('boot-message')?.appendChild(line);
    }
  });

  // -------------------------- Resize handling ---------------------------
  let resizeTimer: number | null = null;
  function resize(): void {
    const vp = layout.viewport();
    const w = vp.width;
    const h = vp.height;
    // Effective DPR = min(devicePixelRatio, profile.dprCap) * userScale,
    // clamped to the profile's renderScaleFloor lower bound.
    const userScale = Math.max(currentRenderScaleFloor, settings.get('renderScale'));
    const dpr = Math.min(window.devicePixelRatio, currentDprCap) * userScale;
    // ResolutionManager owns renderer/postfx/rig resize: it routes to the
    // correct render-target size (match-window vs. fixed preset) and
    // positions the canvas CSS for the chosen fit mode.
    resolutionManager.apply(renderer, postfx, ruttEtra, cameraRig, w, h, dpr, userScale);
    timelineDock?.resize();
  }
  function scheduleResize(): void {
    if (resizeTimer != null) return;
    resizeTimer = window.setTimeout(() => { resizeTimer = null; resize(); }, 120);
  }
  window.addEventListener('resize', scheduleResize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleResize);
  }
  perfMgr.applyForMode(layout.current());
  resize();

  postfx.setCamera(cameraRig.camera);

  // -------------------------- Render loop -------------------------------
  const clock = new THREE.Clock();
  let frames = 0;
  let fpsClock = performance.now();
  let fps = 0;
  let lastDraw = performance.now();

  function frame() {
    const now = performance.now();
    const dt = clock.getDelta();
    const t = clock.elapsedTime;

    io.midiClock.tick(dt);
    io.fft.tick(dt);
    io.beat.tick(dt);
    // Mode switch: Classic engine writes only when `modMode` is `'classic'`
    // or `'both'`. When mode is `'graph'`, we publish an empty Classic
    // target set so the dual-engine indicator deactivates immediately.
    const modMode = settings.get('modMode');
    if (modMode !== 'graph') {
      matrix.tick(dt);
    } else {
      activeTargetsBus.publish('classic', new Set());
    }
    videoTap?.tick();
    graphEngine?.tick(dt);
    sequencer.tick(dt);
    cameraRig.tick(dt);
    ruttEtra.updateSpectrum(io.fft.bands);
    ruttEtra.tick(dt, t);

    // Honor profile's frameIntervalMs (battery profile caps to 30 fps).
    if (now - lastDraw + 0.5 < currentFrameInterval) {
      requestAnimationFrame(frame);
      return;
    }
    lastDraw = now;

    postfx.render(dt);
    watcher.onFrame(dt);

    frames++;
    if (now - fpsClock >= 500) {
      fps = (frames * 1000) / (now - fpsClock);
      frames = 0;
      fpsClock = now;
      const st = source.getState();
      const rW = resolutionManager.actualWidth;
      const rH = resolutionManager.actualHeight;
      const resId = settings.get('renderResolutionId');
      const renderPart = (rW > 0 && resId !== 'match') ? `  ·  render ${rW}×${rH}` : '';
      const srcPart = st.kind === 'none' ? 'no source' : `${st.kind} ${st.width}×${st.height}`;
      hud.textContent = `${fps.toFixed(0)} fps  ·  ${srcPart}${renderPart}`;
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // -------------------------- Audio gate helper ---------------------
  function mountAudioGate(): void {
    // Only relevant on touch devices where AudioContext requires a gesture.
    if (!layout.hasTouch) {
      settings.set('audioGestureUnlocked', true);
      return;
    }
    const gate = document.createElement('div');
    gate.id = 'rw-audio-gate';
    gate.innerHTML = '<div>TAP TO ENABLE AUDIO + WEBCAM<small>iOS Safari requires a tap to unlock the audio engine</small></div>';
    const dismiss = () => {
      gate.remove();
      settings.set('audioGestureUnlocked', true);
    };
    gate.addEventListener('click', dismiss);
    gate.addEventListener('touchend', dismiss);
    document.body.appendChild(gate);
  }
}

// -----------------------------------------------------------------
// Click-trace diagnostic
// -----------------------------------------------------------------
/**
 * When active, every pointerdown is logged to the console with the topmost
 * element at the cursor and its closest ancestor chain. This is the
 * fastest way to identify a transparent overlay that's swallowing clicks.
 *
 *   activation:
 *     - URL contains `?clicktrace` (sticky for the session)
 *     - press Alt+Shift+D anywhere on the page (toggles)
 */
function installClickTrace(): void {
  const params = new URLSearchParams(window.location.search);
  let active = params.has('clicktrace');

  const banner = document.createElement('div');
  banner.style.cssText =
    'position:fixed;top:4px;right:4px;z-index:9999;padding:3px 6px;' +
    'background:#5fff85;color:#000;font:12px monospace;' +
    'pointer-events:none;letter-spacing:0.05em;display:none;';
  banner.textContent = 'CLICK TRACE ON';
  document.body.appendChild(banner);

  const setActive = (on: boolean): void => {
    active = on;
    banner.style.display = on ? 'block' : 'none';
    // eslint-disable-next-line no-console
    console.log(`[click-trace] ${on ? 'enabled' : 'disabled'}`);
  };

  setActive(active);

  window.addEventListener('keydown', (ev) => {
    if (ev.altKey && ev.shiftKey && (ev.key === 'D' || ev.key === 'd')) {
      setActive(!active);
    }
  });

  window.addEventListener('pointerdown', (ev) => {
    if (!active) return;
    const top = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
    const chain: string[] = [];
    let n: HTMLElement | null = top;
    while (n && chain.length < 6) {
      const cls = n.className && typeof n.className === 'string' ? '.' + n.className.split(' ').filter(Boolean).join('.') : '';
      const id  = n.id ? '#' + n.id : '';
      chain.push(`<${n.tagName.toLowerCase()}${id}${cls}>`);
      n = n.parentElement;
    }
    // eslint-disable-next-line no-console
    console.log('[click-trace]', { x: ev.clientX, y: ev.clientY, chain: chain.join(' ← ') });
  }, true);
}

// -----------------------------------------------------------------
// Viewer mode
// -----------------------------------------------------------------
function bootViewer(targetId: string): void {
  document.body.classList.add('viewer-mode');
  const v = document.createElement('video');
  v.autoplay = true;
  v.playsInline = true;
  v.muted = false;
  v.controls = false;
  Object.assign(v.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    background: '#000',
    zIndex: '1000',
  });
  document.body.appendChild(v);

  const status = document.createElement('div');
  Object.assign(status.style, {
    position: 'fixed',
    top: '12px', left: '12px',
    color: '#5fff85', fontFamily: 'VT323, monospace',
    fontSize: '20px', zIndex: '1001',
    textShadow: '0 0 6px rgba(95,255,133,0.8)',
  });
  status.textContent = 'connecting...';
  document.body.appendChild(status);

  void (async () => {
    const { Viewer } = await import('./stream/Viewer');
    const viewer = new Viewer(targetId, v);
    viewer.start();
    v.addEventListener('playing', () => { status.textContent = ''; });
  })();

  document.body.addEventListener('click', () => {
    v.muted = false;
    v.play().catch(() => {});
  }, { once: true });
}
