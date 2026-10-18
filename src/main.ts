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
import { settings, presetPatch } from './state/Settings';
import { PRESETS, NO_CAMERA_PRESET_ID } from './ui/presets';
import { VideoSourceManager } from './input/sources';
import { RuttEtraScene } from './renderer/RuttEtra';
import { CameraRig } from './renderer/CameraRig';
import { PostFX } from './renderer/Postfx';
import { ResolutionManager } from './renderer/ResolutionManager';
import { PatternRenderer } from './renderer/patterns/PatternRenderer';
import { VideoCompositor, isPatternRouted } from './renderer/VideoCompositor';
import { PatternSignalBus } from './renderer/patterns/PatternSignalBus';
import type { OscilloscopeBuffer } from './renderer/patterns/OscilloscopeBuffer';
import { VideoTap } from './modulation/graph/VideoTap';
import { MeshAnalyzer } from './audio/MeshAnalyzer';
import { Sonification } from './audio/Sonification';
import { ProjectStore } from './project/ProjectStore';
import { AutoSave } from './project/AutoSave';
import { maybePackageRecoveredSession } from './project/RecoveredSession';
import { describeSummary, UI_STATE_KEYS } from './project/Project';
import { ModMatrix } from './modulation/ModMatrix';
import { activeTargetsBus } from './modulation/ActiveTargetsBus';
import { LiveValuesStore } from './modulation/LiveValues';
import { getDef } from './modulation/graph/registry';
import { attachModDebugOverlayIfRequested } from './modulation/ModDebugOverlay';
import type { GraphEngine } from './modulation/graph/GraphEngine';
import { STARTER_PATCHES, StarterPatch } from './modulation/graph/library';
import type { GraphPatch } from './modulation/graph/types';
import { ControlPanel } from './ui/ControlPanel';
import { createSourceSection, createSourceBSection } from './ui/sections/SourceSection';
import { createDcuSection, aspectForSource } from './ui/sections/DcuSection';
import { createDualRasterSection } from './ui/sections/DualRasterSection';
import { createModulationContainerSection } from './ui/sections/ModulationContainerSection';
import { createGeneratorCard } from './ui/sections/ModulationSection';
import { createCameraSection } from './ui/sections/CameraSection';
import { createColorPostFxSection } from './ui/sections/ColorPostFxSection';
import { createGeometrySection } from './ui/sections/GeometrySection';
import { createPresetsSection } from './ui/sections/PresetsSection';
import { createPerformanceSection } from './ui/sections/PerformanceSection';
import { createXrSection } from './ui/sections/XrSection';
import { XRManager } from './renderer/XRManager';
import { noteMainFrame, setFrameRunner } from './renderer/frameDriver';
import { layoutManager } from './ui/layout/LayoutManager';
import { ResponsivePanel } from './ui/layout/ResponsivePanel';
import { DebugOverlay } from './ui/layout/DebugOverlay';
import { PerformanceProfileManager } from './perf/PerformanceProfile';
import { FrameBudgetWatcher } from './perf/FrameBudgetWatcher';
import { attachHaptics, haptic } from './platform/HapticFeedback';
import * as keyframeAffordance from './ui/keyframeAffordance';
import { registerLiveValues } from './ui/liveValueBus';
import { resetSavedState, BACKUP_KEY } from './state/resetSavedState';
import { showStatusBadge } from './ui/statusBadge';
// Self-hosted UI fonts (were a render-blocking Google Fonts stylesheet).
import '@fontsource/vt323';
import '@fontsource/share-tech-mono';
import './ui/layout/layout.css';
import './ui/layout/mobile-modern.css';
import './ui/cursors.css';

const UI_STATE_KEY_SET: ReadonlySet<string> = new Set(UI_STATE_KEYS);
const params = new URLSearchParams(window.location.search);
const viewTarget = params.get('view');
const RESET_NOTICE_KEY = 'rw-reset-notice';

// A tab left open across a deploy asks for code-split chunks the new build
// no longer has. Reload once (at most once a minute) to pick up the new
// build instead of leaving a half-loaded panel.
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'rw-chunk-reload-at';
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  location.reload();
});

/** Fade out and remove the startup splash from index.html (idempotent). */
function hideSplash(): void {
  const el = document.getElementById('rw-splash');
  if (!el || el.classList.contains('rw-splash-out')) return;
  el.classList.add('rw-splash-out');
  setTimeout(() => el.remove(), 400);
}

if (params.has('reset')) {
  // ?reset — the escape hatch for a saved state that won't load. Clears
  // everything the app keeps in localStorage (backing it up first) and
  // reloads without the parameter, so nothing reads storage before it's
  // clean.
  let cleared = 0;
  try { cleared = resetSavedState(localStorage); } catch { /* storage disabled */ }
  try { sessionStorage.setItem(RESET_NOTICE_KEY, String(cleared)); } catch { /* ignore */ }
  params.delete('reset');
  const q = params.toString();
  location.replace(`${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
} else if (viewTarget) {
  hideSplash();
  bootViewer(viewTarget);
} else {
  try {
    const n = sessionStorage.getItem(RESET_NOTICE_KEY);
    if (n != null) {
      sessionStorage.removeItem(RESET_NOTICE_KEY);
      showStatusBadge(`Saved state reset (${n} items) — backup kept as "${BACKUP_KEY}"`, 'info', 8000);
    }
  } catch { /* ignore */ }
  // Never leave the startup splash covering a working app.
  setTimeout(hideSplash, 15000);
  bootSynth().catch((err) => {
    console.error(err);
    document.body.innerText = `Failed to start: ${err.message}. Opening ${location.pathname}?reset clears saved state.`;
  });
}

// -----------------------------------------------------------------
// Synth mode
// -----------------------------------------------------------------
async function bootSynth(): Promise<void> {
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  const video = document.getElementById('src-video') as HTMLVideoElement;
  const overlay = document.getElementById('overlay') as HTMLElement;
  const panelHost = document.getElementById('panel-root') as HTMLElement;
  // Boot source picker elements
  const bootWebcam   = document.getElementById('boot-webcam')         as HTMLButtonElement;
  const bootScreen   = document.getElementById('boot-screen')         as HTMLButtonElement;
  const bootFile     = document.getElementById('boot-file')           as HTMLButtonElement;
  const bootStreamBtn = document.getElementById('boot-stream-btn')    as HTMLButtonElement;
  const bootPattern  = document.getElementById('boot-pattern')        as HTMLButtonElement;
  const bootStreamRow = document.getElementById('boot-stream-row')    as HTMLElement;
  const bootStreamInput = document.getElementById('boot-stream-input') as HTMLInputElement;
  const bootStreamConnect = document.getElementById('boot-stream-connect') as HTMLButtonElement;
  const bootFileInput = document.getElementById('boot-file-input')   as HTMLInputElement;
  const bootError    = document.getElementById('boot-error')          as HTMLElement;
  const bootSkip     = document.getElementById('boot-skip')           as HTMLButtonElement;
  const hud = document.getElementById('hud') as HTMLElement;
  settings.subscribe('hudVisible', (v) => { hud.style.display = v ? '' : 'none'; });

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

  // Video Source B (v1.18) — a second independent source for the Patch
  // Bay's Composite node (owner: "like a file and a camera feed").
  // `VideoSourceManager` is instance-based (own element, own state), so
  // a second instance is a clean construction — no singleton to fight.
  // Created off the DOM tree Vite renders from (no index.html change);
  // hidden and appended so autoplay/getUserMedia behave the same as
  // the primary `#src-video` element.
  const videoB = document.createElement('video');
  videoB.muted = true;
  videoB.playsInline = true;
  videoB.autoplay = true;
  videoB.style.display = 'none';
  document.body.appendChild(videoB);
  const sourceB = new VideoSourceManager(videoB);
  let videoBTexture: THREE.VideoTexture | null = null;
  const attachVideoB = (): void => {
    if (videoBTexture) { videoBTexture.dispose(); videoBTexture = null; }
    const tex = new THREE.VideoTexture(videoB);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.format = THREE.RGBAFormat;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    videoBTexture = tex;
  };
  videoB.addEventListener('loadedmetadata', attachVideoB);

  // Single shared "base + mod" router. Built before anything that
  // subscribes to modulatable params so renderer code can register
  // against `liveValues` from the very first frame. The store mirrors
  // `Settings` for non-modulated keys and overlays per-engine
  // contributions for modulated ones — see `src/modulation/LiveValues.ts`.
  const liveValues = new LiveValuesStore(settings);
  attachModDebugOverlayIfRequested(liveValues);
  // Let panel sliders display live values next to the base they edit
  // (lazy bus — slider() runs before this point during panel builds in
  // popouts/rebuilds, after it during boot; both work).
  registerLiveValues(liveValues);

  const ruttEtra = new RuttEtraScene(settings, video, liveValues);
  const cameraRig = new CameraRig(settings, canvas, liveValues);
  const postfx = new PostFX(renderer, ruttEtra.scene, cameraRig.camera, settings, window.innerWidth, window.innerHeight, liveValues);
  const resolutionManager = new ResolutionManager(canvas, settings);

  // -------------------- Pattern Generator (v10) --------------------
  // Independent layer parallel to the video source. When `patternEnabled`
  // is true, `patternRenderer.tick()` runs each frame: renders the chosen
  // generator + composites it with the live video texture, then binds the
  // result as the DCU's input. When false, the live video texture feeds
  // the DCU directly (zero added cost).
  //
  // The scope-source sampler is wired LATER (after `io`, `matrix`, and
  // `graphEngine` exist); this construction only sets up render targets
  // and materials.
  // Pattern signal bus — values published BY pattern shaders' CPU
  // mirrors and consumed by ModMatrix (Classic 'patternOutput' source),
  // GraphEngine (`pattern-output` node), and CVOutput (per-channel
  // `pattern-output` source). One frame of latency between publish and
  // consume — same as every other inter-tick boundary in the engine.
  const patternSignalBus = new PatternSignalBus();

  const patternRenderer = new PatternRenderer(
    renderer, settings, liveValues, ruttEtra, patternSignalBus,
    window.innerWidth, window.innerHeight,
  );

  // Video Source A/B Composite (v1.18) — see VideoCompositor.ts. Sized
  // from the sources' own native video dimensions, independent of
  // render resolution, so it needs no ResolutionManager involvement.
  const videoCompositor = new VideoCompositor(renderer, settings, liveValues);
  let videoCompositeBoundExternal = false;
  /** Pixel size of the video feeding the raster (for DCU ▸ Match source). */
  const rasterSourceSize = (): { w: number; h: number } | null => {
    const v = settings.get('videoRendererIn') === 'sourceB' ? videoB : video;
    return v.videoWidth > 0 ? { w: v.videoWidth, h: v.videoHeight } : null;
  };
  let patternWasRendering = false;
  // Restore the live video binding when the user disables the layer.
  settings.subscribe('patternEnabled', (enabled) => {
    // Still rendering as a patched source (v1.31)? Leave it running.
    if (!enabled && !isPatternRouted((k) => settings.get(k))) patternRenderer.bypass();
  });

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

  // -------------------------- WebXR manager (v11) ----------------------
  // Owns the immersive-vr / immersive-ar session lifecycle. The toast
  // hook deliberately reuses `projectToast` (defined further down) via
  // a thunked indirection: the hook is constructed once but reads the
  // current function ref each show() so the late-defined toast is
  // reachable. Constructed BEFORE the panel sections so the XR section
  // can subscribe to start/end events from the manager.
  let xrToastImpl: ((msg: string) => void) | null = null;
  const xrManager = new XRManager(
    {
      renderer,
      scene: ruttEtra.scene,
      meshGroup: ruttEtra.group,
      cameraRig,
      settings,
      perfMgr,
      getLayoutMode: () => layout.current(),
    },
    { show: (msg) => xrToastImpl?.(msg) },
  );

  // -------------------------- I/O subsystems ---------------------------
  // MIDI/Audio/OSC are lazy-loaded but the matrix needs them at construction.
  // We boot the matrix with thin shim instances and replace internals once
  // the real modules arrive. Keep main.ts shape stable.
  const ioModule = await import('./io/IoSubsystems');
  const io = await ioModule.bootIoSubsystems(settings, liveValues);

  // -------------------- Sonification (audible output) --------------------
  // First audio-output feature: a single voice driven by mesh
  // statistics (and, since the audio-node-framework pass, optionally a
  // graph node's live value too — see Sonification's 'graph' mapping
  // source). Boots disabled — settings migration always forces
  // `sonification.enabled = false` regardless of saved value, so no
  // audio can leak out without an explicit user gesture. The Enable
  // toggle in the I/O panel is itself a click event (satisfies
  // browser autoplay policy); the canvas-click fallback below handles
  // the edge case where settings flip enabled=true after load
  // without any user gesture having occurred (e.g. URL-driven config).
  //
  // Constructed here, BEFORE the graph-engine factory below, and not
  // in its previous, more narrative spot further down — `sonification`
  // must exist before `ensureGraphEngine()`'s deps object literal
  // references it, and that factory can run as early as the
  // "pre-warm if persisted state requires it" call a few lines down
  // (whenever a saved session already has modMode !== 'classic'),
  // which happens well before the code that used to construct
  // `sonification` first ran. A prior version hit exactly this
  // ReferenceError-from-TDZ class of ordering bug in testing.
  const meshAnalyzer = new MeshAnalyzer();
  const sonification = new Sonification(settings.get('sonification'));
  settings.subscribe('sonification', (cfg) => sonification.applyConfig(cfg));
  // Mic-feedback gate: when the FFT analyser is running with a
  // microphone source, the mic is presumably routed to speakers and
  // the sonification voice would feed straight back. Auto-mute the
  // voice (with a status flag the UI surfaces) until the user changes
  // the audio input source or disables sonification.
  io.fft.subscribe((s) => {
    sonification.setMicFeedbackActive(s.running && s.kind === 'mic');
  });
  // Autoplay-policy fallback: if sonification ever wants to be
  // running but the AudioContext is suspended (e.g. preset URL set
  // enabled=true on load — should be impossible thanks to the
  // migration's force-off, but belt-and-braces), the next click
  // anywhere on the canvas resumes audio.
  const resumeAudioOnGesture = () => {
    void sonification.userGesture();
  };
  canvas.addEventListener('pointerdown', resumeAudioOnGesture, { passive: true });
  canvas.addEventListener('keydown', resumeAudioOnGesture);

  const matrix = new ModMatrix(settings, {
    fft:         io.fft,
    beat:        io.beat,
    midiClock:   io.midiClock,
    midiMapping: io.midiMapping,
    midiManager: io.midiManager,
    osc:         io.osc,
    cv:          io.cv,
    cvOut:       io.cvOut,
    gamepad:     io.gamepad,
    patternBus:  patternSignalBus,
    liveValues,
  });
  // Same bus for the CV output writer so 'pattern-output' channels
  // can read the published signals directly.
  io.cvOut?.setPatternBus?.(patternSignalBus);

  // VideoTap is eager — it's a tiny pair of offscreen canvases and is
  // shared between the Graph engine's `video-*` nodes AND the
  // Sonification / MeshAnalyzer pipeline. Building it up-front lets
  // sonification work even when the user never enters Graph mode.
  const videoTap = new VideoTap(video);

  // Lazy-construct the Graph engine. Classic-only users never touch the
  // import. Once built, the engine sticks around so subsequent mode
  // switches are instant.
  let graphEngine: GraphEngine | null = null;
  const ensureGraphEngine = async (): Promise<GraphEngine> => {
    if (graphEngine) return graphEngine;
    const { GraphEngine: GE } = await import('./modulation/graph/GraphEngine');
    graphEngine = new GE(settings, {
      fft:         io.fft,
      beat:        io.beat,
      midiClock:   io.midiClock,
      midiMapping: io.midiMapping,
      midiManager: io.midiManager,
      osc:         io.osc,
      cv:          io.cv,
      cvOut:       io.cvOut,
      gamepad:     io.gamepad,
      patternBus:  patternSignalBus,
      videoTap,
      liveValues,
      sonification,
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
  // File → Load Sample Patch: same "clone, set modGraph, tell the engine"
  // sequence as the Graph-view Library sidebar's loadPatch() (no separate
  // codepath for the top-bar entry point). Classic-only users get bumped
  // to 'both' so the patch they just asked to load is actually audible/
  // visible — 'both' rather than 'graph' because Classic slots keep
  // working too (coexistence, not replacement).
  const loadSamplePatch = async (sp: StarterPatch): Promise<void> => {
    // Loading REPLACES the whole graph patch — warn when one exists
    // (owner: prompt to keep or erase, never silently blow a patch
    // away). OK = replace, Cancel = keep what's there.
    const cur = settings.get('modGraph');
    if (cur && cur.nodes.length > 0 && !confirm(
      `Load “${sp.name}”?\n\nThis replaces your current graph patch `
      + `(${cur.nodes.length} node${cur.nodes.length === 1 ? '' : 's'}). `
      + 'OK to replace it — Cancel to keep what you have.\n\n'
      + 'Tip: Graph editor → Library → Save Current keeps a copy first.',
    )) return;
    const clone = JSON.parse(JSON.stringify(sp.patch)) as GraphPatch;
    if (settings.get('modMode') === 'classic') settings.set('modMode', 'both');
    settings.set('modGraph', clone);
    const e = await ensureGraphEngine();
    e.setPatch(clone);
    settings.set('panelTab', 'synth');
    const modSection = panel.getSection('Modulation');
    modSection?.classList.remove('collapsed');
    modSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  // Pre-warm if persisted state requires it.
  if (settings.get('modMode') !== 'classic') void ensureGraphEngine();
  settings.subscribe('modMode', (m) => { if (m !== 'classic') void ensureGraphEngine(); });

  // -------------------- Pattern Generator: scope sampler --------------------
  // Installed AFTER io / matrix / graph-engine factory exist so the
  // sampler closures have stable refs. Allocated once: scratch buffer
  // for audio time-domain frames so we don't allocate inside the loop.
  const SCOPE_AUDIO_BUF = new Float32Array(1024);
  patternRenderer.setScopeSampler((buf: OscilloscopeBuffer, kind, ref) => {
    switch (kind) {
      case 'audio': {
        // FFTAnalyzer fills SCOPE_AUDIO_BUF with -1..1 samples; if the
        // analyser isn't running it zeros the buffer (still a valid
        // "flat line" trace).
        io.fft.getTimeDomain(SCOPE_AUDIO_BUF);
        buf.writeBlock(SCOPE_AUDIO_BUF);
        break;
      }
      case 'classic-slot': {
        // ref is a 1-based slot number ('1'..'4'). Default to slot 1.
        const idx = Math.max(0, Math.min(3, (parseInt(ref, 10) || 1) - 1));
        buf.pushSample(matrix.getSlotValue(idx));
        break;
      }
      case 'graph-node': {
        // ref shape: '<nodeId>' or '<nodeId>:<port>'. Default port 'out'.
        if (!graphEngine) { buf.pushSample(0); break; }
        const colon = ref.indexOf(':');
        const nodeId = colon >= 0 ? ref.slice(0, colon) : ref;
        const port   = colon >= 0 ? ref.slice(colon + 1) : 'out';
        buf.pushSample(graphEngine.probe(nodeId, port));
        break;
      }
      case 'settings-param': {
        buf.pushSample(liveValues.getLive(ref));
        break;
      }
      case 'beat': {
        buf.pushSample(io.beat.pulse);
        break;
      }
      default:
        buf.pushSample(0);
    }
  });

  // -------------------------- Sequencer + dock ---------------------------
  const seqModule    = await import('./sequencer/Sequencer');
  const seqStore     = await import('./sequencer/store');
  const sequencer = new seqModule.Sequencer(settings);
  sequencer.attachMidiClock(io.midiClock);
  // Keyframing v2: lanes contribute relative offsets through the shared
  // LiveValuesStore ('timeline' namespace) — third writer beside the
  // Classic and Graph engines.
  sequencer.setLiveValues(liveValues);
  sequencer.onKeyframeReached = () => haptic('tap');
  // Persist structural timeline edits here, not in the dock: the dock is
  // lazy (and never mounts on compact), but lane edits from the panel
  // diamonds must survive a reload regardless.
  sequencer.addTimelineListener((t) => {
    if (t) seqStore.upsertTimeline(t);
  });
  // Panel keyframe diamonds (◆) observe the sequencer from here on.
  keyframeAffordance.registerSequencer(sequencer);

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
  const stereoMetaMod = await import('./record/StereoMetadata');
  const recorder = new recordMod.CanvasRecorder(
    canvas,
    sonification,
    stereoMetaMod.injectStereoscopicMetadata,
    source,  // VideoAudioCapture — duck-typed via getCaptureStream()
    () => source.getState().stream?.getVideoTracks()[0] ?? null, // pairs "Camera's microphone"
  );
  const broadcastMod = await import('./stream/Broadcaster');
  const broadcaster = new broadcastMod.Broadcaster(sonification);
  const { WhipPublisher } = await import('./stream/WhipPublisher');
  const whipPublisher = new WhipPublisher(sonification);

  // Stereoscopic recording compositor (v12). Owns its own offscreen
  // canvas + secondary WebGLRenderer; shares the scene and reads the
  // live `cameraRig.camera` pose each frame. Constructed eagerly so
  // the Record section can probe it for presence — the GL context
  // is created in the constructor but stays idle until `start()`.
  const stereoCompositor = new (await import('./record/StereoCompositor')).StereoCompositor({
    scene: ruttEtra.scene,
    sourceCamera: cameraRig.camera,
    meshGroup: ruttEtra.group,
    settings,
    live: liveValues,
  });
  // Recompute world-IPD whenever the slider moves so a preview or
  // running session re-frames in place. No-op when not active.
  liveValues.subscribe('stereoIpdCm', () => stereoCompositor.refreshIpd());

  // Anaglyph renderer (v16). Lazily instantiated on first enable so the
  // AnaglyphEffect module (including its GLSL shaders and render targets)
  // doesn't load until the user actually turns the mode on. The instance
  // is reused across enable/disable cycles — dispose() is only called
  // when the page unloads.
  let anaglyphRenderer: import('./renderer/AnaglyphRenderer').AnaglyphRenderer | null = null;
  async function getAnaglyphRenderer() {
    if (!anaglyphRenderer) {
      const { AnaglyphRenderer } = await import('./renderer/AnaglyphRenderer');
      anaglyphRenderer = await AnaglyphRenderer.create(renderer, ruttEtra.group, canvas.clientWidth, canvas.clientHeight);
      anaglyphRenderer.setIpd(liveValues.getLive('anaglyphIpdCm'));
    }
    return anaglyphRenderer;
  }
  // Propagate IPD changes immediately if the renderer is already alive.
  liveValues.subscribe('anaglyphIpdCm', (cm) => anaglyphRenderer?.setIpd(cm));
  // Warm up on first enable so there's no one-frame hitch.
  settings.subscribe('anaglyphEnabled', (enabled) => {
    if (enabled) void getAnaglyphRenderer();
  });
  // Resize internal render targets whenever the canvas changes size.
  window.addEventListener('resize', () => {
    if (anaglyphRenderer) {
      // Use the drawing-buffer size that ResolutionManager has already applied.
      anaglyphRenderer.setSize(canvas.clientWidth, canvas.clientHeight);
    }
  });
  // Pre-warm when the setting is already on (e.g. loaded from saved preset).
  if (settings.get('anaglyphEnabled')) void getAnaglyphRenderer();

  // Preview state — a simple expiring timer that main.ts's render
  // loop reads each frame. When active, the loop swaps the postfx
  // path for `compositor.renderPreviewTo(renderer, w, h)` so the
  // user sees the side-by-side composite on the visible canvas.
  let stereoPreviewExpiresAt = 0;
  const stereoPreview = {
    isActive: () => performance.now() < stereoPreviewExpiresAt,
    start: (durationMs: number) => {
      stereoPreviewExpiresAt = performance.now() + durationMs;
    },
  };

  video.addEventListener('loadedmetadata', () => {
    ruttEtra.attachVideo();
  });
  // The overlay is a one-time welcome screen, not a persistent "no source"
  // indicator. Once dismissed (by connecting any source or clicking skip) it
  // never re-shows — the HUD line already reports the active source state.
  // Its version line shares the panel title bar's build stamp source, so
  // "is the deployed page fresh?" is answerable from the landing screen.
  const bootVersion = document.getElementById('boot-version');
  if (bootVersion) {
    bootVersion.textContent =
      `v${__BUILD_INFO__.version} · ${__BUILD_INFO__.commit} · ${__BUILD_INFO__.builtAt}`;
  }
  let overlayDismissed = false;
  /** Fade the landing screen out. With `waitForFrame`, hold it until the source video has a
   *  frame to show (≤1.5 s), so the fade reveals the picture rather than black-then-pop. */
  function dismissOverlay(waitForFrame = false): void {
    overlayDismissed = true;
    if (!waitForFrame || video.readyState >= 2) { overlay.classList.add('hidden'); return; }
    let done = false;
    const go = (): void => {
      if (done) return;
      done = true;
      video.removeEventListener('loadeddata', go);
      // A frame or two for the texture to upload and the raster to draw.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (overlayDismissed) overlay.classList.add('hidden');
      }));
    };
    video.addEventListener('loadeddata', go);
    setTimeout(go, 1500);
  }
  /** Bring the "select a source" screen back (File ▸ New Project). */
  function showOverlay(): void {
    overlayDismissed = false;
    overlay.classList.remove('hidden');
    resize(); // re-pin it over the canvas's current rect
  }
  // Whatever surface starts the picture (boot buttons, Controls, Patch Bay, MCP),
  // the landing screen fades out and the raster fades in beneath it.
  source.subscribe((st) => {
    if (st.kind !== 'none' && !overlayDismissed) dismissOverlay(true);
  });
  settings.subscribe('patternEnabled', (on) => {
    if (on && !overlayDismissed) dismissOverlay();
  });
  // Phone: the raster follows the picture's own shape (a portrait selfie fills
  // the portrait screen instead of sitting in a 4:3 letterbox). Once per new
  // source size, so the user's own Aspect edits afterwards stick; desktop keeps
  // the hardware-authentic 4:3 until they press DCU ▸ Match source.
  let lastAutoAspect = '';
  source.subscribe((st) => {
    if (layout.current() !== 'compact' || (st.kind !== 'webcam' && st.kind !== 'file')) return;
    const a = aspectForSource(st.width, st.height);
    const tag = `${st.kind}:${st.width}x${st.height}`;
    if (a == null || tag === lastAutoAspect) return;
    lastAutoAspect = tag;
    settings.set('aspect', a);
  });

  // ---------------------- Video audio passthrough -----------------------
  // Propagate videoAudioEnabled / videoAudioVolume settings to the video
  // element whenever either key changes. Both keys force `muted = true` on
  // page load (migration), so no sound plays without an explicit toggle.
  function applyVideoAudio() {
    source.setAudio(
      settings.get('videoAudioEnabled'),
      liveValues.getLive('videoAudioVolume'),
    );
  }
  settings.subscribe('videoAudioEnabled', applyVideoAudio);
  liveValues.subscribe('videoAudioVolume', applyVideoAudio);
  applyVideoAudio();

  // -------------------------- Project save/load -------------------------
  // The "save your work" feature. Owns:
  //   - the active project's name + dirty flag (Settings.subscribeAll
  //     drives the dirty bit; explicit `markDirty()` covers preset /
  //     timeline edits that don't pass through Settings),
  //   - the recent-projects list (localStorage; FileSystemFileHandle
  //     when supported),
  //   - file ops: New / Open / Save / Save As / OpenRecent (uses the
  //     FS Access API on Chromium, falls back to download/upload).
  //
  // First-launch packaging: if pre-Project session state exists in
  // the legacy localStorage keys, wrap it as an auto-save payload
  // named "Recovered Session" so the user can recover it on next
  // load. One-shot, gated by `ruttetra.project.recoveredAt`.
  maybePackageRecoveredSession();

  const USER_PRESETS_KEY = 'ruttetra.userPresets.v1';
  const TIMELINES_KEY    = 'ruttetra.timelines.v1';
  const projectStore = new ProjectStore({
    settings,
    getUserPresets: () => {
      try {
        const raw = localStorage.getItem(USER_PRESETS_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch { return []; }
    },
    setUserPresets: (list) => {
      try { localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
    },
    // Timelines bypass the seqStore.autoPersist gate the same way
    // exportEverything does — saved projects always include
    // whatever's in the in-memory + persisted set, and loading a
    // project always replaces both.
    getTimelines: () => {
      const persisted = (() => {
        try {
          const raw = localStorage.getItem(TIMELINES_KEY);
          return raw ? JSON.parse(raw) : [];
        } catch { return []; }
      })();
      const current = sequencer.timeline;
      if (current && !persisted.find((t: { id: string }) => t.id === current.id)) {
        return [current, ...persisted];
      }
      return persisted;
    },
    setTimelines: (list, activeId) => {
      try { localStorage.setItem(TIMELINES_KEY, JSON.stringify(list)); } catch { /* ignore */ }
      if (activeId) {
        const tl = list.find((x) => x.id === activeId);
        if (tl) {
          sequencer.load(tl);
        } else {
          // activeId specified but not found — unload
          sequencer.load(null);
        }
      } else {
        // No activeId (new project / cleared state) — unload
        sequencer.load(null);
      }
    },
    getActiveTimelineId: () => sequencer.timeline?.id ?? null,
    // Panel/help UI state (tab switches, the first-run Help auto-open)
    // isn't an edit to the work — it must not put a "*" in the title.
    subscribeAllSettings: (fn) => settings.subscribeAll((_v, key) => {
      if (!UI_STATE_KEY_SET.has(key)) fn();
    }),
  });
  const autoSave = new AutoSave(projectStore);

  // Live camera capture on save: before serializing, push the
  // current camera into `settings.defaultView` so the project
  // file restores the camera the user is actually looking at,
  // not whatever the loaded preset's saved view was.
  {
    const origSnapshot = projectStore.snapshot.bind(projectStore);
    projectStore.snapshot = (name: string, description?: string) => {
      cameraRig.saveDefaultView();
      return origSnapshot(name, description);
    };
  }

  // Document title reflects project state — "Project Name * — RUTT/ETRA"
  // when modified, "Project Name — RUTT/ETRA" when saved, or just
  // "RUTT/ETRA - Web Video Synthesizer" when no project is open.
  const BASE_TITLE = 'RUTT/ETRA WEB - Video Synthesizer';
  projectStore.subscribe((s) => {
    if (s.name) {
      document.title = `${s.name}${s.dirty ? ' *' : ''} — RUTT/ETRA WEB`;
    } else if (s.dirty) {
      document.title = `Untitled * — RUTT/ETRA WEB`;
    } else {
      document.title = BASE_TITLE;
    }
  });

  // Boot-time recovery prompt. If the previous session had unsaved
  // changes (auto-save) or this is the first launch with the
  // Recovered Session migration above, surface a single prompt.
  // Deferred until after the panel is built so the toast can land.
  const pendingRecovery = AutoSave.loadPending();

  // beforeunload — flush a recovery snapshot whenever there are unsaved changes, so a refresh,
  // crash or accidental close always offers Restore / Clear on the next load (owner: losing a
  // Patch Bay session on refresh is worse than the prompt). Synchronous only. The Auto-save
  // toggle adds periodic snapshots on top; this one is unconditional.
  window.addEventListener('beforeunload', () => {
    if (projectStore.getState().dirty) autoSave.tick();
  });

  // Project file actions — ONE implementation each, registered in the
  // app-wide action registry (src/ui/actions.ts). The Ctrl+N/O/S
  // shortcuts below and the File menu both dispatch through these ids,
  // so the save-with-prompt dance exists exactly once.
  const { registerActions, runAction } = await import('./ui/actions');
  const saveAsWithPrompt = (): void => {
    const name = window.prompt('Project name:', projectStore.getState().name ?? `Project ${new Date().toLocaleDateString()}`);
    if (name != null) void projectStore.saveAs(name).then((ok) => {
      if (ok) AutoSave.clearPending();
    });
  };
  registerActions([
    {
      id: 'file.new', label: 'New Project', shortcut: 'Ctrl+N',
      run: () => {
        const cur = projectStore.getState();
        if (cur.dirty && !confirm('Unsaved changes will be lost. Continue?')) return;
        projectStore.newProject();
        AutoSave.clearPending();
        // A new project starts from nothing: release the camera/file/stream
        // on both inputs and show the source picker again (owner ask).
        source.stop();
        sourceB.stop();
        showOverlay();
      },
    },
    {
      id: 'file.open', label: 'Open Project…', shortcut: 'Ctrl+O',
      run: () => {
        const cur = projectStore.getState();
        if (cur.dirty && !confirm('Unsaved changes will be lost. Continue?')) return;
        if (cur.hasFsAccess) void projectStore.openWithPicker();
      },
    },
    {
      id: 'file.save', label: 'Save Project', shortcut: 'Ctrl+S',
      run: () => {
        const cur = projectStore.getState();
        if (!cur.name) saveAsWithPrompt();
        else void projectStore.saveToCurrent().then((ok) => {
          if (ok) AutoSave.clearPending();
        });
      },
    },
    { id: 'file.saveAs', label: 'Save Project As…', shortcut: 'Ctrl+Shift+S', run: saveAsWithPrompt },
  ]);

  window.addEventListener('keydown', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey)) return;
    const k = ev.key.toLowerCase();
    if (k === 's') {
      ev.preventDefault();
      runAction(ev.shiftKey ? 'file.saveAs' : 'file.save');
    } else if (k === 'o') {
      ev.preventDefault();
      runAction('file.open');
    } else if (k === 'n') {
      ev.preventDefault();
      runAction('file.new');
    }
  });

  // Suppress the browser's native middle-click autoscroll gesture
  // app-wide (owner: "third button mouse too") — without this, a
  // middle-click anywhere the Patch Bay doesn't already
  // `preventDefault()` its own pan handler would trigger the OS's own
  // all-scroll cursor/mode, breaking the custom cursor design outside
  // the one surface that already suppresses it locally.
  window.addEventListener('mousedown', (ev) => { if (ev.button === 1) ev.preventDefault(); });

  // -------------------------- UI panel ---------------------------------
  const panel = new ControlPanel(panelHost, settings);

  // Rack skin's patch-cable layer — inert unless the skin is 'rack'
  // (subscribes to skin.ts; sections that mount later are picked up by
  // its MutationObserver, so order here doesn't matter).
  {
    const { createRackLayer } = await import('./ui/rack/RackLayer');
    createRackLayer(panelHost, settings, ensureGraphEngine);
  }

  // Workspace regions (v29): the side/dock shells each get a view
  // switcher; the dock region is wired later by ensureTimelineDock
  // (the TimelineDock's build() wipes the shell's children).
  const { createWorkspace } = await import('./ui/workspace/Workspace');
  const workspace = createWorkspace({
    settings,
    canvas,
    centerShell: document.getElementById('rw-center-shell') as HTMLElement,
    leftShell: document.getElementById('rw-left-shell') as HTMLElement,
    panelShell: panelHost,
    panelViewEl: panel.viewRoot,
  });

  // Patch Bay view — its own chunk, registered once loaded (a stored
  // 'patchbay' region assignment re-hosts as soon as it lands).
  void (async () => {
    const { createPatchBayView } = await import('./ui/patchbay/PatchBayView');
    // Factory: the bay is multi-instance — every window that tabs it
    // gets its own independent instance (all reading the same Settings).
    workspace.registerView('patchbay', () => createPatchBayView(settings, source, ensureGraphEngine, sourceB, patternRenderer,
      (i) => createGeneratorCard(settings, matrix, i, io.cv, io.gamepad)));
  })();

  // Two-screen popout (v19): move the whole control panel into its own
  // window so output can go fullscreen on a second display. Same JS
  // context — no state sync needed. Desktop feature; the button simply
  // does nothing if the popup is blocked.
  let panelPopoutCtl: { toggle(): void; isOpen(): boolean } | null = null;
  let renderPopoutCtl: { toggle(): void; isOpen(): boolean } | null = null;
  {
    const { createPanelPopout } = await import('./ui/PanelPopout');
    // No title-bar button: the Controls window's own ⧉ and Window ▸ Pop
    // out Controls run this (one control per job, owner 2026-10-15).
    const popout = createPanelPopout(panelHost, (open) => {
      // While the panel lives in the popup the main window has no panel
      // footprint — let the timeline dock reclaim the full width. On
      // pop-in the panel recomputes its insets.
      if (open) {
        // The panel's own side only — the other inset belongs to the other window.
        document.documentElement.style.setProperty(settings.get('panelDock') === 'left' ? '--rw-panel-inset-left' : '--rw-panel-inset-right', '0px');
      } else {
        panel.refreshInset();
      }
      // Popout wins over region assignments: while the panel shell
      // lives in the popup, force default hosting (transient — no
      // Settings writes), restore the arrangement on pop-in.
      workspace.onPanelPopout(open);
    });
    panelPopoutCtl = popout;
  }

  // Render-canvas popout: the OUTPUT side of the same two-screen rig —
  // pop the live output into its own draggable window (a captured
  // MediaStream, not the canvas itself — see RenderPopout.ts for why),
  // which carries its own fullscreen toggle for "seamless" projector use.
  {
    const { createRenderPopout } = await import('./renderer/RenderPopout');
    // No title-bar button: the Renderer window's ⧉ and Window ▸ Pop out
    // Output run this.
    const renderPopout = createRenderPopout(canvas, () => { /* state shown by the window itself */ }, {
      // Host both source videos in the output window while it's open, so
      // they keep playing when fullscreen hides this one (RenderPopout.ts).
      videos: [video, videoB],
      onMoved: () => {
        ruttEtra.attachVideo();
        if (videoB.readyState >= 1) attachVideoB();
      },
    });
    renderPopoutCtl = renderPopout;
  }

  // Panel-wide param search + tab hotkeys (v19, AUDIT item 26). `/`
  // focuses the search, 1/2/3 switch panel tabs — both only when the
  // keystroke isn't going into a text field.
  const { createPanelSearch, isTypingTarget } = await import('./ui/PanelSearch');
  const panelSearch = createPanelSearch(panelHost, settings);
  panel.addBeforeTabs(panelSearch.el);
  // View toggles shared by the `F`/`H` shortcuts and the View menu.
  registerActions([
    {
      id: 'view.fullscreen', label: 'Fullscreen', shortcut: 'F',
      // Distinct from the render popout's own `F`, which is scoped to
      // that separate window.
      run: () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => {});
      },
      checked: () => !!document.fullscreenElement,
    },
    {
      id: 'view.hud', label: 'HUD (FPS / source)', shortcut: 'H',
      run: () => settings.set('hudVisible', !settings.get('hudVisible')),
      checked: () => !!settings.get('hudVisible'),
    },
  ]);
  // Global legibility control (owner request: some users find the
  // default text hard to read). Purely a presentation preference
  // (localStorage, like the skin) — never changes the default for
  // anyone who hasn't touched it, never rides into a saved project.
  {
    const { increaseTextScale, decreaseTextScale, resetTextScale, getTextScale } = await import('./ui/textScale');
    registerActions([
      {
        id: 'view.textScaleIncrease', label: 'Text Size: Increase', shortcut: 'Ctrl+=',
        run: () => increaseTextScale(),
      },
      {
        id: 'view.textScaleDecrease', label: 'Text Size: Decrease', shortcut: 'Ctrl+-',
        run: () => decreaseTextScale(),
      },
      {
        id: 'view.textScaleReset', label: 'Text Size: Reset', shortcut: 'Ctrl+0',
        run: () => resetTextScale(),
        enabled: () => getTextScale() !== 1,
      },
    ]);
    window.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || isTypingTarget(e.target)) return;
      if (e.key === '=' || e.key === '+') { e.preventDefault(); runAction('view.textScaleIncrease'); }
      else if (e.key === '-') { e.preventDefault(); runAction('view.textScaleDecrease'); }
      else if (e.key === '0') { e.preventDefault(); runAction('view.textScaleReset'); }
    });
  }
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
    if (e.key === '/') { e.preventDefault(); panelSearch.focus(); return; }
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); runAction('view.fullscreen'); return; }
    if (e.key === 'h' || e.key === 'H') { e.preventDefault(); runAction('view.hud'); return; }
    // [ / ] cycle panel tabs. Deliberately NOT digit keys: the About
    // reference reserves 1-9 for preset snapshot slots.
    if (e.key === '[' || e.key === ']') {
      const order: Array<'synth' | 'io' | 'help'> = ['synth', 'io', 'help'];
      const cur = order.indexOf(settings.get('panelTab') ?? 'synth');
      const next = (cur + (e.key === ']' ? 1 : order.length - 1)) % order.length;
      settings.set('panelTab', order[next]);
    }
  });

  // ------------------------- App menu bar -------------------------------
  // File / Edit / View / Window / Help along the top. Every item runs an
  // action from the shared registry (or a module function directly) —
  // no menu-only logic beyond tiny download/upload wrappers.
  {
    const { createMenuBar } = await import('./ui/menu/MenuBar');
    const { getTextScale } = await import('./ui/textScale');
    const { getSkin, setSkin } = await import('./ui/skin');
    const { getTheme, setTheme } = await import('./ui/theme');
    registerActions([
      { id: 'view.theme.modern', label: 'Theme: Modern', run: () => setTheme('modern'), checked: () => getTheme() === 'modern' },
      { id: 'view.theme.phosphor', label: 'Theme: Classic (phosphor CRT)', run: () => setTheme('phosphor'), checked: () => getTheme() === 'phosphor' },
    ]);
    const { exportEverything, importEverything } = await import('./state/exportEverything');
    const download = (name: string, text: string): void => {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    };
    const pickFile = (onText: (text: string) => void): void => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'application/json,.json';
      inp.addEventListener('change', async () => {
        const f = inp.files?.[0];
        if (f) onText(await f.text());
      });
      inp.click();
    };
    registerActions([
      {
        id: 'file.exportEverything', label: 'Export Everything…',
        run: () => download(`ruttetra-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, exportEverything()),
      },
      {
        id: 'file.importEverything', label: 'Import Everything…',
        run: () => pickFile((text) => {
          if (!confirm('Import will overwrite local settings, user presets, and timelines. Continue?')) return;
          try { importEverything(text); } catch (e) { alert(`Import failed: ${(e as Error).message}`); }
        }),
      },
      {
        id: 'edit.undo', label: 'Undo (Timeline)', shortcut: 'Ctrl+Z',
        run: () => sequencer.undo(),
        enabled: () => sequencer.canUndo(),
      },
      {
        id: 'edit.redo', label: 'Redo (Timeline)', shortcut: 'Ctrl+Y',
        run: () => sequencer.redo(),
        enabled: () => sequencer.canRedo(),
      },
      {
        id: 'window.panelPopout', label: 'Pop Out Controls',
        run: () => panelPopoutCtl?.toggle(),
        checked: () => !!panelPopoutCtl?.isOpen(),
      },
      {
        id: 'window.renderPopout', label: 'Pop Out Output',
        run: () => renderPopoutCtl?.toggle(),
        checked: () => !!renderPopoutCtl?.isOpen(),
      },
      {
        id: 'help.manual', label: 'Open Manual (About page)',
        run: () => { window.open('./about.html', '_blank'); },
      },
      {
        id: 'help.videoTutorials', label: 'Video Tutorials',
        run: () => { window.open('./tutorials.html', '_blank'); },
      },
      {
        id: 'help.designSystem', label: 'Design System',
        run: () => { window.open('./designsystem.html', '_blank'); },
      },
      {
        id: 'help.startTutorial', label: 'Start Tutorial',
        run: async () => {
          const [{ startTutorial }, { buildTutorialSteps }] = await Promise.all([
            import('./ui/tutorial/Tutorial'),
            import('./ui/tutorial/tutorialSteps'),
          ]);
          startTutorial(buildTutorialSteps({ settings, panel, loadSamplePatch }));
        },
      },
      {
        id: 'help.startPatchTutorial', label: 'Patch Bay Tutorial',
        run: async () => {
          const [{ startTutorial }, { buildPatchBayTutorialSteps }] = await Promise.all([
            import('./ui/tutorial/Tutorial'),
            import('./ui/tutorial/tutorialStepsPatchBay'),
          ]);
          startTutorial(buildPatchBayTutorialSteps({
            showPatchBay: () => {
              // The default 4-up layout docks the bay in the LEFT window;
              // re-applying it guarantees a bay instance is on-screen in
              // THIS document (a popped-out bay can't host the spotlight).
              const state = workspace.getState();
              const bayVisible = Object.values(state.active).includes('patchbay');
              if (!bayVisible) workspace.applyPreset('default');
            },
            // Same node+companion-binding+mode-guard+two-write sequence
            // the bay's own right-click Add Node uses (and Beginner's
            // "+ Add patch") — a tutorial-sized copy so the step works
            // regardless of which bay instance is showing.
            addNode: (type) => {
              const patch = settings.get('modGraph') ?? { nodes: [], bindings: [] };
              const def = getDef(type);
              const inputs: Record<string, string | null> = {};
              for (const p of def?.inputs ?? []) inputs[p.name] = null;
              const nodeId = `n${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
              const next: GraphPatch = {
                nodes: [...patch.nodes, { id: nodeId, type, params: {}, inputs }],
                bindings: [...patch.bindings, {
                  id: `b${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
                  paramKey: 'none', sourceNodeId: nodeId, amount: 0.25, mode: 'additive',
                }],
              };
              if (settings.get('modMode') === 'classic') settings.set('modMode', 'both');
              settings.set('modGraph', next);
              void ensureGraphEngine().then((e) => e.setPatch(next));
            },
          }));
        },
      },
      {
        id: 'help.about', label: 'About RUTT/ETRA WEB…',
        run: () => {
          const overlay = document.createElement('div');
          overlay.className = 'rw-about-dialog';
          const card = document.createElement('div');
          card.className = 'rw-about-dialog-card';
          card.innerHTML = `
            <h2>RUTT/ETRA WEB</h2>
            <p>Web recreation of the 1973 Rutt/Etra Scan Processor.</p>
            <p>v${__BUILD_INFO__.version} · ${__BUILD_INFO__.commit}</p>
            <p class="dim">Built ${__BUILD_INFO__.builtAt}</p>`;
          overlay.appendChild(card);
          overlay.addEventListener('click', () => overlay.remove());
          document.addEventListener('keydown', function esc(e) {
            if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); }
          });
          document.body.appendChild(overlay);
        },
      },
    ]);
    const helpTab = (id: string, label: string) => ({
      label,
      run: () => {
        settings.set('panelTab', 'help');
        settings.set('helpActiveTab', id as never);
      },
    });
    const skinRadio = (id: 'standard' | 'hardware' | 'rack', label: string) => ({
      label,
      run: () => setSkin(id),
      checked: () => getSkin() === id,
    });
    const menubar = createMenuBar([
      {
        label: 'FILE',
        hint: 'Project files: new, open, save, recent list, whole-workspace backup.',
        items: () => [
          { actionId: 'file.new' },
          { actionId: 'file.open' },
          {
            label: 'Open Recent',
            submenu: () => {
              const recent = projectStore.getState().recent.slice(0, 8);
              if (!recent.length) return [{ label: '(empty)', enabled: () => false }];
              return [
                ...recent.map((r) => ({
                  label: r.name || '(untitled)',
                  run: () => {
                    const cur = projectStore.getState();
                    if (cur.dirty && !confirm('Unsaved changes will be lost. Continue?')) return;
                    void projectStore.openRecent(r);
                  },
                })),
                { sep: true as const },
                { label: 'Clear Recent', run: () => projectStore.clearRecent() },
              ];
            },
          },
          { sep: true },
          {
            label: 'Load Sample Patch',
            submenu: () => STARTER_PATCHES.map((sp) => ({
              label: sp.name,
              run: () => void loadSamplePatch(sp),
            })),
          },
          { sep: true },
          { actionId: 'file.save' },
          { actionId: 'file.saveAs' },
          { sep: true },
          { actionId: 'file.exportEverything' },
          { actionId: 'file.importEverything' },
        ],
      },
      {
        label: 'EDIT',
        hint: 'Undo/redo for timeline edits (scene keyframes, lanes).',
        items: () => [
          { actionId: 'edit.undo' },
          { actionId: 'edit.redo' },
        ],
      },
      {
        label: 'VIEW',
        hint: 'Skins, themes, HUD, fullscreen, and panel/timeline docking.',
        items: () => [
          skinRadio('standard', 'Skin: CRT (flat)'),
          skinRadio('hardware', 'Skin: Hardware'),
          skinRadio('rack', 'Skin: Rack (patch cables)'),
          { sep: true },
          { actionId: 'view.theme.phosphor' },
          { actionId: 'view.theme.modern' },
          { sep: true },
          { actionId: 'view.hud' },
          { actionId: 'view.fullscreen' },
          { sep: true },
          {
            label: 'Text Size',
            submenu: () => [
              { label: `Current: ${Math.round(getTextScale() * 100)}%`, enabled: () => false },
              { sep: true },
              { actionId: 'view.textScaleIncrease' },
              { actionId: 'view.textScaleDecrease' },
              { actionId: 'view.textScaleReset' },
            ],
          },
          { sep: true },
          {
            label: 'Timeline: Top',
            run: () => settings.set('timelineDock', 'top'),
            checked: () => settings.get('timelineDock') === 'top',
          },
          {
            label: 'Timeline: Bottom',
            run: () => settings.set('timelineDock', 'bottom'),
            checked: () => settings.get('timelineDock') === 'bottom',
          },
          {
            label: 'Timeline: Hidden',
            run: () => settings.set('timelineDock', 'hidden'),
            checked: () => settings.get('timelineDock') === 'hidden',
          },
        ],
      },
      {
        label: 'WINDOW',
        hint: 'Pop-out windows, per-window views, layout presets, Reset Layout.',
        items: () => {
          return [
            { actionId: 'window.panelPopout' },
            { actionId: 'window.renderPopout' },
            { sep: true as const },
            {
              label: 'Layout',
              submenu: () => [
                { label: 'Default (4-up: controls left, output center)', run: () => workspace.applyPreset('default') },
                { label: 'Simple (no left window)', run: () => workspace.applyPreset('classic') },
                { label: 'Tall (everything in one column)', run: () => workspace.applyPreset('tall') },
                { label: 'Wide (tall bottom strip)', run: () => workspace.applyPreset('wide') },
                { label: 'Performance (output maximized)', run: () => workspace.applyPreset('performance') },
                { label: 'Patch Bay (bay center, output docked)', run: () => workspace.applyPreset('patchbay') },
              ],
            },
            { label: 'Reset Layout', run: () => workspace.applyPreset('default') },
          ];
        },
      },
      {
        label: 'HELP',
        hint: 'Quick start, shortcuts, the full manual, and the About box.',
        items: () => [
          helpTab('quickstart', 'Quick Start'),
          helpTab('controls', 'Controls Reference'),
          helpTab('shortcuts', 'Keyboard Shortcuts'),
          { sep: true },
          { actionId: 'help.startTutorial' },
          { actionId: 'help.startPatchTutorial' },
          { actionId: 'help.manual' },
          { actionId: 'help.videoTutorials' },
          { actionId: 'help.designSystem' },
          { actionId: 'help.about' },
        ],
      },
    ]);
    menubar.el.classList.add('rw-zoomchrome');
    document.getElementById('app')?.appendChild(menubar.el);
  }

  // Tiny ad-hoc toast for project events. Auto-dismisses after 4s.
  // Lives in the DOM only when a message is up — no permanent fixture.
  function projectToast(msg: string): void {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:48px', 'transform:translateX(-50%)',
      'background:rgba(20,30,20,0.92)', 'color:#cfeacf',
      'border:1px solid rgba(160,200,160,0.35)', 'border-radius:6px',
      'padding:10px 14px', 'font-size:13px', 'font-family:VT323,monospace',
      'z-index:1000', 'pointer-events:none', 'max-width:80vw', 'text-align:center',
      'box-shadow:0 4px 20px rgba(0,0,0,0.4)',
    ].join(';');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  // XR uses the same toast surface as Project — wired here so the
  // late-defined `projectToast` is reachable from the early-constructed
  // `xrManager` via the captured `xrToastImpl` reference.
  xrToastImpl = projectToast;

  // The Project section sits at the top of the synth tab — it's
  // the "save your work" entry point. Built lazily to avoid pulling
  // the FS Access glue into the initial bundle when a user never
  // saves a project.
  void (async () => {
    const psMod = await import('./ui/sections/ProjectSection');
    panel.addSection({
      tab: 'synth', title: 'Project', pinTop: true,
      body: psMod.createProjectSection({ projectStore, autoSave, toast: projectToast }),
    });
  })();

  // Boot-time recovery prompt. Defer one frame so the panel finishes
  // mounting before the alert / confirm fires.
  // Only the top-level window asks: an embedded instance (an iframe preview) must not pop a
  // blocking dialog over its host page, or consume the snapshot the real window should offer.
  if (pendingRecovery && window.top === window) {
    setTimeout(() => {
      const age = AutoSave.formatAge(pendingRecovery.writtenAt);
      const ok = confirm(
        `Restore your previous session "${pendingRecovery.projectName}" (${age})?\n\n` +
        'OK restores it. Cancel clears it and starts fresh.',
      );
      if (ok) {
        projectStore.openFromText(pendingRecovery.json, pendingRecovery.projectName)
          .then((s) => {
            if (s) projectToast(describeSummary(s));
          })
          .catch((err: Error) => projectToast(`Recovery failed: ${err.message}`))
          .finally(() => AutoSave.clearPending());
      } else {
        AutoSave.clearPending();
      }
    }, 250);
  }

  panel.addSection({ tab: 'synth', title: 'Video Source A',        body: createSourceSection(settings, source) });
  panel.addSection({ tab: 'synth', title: 'Video Source B',        body: createSourceBSection(settings, sourceB) });
  panel.addSection({ tab: 'synth', title: 'Display Control Unit',  body: createDcuSection(settings, rasterSourceSize) });
  panel.addSection({ tab: 'synth', title: 'Dual Raster',           body: createDualRasterSection(settings) });
  panel.addSection({ tab: 'synth', title: 'Virtual Camera',        body: createCameraSection(settings, cameraRig) });
  panel.addSection({ tab: 'synth', title: 'XR',                    body: createXrSection(settings, xrManager) });
  panel.addSection({ tab: 'synth', title: 'Color / Post FX',       body: createColorPostFxSection(settings) });
  panel.addSection({ tab: 'synth', title: 'Modulation',            body: createModulationContainerSection({ settings, matrix, liveValues, cv: io.cv, gamepad: io.gamepad, getEngine: ensureGraphEngine, getVideoTap: () => videoTap }) });
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
          micDeviceId: settings.get('recordMicDeviceId'),
          preferredFormat: settings.get('recordPreferredFormat'),
          engine: settings.get('recordEncoder'),
          rateControl: settings.get('recordRateControl'),
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
    // Phone capture dock: every capability is one that already exists
    // (recorder, source manager, presets) — the dock is only a front end.
    dock: {
      applyLook: (id) => {
        const p = PRESETS.find((x) => x.id === id);
        if (!p) return;
        // A look is colour/feel; on the phone it must not undo the picture-fit aspect.
        const { aspect: _keep, ...patch } = presetPatch(p.values);
        void _keep;
        settings.patch(patch);
        responsive.setPresetName(p.name);
      },
      takePhoto: () => new Promise<Blob>((resolve, reject) => {
        // Composite inside a rAF so the GL frame is freshly drawn.
        requestAnimationFrame(() => {
          const c = document.createElement('canvas');
          c.width = canvas.width; c.height = canvas.height;
          const ctx = c.getContext('2d');
          if (!ctx) { reject(new Error('2D canvas unavailable')); return; }
          ctx.drawImage(canvas, 0, 0);
          c.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode image'))), 'image/png');
        });
      }),
      toggleRecord: async () => {
        if (recorder.isRecording()) recorder.stop();
        else await recorder.start({
          fps: settings.get('recordFps'),
          bitsPerSecond: settings.get('recordBitrateMbps') * 1_000_000,
          includeMic: settings.get('recordIncludeMic'),
          micDeviceId: settings.get('recordMicDeviceId'),
          preferredFormat: settings.get('recordPreferredFormat'),
          engine: settings.get('recordEncoder'),
          rateControl: settings.get('recordRateControl'),
        });
      },
      isRecording: () => recorder.isRecording(),
      mic: {
        get: () => settings.get('recordIncludeMic'),
        set: (on) => settings.set('recordIncludeMic', on),
      },
      onRecordState: (fn) => recorder.subscribe(fn),
      elapsedMs: () => recorder.elapsedMs(),
      flipCamera: async () => {
        if (source.getState().kind !== 'webcam') return null;
        const next = settings.get('cameraFacing') === 'user' ? 'environment' : 'user';
        await source.useWebcam({
          width: settings.get('requestedWidth'),
          height: settings.get('requestedHeight'),
          fps: settings.get('requestedFps'),
          facingMode: next,
        });
        settings.set('cameraFacing', next);
        return next;
      },
      toast: (msg, action) => responsive.toast(msg, action, 5000),
      haptic,
      quickSource: {
        webcam: (facing) => startWebcam(facing),
        pattern: () => startWithPattern(),
        library: () => { bootClearErr(); bootFileInput.click(); },
        activeKind: () => source.getState().kind,
        facing: () => settings.get('cameraFacing'),
      },
    },
  });
  recorder.subscribeSaved((file) => responsive.offerShare(file));

  // Shared MCP remote instance (set once by the lazy I/O-sections block
  // below; extra CONTROLS panels reuse it so there's one WS connection).
  let mcpRemoteShared: import('./io/McpRemote').McpRemote | null = null;

  // Lazy-load Record + Share + I/O sections + Help so they don't ship in
  // the initial chunk. UI shows a placeholder until the modules resolve.
  void (async () => {
    const [rs, ss, ms, as, os, cvs, cvos, sons, mcps, mcpMod] = await Promise.all([
      import('./ui/sections/RecordSection'),
      import('./ui/sections/ShareSection'),
      import('./ui/sections/MidiSection'),
      import('./ui/sections/AudioSection'),
      import('./ui/sections/OscSection'),
      import('./ui/sections/CVSection'),
      import('./ui/sections/CVOutputSection'),
      import('./ui/sections/SonificationSection'),
      import('./ui/sections/McpSection'),
      import('./io/McpRemote'),
    ]);
    // MCP remote control — the browser half of tools/mcp-server. Opt-in
    // (Connect button / auto-connect toggle in I/O → MCP); the command
    // surface rides the app's own registries (params, actions, graph).
    // ONE instance app-wide (one WS connection) — extra CONTROLS panels
    // render their MCP section against this same object.
    const mcpRemote = new mcpMod.McpRemote({ settings, getEngine: ensureGraphEngine });
    mcpRemoteShared = mcpRemote;
    if (settings.get('mcpAutoConnect')) mcpRemote.connect();
    panel.addSection({ tab: 'synth', title: 'Record', body: rs.createRecordSection(settings, {
      recorder,
      sequencer,
      stereoCompositor,
      stereoPreview,
      toast: { show: projectToast },
    }) });
    panel.addSection({ tab: 'synth', title: 'Share',  body: ss.createShareSection(settings, broadcaster, whipPublisher, canvas) });
    panel.addSection({ tab: 'io',    title: 'MIDI',  body: ms.createMidiSection(settings, io.midiManager) });
    panel.addSection({ tab: 'io',    title: 'Audio', body: as.createAudioSection(settings, io.fft, io.beat, liveValues) });
    panel.addSection({ tab: 'io',    title: 'OSC',   body: os.createOscSection(settings, io.osc) });
    panel.addSection({ tab: 'io',    title: 'CV',    body: cvs.createCVSection({ settings, cv: io.cv, gamepad: io.gamepad, osc: io.osc }) });
    panel.addSection({ tab: 'io',    title: 'CV Out', body: cvos.createCVOutputSection({ settings, cvOut: io.cvOut }) });
    panel.addSection({ tab: 'io',    title: 'MCP',   body: mcps.createMcpSection(settings, mcpRemote) });
    panel.addSection({ tab: 'io',    title: 'Sonification', body: sons.createSonificationSection({ settings, sonification }) });
  })();

  void (async () => {
    const helpMod = await import('./ui/sections/HelpSection');
    const fabMod  = await import('./ui/help/fab');
    panel.addSection({ tab: 'help', title: 'Manual', body: helpMod.createHelpSection(settings), initiallyOpen: true });  // the Help tab's only section
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
    // Wire the dock shell into the workspace region system now that the
    // dock's build() has assembled (and won't wipe) the shell children.
    workspace.attachDockRegion(timelineHost, dock.viewRoot);
    // Timeline is fully multi-instance: additional windows that tab a
    // TIMELINE get their own dock instance (built into a detached host
    // whose shell chrome goes unused; the viewRoot is the view). All
    // instances stay in sync via the Sequencer's additive callbacks.
    workspace.registerView('timeline', () => {
      const host = document.createElement('div');
      host.style.display = 'contents';
      const extra = new TimelineDock(host, settings, sequencer);
      return extra.viewRoot;
    });
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

  // Controls is fully multi-instance: additional windows that tab
  // CONTROLS get their own complete ControlPanel — every section
  // re-created against the same Settings/IO singletons, so instances
  // mirror each other by construction. The boot-built primary panel
  // (right shell; compact/popout machinery owns it) is seeded
  // separately in createWorkspace.
  workspace.registerView('panel', () => {
    const host = document.createElement('div');
    host.className = 'rw-panel-multihost';
    const extra = new ControlPanel(host, settings);
    extra.addSection({ tab: 'synth', title: 'Video Source A',       body: createSourceSection(settings, source) });
    extra.addSection({ tab: 'synth', title: 'Video Source B',       body: createSourceBSection(settings, sourceB) });
    extra.addSection({ tab: 'synth', title: 'Display Control Unit', body: createDcuSection(settings, rasterSourceSize) });
    extra.addSection({ tab: 'synth', title: 'Dual Raster',          body: createDualRasterSection(settings) });
    extra.addSection({ tab: 'synth', title: 'Virtual Camera',       body: createCameraSection(settings, cameraRig) });
    extra.addSection({ tab: 'synth', title: 'XR',                   body: createXrSection(settings, xrManager) });
    extra.addSection({ tab: 'synth', title: 'Color / Post FX',      body: createColorPostFxSection(settings) });
    extra.addSection({ tab: 'synth', title: 'Modulation',           body: createModulationContainerSection({ settings, matrix, liveValues, cv: io.cv, gamepad: io.gamepad, getEngine: ensureGraphEngine, getVideoTap: () => videoTap }) });
    extra.addSection({ tab: 'synth', title: 'Geometry',             body: createGeometrySection(settings) });
    extra.addSection({ tab: 'synth', title: 'Presets',              body: createPresetsSection(settings) });
    extra.addSection({
      tab: 'synth', title: 'Performance',
      body: createPerformanceSection(settings, { onProfileChange: () => perfMgr.applyForMode(layout.current()) }),
    });
    void (async () => {
      const psMod = await import('./ui/sections/ProjectSection');
      extra.addSection({
        tab: 'synth', title: 'Project', pinTop: true,
        body: psMod.createProjectSection({ projectStore, autoSave, toast: projectToast }),
      });
      const [rs, ss, ms, as, os, cvs, cvos, sons] = await Promise.all([
        import('./ui/sections/RecordSection'),
        import('./ui/sections/ShareSection'),
        import('./ui/sections/MidiSection'),
        import('./ui/sections/AudioSection'),
        import('./ui/sections/OscSection'),
        import('./ui/sections/CVSection'),
        import('./ui/sections/CVOutputSection'),
        import('./ui/sections/SonificationSection'),
      ]);
      extra.addSection({ tab: 'synth', title: 'Record', body: rs.createRecordSection(settings, {
        recorder, sequencer, stereoCompositor, stereoPreview, toast: { show: projectToast },
      }) });
      extra.addSection({ tab: 'synth', title: 'Share',  body: ss.createShareSection(settings, broadcaster, whipPublisher, canvas) });
      extra.addSection({ tab: 'io',    title: 'MIDI',  body: ms.createMidiSection(settings, io.midiManager) });
      extra.addSection({ tab: 'io',    title: 'Audio', body: as.createAudioSection(settings, io.fft, io.beat, liveValues) });
      extra.addSection({ tab: 'io',    title: 'OSC',   body: os.createOscSection(settings, io.osc) });
      extra.addSection({ tab: 'io',    title: 'CV',    body: cvs.createCVSection({ settings, cv: io.cv, gamepad: io.gamepad, osc: io.osc }) });
      extra.addSection({ tab: 'io',    title: 'CV Out', body: cvos.createCVOutputSection({ settings, cvOut: io.cvOut }) });
      if (mcpRemoteShared) {
        const mcpsEx = await import('./ui/sections/McpSection');
        extra.addSection({ tab: 'io', title: 'MCP', body: mcpsEx.createMcpSection(settings, mcpRemoteShared) });
      }
      extra.addSection({ tab: 'io',    title: 'Sonification', body: sons.createSonificationSection({ settings, sonification }) });
      const helpMod = await import('./ui/sections/HelpSection');
      extra.addSection({ tab: 'help', title: 'Manual', body: helpMod.createHelpSection(settings), initiallyOpen: true });  // the Help tab's only section
    })();
    return extra.viewRoot;
  });

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

  // (The old full-screen "TAP TO ENABLE AUDIO + WEBCAM" gate is gone. It
  // stacked on top of the source picker on every touch device, swallowed
  // the first tap, let that tap fall through to whichever button sat
  // underneath, and resumed nothing — every AudioContext in the app is
  // created or resumed inside the click that turns its feature on. Its
  // desktop branch also wrote a setting at boot, which marked every fresh
  // session dirty and triggered a "Recover unsaved changes?" prompt on the
  // next visit.)

  // -------------------------- Boot source picker ---------------------------
  function bootErr(msg: string): void {
    bootError.textContent = msg;
  }
  function bootClearErr(): void {
    bootError.textContent = '';
  }

  // Phones and tablets can't capture the screen; don't offer a button that
  // can only fail.
  if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
    bootScreen.style.display = 'none';
  }

  // PATTERN: start with the Pattern Generator as the input — no camera,
  // microphone or file needed, so nobody lands on a black screen (the
  // audience closer, or anyone who declines the camera). The Pattern
  // Generator stays a compositing layer (Principle 5); this just turns it
  // on. If the visitor later picks a video source while the pattern still
  // covers it completely (replace blend at full mix — the defaults), the
  // pattern is switched off so their video actually shows, with a toast
  // saying so.
  let patternAutoStarted = false;
  function startWithPattern(): void {
    bootClearErr();
    if (!settings.get('patternEnabled')) {
      // A curated look with a pattern that moves on its own (the default
      // Sine Bands is static). presetPatch applies only the preset's own
      // keys, so bindings, graph and layout are untouched.
      const preset = PRESETS.find((p) => p.id === NO_CAMERA_PRESET_ID);
      if (preset) settings.patch(presetPatch(preset.values));
      else settings.set('patternEnabled', true);
      patternAutoStarted = true;
    }
    dismissOverlay();
  }
  bootPattern.addEventListener('click', startWithPattern);
  source.subscribe((st) => {
    if (!patternAutoStarted || st.kind === 'none') return;
    patternAutoStarted = false;
    if (settings.get('patternEnabled')
      && settings.get('patternBlendMode') === 'replace'
      && settings.get('patternMix') >= 0.999) {
      settings.set('patternEnabled', false);
      responsive.toast('Pattern layer switched off so your video shows. Turn it back on in Source ▸ Pattern Generator.');
    }
  });

  /** Start the webcam (boot overlay + the phone's Source sheet share this). */
  async function startWebcam(facing?: 'user' | 'environment'): Promise<void> {
    bootClearErr();
    const f = facing ?? (layout.hasTouch ? settings.get('cameraFacing') : undefined);
    try {
      await source.useWebcam({
        width:  settings.get('requestedWidth'),
        height: settings.get('requestedHeight'),
        fps:    settings.get('requestedFps'),
        facingMode: f,
      });
      if (facing) settings.set('cameraFacing', facing);
      settings.set('sourceKind', 'webcam');
    } catch (err) {
      bootErr(`Webcam: ${(err as Error).message}`);
      throw err;
    }
  }
  bootWebcam.addEventListener('click', () => { void startWebcam().catch(() => { /* shown on the boot screen */ }); });

  bootScreen.addEventListener('click', async () => {
    bootClearErr();
    try {
      await source.useScreen({ fps: settings.get('requestedFps') });
      settings.set('sourceKind', 'screen');
    } catch (err) {
      bootErr(`Screen: ${(err as Error).message}`);
    }
  });

  bootFile.addEventListener('click', () => {
    bootClearErr();
    bootFileInput.click();
  });
  bootFileInput.addEventListener('change', () => {
    const f = bootFileInput.files?.[0];
    if (!f) return;
    source.useFile(f);
    settings.set('sourceKind', 'file');
    settings.set('colorMode', 'video');
    responsive.toast(
      'Color mode set to Video — scanlines now use the source\'s own colors. Adjust in Color / PostFX.',
    );
  });

  // STREAM URL: toggle inline input row
  bootStreamBtn.addEventListener('click', () => {
    bootClearErr();
    bootStreamRow.classList.toggle('visible');
    if (bootStreamRow.classList.contains('visible')) {
      bootStreamInput.focus();
    }
  });

  // Pre-populate stream URL input from saved setting
  bootStreamInput.value = settings.get('streamUrl');

  async function connectBootStream(): Promise<void> {
    const url = bootStreamInput.value.trim();
    if (!url) { bootErr('Enter a URL first.'); return; }
    bootClearErr();
    bootStreamConnect.textContent = 'Connecting…';
    bootStreamConnect.disabled = true;
    try {
      await source.useStreamUrl(url);
      settings.set('streamUrl', url);
      settings.set('sourceKind', 'stream');
    } catch (err) {
      bootErr((err as Error).message);
    } finally {
      bootStreamConnect.textContent = 'Connect';
      bootStreamConnect.disabled = false;
    }
  }
  bootStreamConnect.addEventListener('click', connectBootStream);
  bootStreamInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connectBootStream();
  });

  // "continue without video" must never leave a black screen: with no
  // video source and the pattern layer off there is nothing to draw, so it
  // starts the pattern. Otherwise (a source is live, or the pattern is
  // already on) it just closes the overlay.
  bootSkip.addEventListener('click', () => {
    if (source.getState().kind === 'none' && !settings.get('patternEnabled')) {
      startWithPattern();
      return;
    }
    dismissOverlay();
  });

  // -------------------------- Resize handling ---------------------------
  /**
   * The rectangle actually available to the render canvas: the full
   * viewport minus whatever the side panel and timeline dock currently
   * occupy, so the render surface sits fully visible within its own
   * bounded region instead of the panel/dock overlaying a full-bleed
   * canvas that continues rendering behind them.
   *
   * Reads LIVE bounding rects rather than recomputing panel/dock state
   * from Settings — that automatically handles every state (collapsed,
   * hidden-mini-strip, popped-out panel, compact layout where the panel
   * is `display:none` and the dock isn't even mounted) with no
   * special-casing: a hidden/collapsed/popped-out element's rect is
   * naturally zero or absent.
   */
  function availableCanvasRect(): { x: number; y: number; width: number; height: number } {
    const vp = layout.viewport();
    let left = 0, right = 0, top = 0, bottom = 0;

    // App menu bar — same live-rect philosophy as the panel/dock below:
    // 0 when hidden (compact layout, viewer mode), so no special cases.
    const menubarEl = document.getElementById('rw-menubar');
    if (menubarEl) top += menubarEl.getBoundingClientRect().height;

    // Renderer window maximized: the raster takes everything under the
    // menu bar (the side windows are hidden by body.rw-center-max).
    if (document.getElementById('rw-center-shell')?.hasAttribute('data-region-max')) {
      return { x: 0, y: top, width: Math.max(1, vp.width), height: Math.max(1, vp.height - top) };
    }

    // Maximized regions (data-region-max) are transient OVERLAYS — they
    // cover the canvas rather than shrinking it, so they're skipped.
    const panelEl = document.getElementById('panel-root');
    if (panelEl && !panelEl.hasAttribute('data-region-max')) {
      const w = panelEl.getBoundingClientRect().width;
      if (settings.get('panelDock') === 'left') left += w; else right += w;
    }
    // The LEFT workspace window (empty/hidden = zero-width rect).
    const leftEl = document.getElementById('rw-left-shell');
    if (leftEl && !leftEl.hasAttribute('data-region-max')) {
      // Mirrored to the opposite edge from the Controls shell.
      if (settings.get('panelDock') === 'left') right += leftEl.getBoundingClientRect().width;
      else left += leftEl.getBoundingClientRect().width;
    }
    const dockEl = document.getElementById('timeline-dock');
    if (dockEl && !dockEl.hasAttribute('data-region-max')) {
      const h = dockEl.getBoundingClientRect().height;
      const dock = settings.get('timelineDock');
      const side = dock === 'hidden' ? settings.get('timelineLastDock') : dock;
      // `+=` — a top-docked strip stacks BELOW the menu bar, it doesn't
      // replace its contribution.
      if (side === 'top') top += h; else bottom += h;
    }
    return {
      x: left,
      y: top,
      width: Math.max(1, vp.width - left - right),
      height: Math.max(1, vp.height - top - bottom),
    };
  }

  let resizeTimer: number | null = null;
  function resize(): void {
    const rect = availableCanvasRect();
    const w = rect.width;
    const h = rect.height;
    // Effective DPR = min(devicePixelRatio, profile.dprCap) * userScale,
    // clamped to the profile's renderScaleFloor lower bound.
    const userScale = Math.max(currentRenderScaleFloor, settings.get('renderScale'));
    const dpr = Math.min(window.devicePixelRatio, currentDprCap) * userScale;
    // ResolutionManager owns renderer/postfx/rig resize: it routes to the
    // correct render-target size (match-window vs. fixed preset) and
    // positions the canvas CSS for the chosen fit mode, offset to the
    // available rect's top-left corner.
    resolutionManager.apply(renderer, postfx, ruttEtra, cameraRig, w, h, dpr, userScale, patternRenderer, rect.x, rect.y);
    // The boot overlay ("select a source") is a sibling of the canvas, not
    // a child — CSS alone (`inset: 0`) pins it to the full window, so
    // without this it kept centering itself under the panel/timeline dock
    // instead of the canvas's own bounded rect once the canvas started
    // respecting those bounds. Explicit left/top/width/height (like
    // ResolutionManager does for the canvas) wins over the stylesheet's
    // `inset: 0` shorthand — the browser drops the now-overconstrained
    // right/bottom in favor of the explicit width/height.
    overlay.style.left = `${rect.x}px`;
    overlay.style.top = `${rect.y}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    // The center workspace region shell tracks the same rect — its bar
    // sits atop the render area and its hosted view (when not the
    // pass-through renderer) fills it.
    const centerShell = document.getElementById('rw-center-shell');
    if (centerShell && !centerShell.hasAttribute('data-region-max')) {
      centerShell.style.left = `${rect.x}px`;
      centerShell.style.top = `${rect.y}px`;
      centerShell.style.width = `${rect.width}px`;
      centerShell.style.height = `${rect.height}px`;
    }
    timelineDock?.resize();
  }
  function scheduleResize(): void {
    if (resizeTimer != null) return;
    resizeTimer = window.setTimeout(() => { resizeTimer = null; resize(); }, 120);
  }
  // The panel and timeline dock resize live (dragging their edges
  // updates CSS immediately, before the underlying Settings value
  // commits on release) — they dispatch this so the canvas tracks
  // along at the same debounced cadence as a window resize, instead of
  // only catching up once the drag ends.
  window.addEventListener('rw:layout-resize', scheduleResize);
  // Safety net for non-drag layout changes (collapse/expand buttons,
  // dock-side toggle, TOP/BOT/HIDE) that don't go through a drag
  // gesture at all, so there's no `rw:layout-resize` tick to catch them.
  for (const key of ['panelWidth', 'panelCollapsed', 'leftCollapsed', 'panelDock', 'timelineHeight', 'timelineDock', 'timelineLastDock'] as const) {
    settings.subscribe(key, () => scheduleResize());
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
    // WebXR (v11): three.js drives the loop from the XR session's RAF
    // when `renderer.xr.isPresenting` is true, and from the standard
    // window RAF otherwise — `renderer.setAnimationLoop(frame)` below
    // wires both paths through the same callback. In XR, the EffectComposer
    // pipeline cannot render into the XR layer's framebuffer (each pass
    // owns a screen-sized RT that conflicts with the per-eye buffer), so
    // we branch to `renderer.render(scene, camera)` directly and skip
    // postfx. Same modulation, sequencer, audio, video tap — only the
    // final draw surface changes.
    const presenting = renderer.xr.isPresenting;

    io.midiClock.tick(dt);
    io.fft.tick(dt);
    io.beat.tick(dt);
    io.gamepad.poll();
    // Mode switch: Classic engine writes only when `modMode` is `'classic'`
    // or `'both'`. When mode is `'graph'`, we publish an empty Classic
    // target set so the dual-engine indicator deactivates immediately.
    const modMode = settings.get('modMode');
    if (modMode !== 'graph') {
      matrix.tick(dt);
    } else {
      activeTargetsBus.publish('classic', new Set());
    }
    videoTap.tick();
    // MeshAnalyzer + Sonification ride after VideoTap so they see
    // this frame's readback. Both no-op cheaply when the source isn't
    // playing yet (no thumbnail / not running).
    meshAnalyzer.tick(videoTap, {
      threshold: settings.get('threshold'),
      contrast:  settings.get('contrast'),
      gamma:     settings.get('gamma'),
    });
    sonification.tick(meshAnalyzer.read(), dt);
    graphEngine?.tick(dt);
    // CV output tick MUST run after both modulation engines so source
    // values from Classic slot targets and Graph cv-output nodes are
    // already in `cvOut.classicSources` / `cvOut.graphSources`.
    io.cvOut.tick(dt);
    sequencer.tick(dt);
    // CameraRig is desktop-only — during XR the head IS the camera
    // (three.js's XRCamera receives pose updates from the headset).
    // Skipping the rig tick avoids fighting the XR pose; the rig's
    // pre-XR view is stashed by XRManager and restored on session end.
    if (!presenting) cameraRig.tick(dt);
    ruttEtra.updateSpectrum(io.fft.bands);
    ruttEtra.tick(dt, t);

    // Honor profile's frameIntervalMs (battery profile caps to 30 fps).
    // Ignored in XR: the headset's compositor sets the cadence; we MUST
    // submit a frame each time three.js calls us or the runtime reprojects
    // our last frame and the user sees judder.
    if (!presenting && now - lastDraw + 0.5 < currentFrameInterval) {
      return;
    }
    lastDraw = now;

    // Video Source A/B Composite (v1.18): resolves this frame's DCU
    // video input per the Patch Bay's RENDERER IN wiring. `null` means
    // "use the live source A texture as-is" — the default, zero-cost,
    // byte-for-byte unchanged behavior (videoRendererIn: 'sourceA').
    // Runs BEFORE the Pattern Generator so pattern always layers on top
    // of the composited feed, not the raw source — coexistence, not a
    // second independent override fighting over the same uniform.
    // "Active" is real video readiness (readyState >= HAVE_CURRENT_DATA),
    // not the `sourceKind`/`sourceBKind` label — those are just the last
    // switch a user made and can transiently (or, before this feature,
    // permanently for a Patch-Bay-only pick — see mkVideoSourceModule's
    // comment) disagree with whether the element actually has a frame.
    // Same convention the bay's own preview monitors already use.
    // Pattern Generator as a patchable picture source (v1.31): when its
    // OUT is patched anywhere it renders as a source (fed to the
    // compositor below) and does NOT also overlay; otherwise it keeps
    // its classic overlay role when enabled.
    const patternRouted = isPatternRouted((k) => settings.get(k));
    const patternOverlay = settings.get('patternEnabled') && !patternRouted;
    const patternOut = (settings.get('patternEnabled') || patternRouted)
      ? patternRenderer.renderPattern(t, dt) : null;
    if (!patternOut && patternWasRendering) patternRenderer.bypass(); // drop stale signals
    patternWasRendering = !!patternOut;
    videoCompositor.setPatternSource(patternRouted ? patternOut : null);

    const composedVideo = videoCompositor.resolveVideoInput(
      ruttEtra.videoTexture, video.readyState >= 2,
      videoBTexture, videoB.readyState >= 2,
      video.videoWidth, video.videoHeight, videoB.videoWidth, videoB.videoHeight,
    );

    // Pattern Generator: render the synthesized layer + composite with
    // the (possibly A/B-composited) video texture, then bind the
    // result as the DCU's input. No-op when disabled — whatever the
    // composite step above bound (or the live VideoTexture from
    // RuttEtraScene.attachVideo() when neither is active) stays bound.
    if (patternOverlay && patternOut) {
      patternRenderer.overlay(composedVideo?.texture ?? ruttEtra.videoTexture);
    } else {
      // Not overlaying: if the overlay was bound last frame, the live
      // video binding has to be restored below.
      const releasedOverlay = patternRenderer.releaseOverlay();
      if (composedVideo) {
        ruttEtra.setExternalVideoTexture(composedVideo.texture, composedVideo.width, composedVideo.height);
        videoCompositeBoundExternal = true;
      } else if ((videoCompositeBoundExternal || releasedOverlay) && settings.get('videoRendererIn') !== 'dualRaster') {
        // Not while Dual Raster is the route: its block below binds both
        // rasters itself and sets videoCompositeBoundExternal every frame,
        // so restoring here re-created raster A's VideoTexture EVERY frame
        // — a texture that never got a frame uploaded, so raster A went
        // black. Leaving Dual Raster still restores the live video once.
        ruttEtra.attachVideo();
        videoCompositeBoundExternal = false;
      }
    }

    // Dual Raster node (v1.20): when wired (videoRendererIn ===
    // 'dualRaster'), BOTH rasters come from the Dual Raster node's own
    // two inputs instead of whatever the single-texture routing above
    // resolved (which returns null in this mode, so the block above is
    // a no-op here — raster A gets InA explicitly below, not silently
    // whatever attachVideo() last bound). Runs LAST and unconditionally
    // overrides both uniform sets: Pattern Generator's own compositing
    // (above) always uses `RuttEtraScene.setExternalVideoTexture`,
    // which re-syncs raster B to raster A every time it runs — so if
    // this ran BEFORE Pattern Generator's block, Pattern would silently
    // clobber raster B's independent source right back. Combining
    // Pattern Generator with per-raster Dual Raster sources isn't
    // attempted here (out of scope) — when both are active, Dual
    // Raster's wiring wins for what's actually displayed.
    const dualRaster = videoCompositor.resolveDualRaster(
      ruttEtra.videoTexture, video.readyState >= 2,
      videoBTexture, videoB.readyState >= 2,
      video.videoWidth, video.videoHeight, videoB.videoWidth, videoB.videoHeight,
    );
    if (dualRaster) {
      // Deliberately does NOT call `attachVideo()` when a side resolves
      // to null (InA/InB unwired) — that would recreate raster A's
      // THREE.VideoTexture every single frame this persists (a real
      // per-frame perf bug caught before shipping: VideoTexture already
      // auto-updates from the `<video>` element on its own, it never
      // needed re-creating just to "stay current"). Skipping just
      // leaves whichever binding the block above already established
      // (the live source, or Pattern Generator's own composite) — a
      // sane fallback with zero extra cost.
      if (dualRaster.a) {
        ruttEtra.setExternalVideoTexture(dualRaster.a.texture, dualRaster.a.width, dualRaster.a.height);
      }
      if (dualRaster.b) {
        ruttEtra.setExternalVideoTextureB(dualRaster.b.texture, dualRaster.b.width, dualRaster.b.height);
      } // else: InB unwired — leave raster B mirroring whatever raster A was just set to above
      videoCompositeBoundExternal = true;
    }

    // Stereo recording: the offscreen compositor runs its own
    // side-by-side render each frame regardless of what the visible
    // canvas is showing. Driven here so the per-frame ordering
    // (modulation → scene update → stereo render) is identical to
    // the monoscopic path.
    if (stereoCompositor.isActive()) stereoCompositor.tick();

    if (presenting) {
      // Direct render to the XR layer framebuffer. EffectComposer is
      // skipped per the v1 spec (Option A — raw mesh in stereo). Bloom,
      // feedback, CRT all return when the user exits XR.
      renderer.render(ruttEtra.scene, cameraRig.camera);
    } else if (stereoPreview.isActive()) {
      // 3-second preview: render side-by-side to the visible canvas
      // so the user can see what their stereo recording will look
      // like before they commit. Same compositor primitive, just
      // drawn into the main renderer's framebuffer.
      const w = canvas.width;
      const h = canvas.height;
      stereoCompositor.renderPreviewTo(renderer, w, h);
    } else if (settings.get('anaglyphEnabled') && anaglyphRenderer) {
      // Anaglyph mode: render left + right eye with Dubois-matrix
      // red-cyan channel splitting directly to the main canvas.
      // EffectComposer is bypassed (same constraint as XR). Recording,
      // WHIP streaming, and canvas capture all see the composited
      // anaglyph image automatically since they read from this canvas.
      anaglyphRenderer.render(ruttEtra.scene, cameraRig.camera);
    } else {
      postfx.render(dt);
    }
    watcher.onFrame(dt);
    // High-quality recording reads the canvas right after it is drawn (no-op unless recording).
    recorder.captureRenderedFrame();

    frames++;
    if (now - fpsClock >= 500) {
      fps = (frames * 1000) / (now - fpsClock);
      frames = 0;
      fpsClock = now;
      const st = source.getState();
      // Use canvas.width × canvas.height (the actual drawing-buffer size)
      // rather than resolutionManager.actualWidth (the preset's logical
      // size, which ignores renderScale). When renderScale < 1 the two
      // values diverge; the canvas dimensions are what MediaRecorder
      // and captureStream actually see, so they're the honest number.
      const resId = settings.get('renderResolutionId');
      const renderPart = resId !== 'match'
        ? `  ·  render ${canvas.width}×${canvas.height}`
        : '';
      const srcPart = st.kind === 'none' ? 'no source' : `${st.kind} ${st.width}×${st.height}`;
      hud.textContent = `${fps.toFixed(0)} fps  ·  ${srcPart}${renderPart}`;
    }
  }
  // Use three.js's XR-aware loop — this is identical to RAF when no
  // XR session is active and switches to the headset's compositor RAF
  // automatically when `renderer.xr.setSession(...)` is called.
  //
  // Guarded: three's WebGLAnimation only requests the next frame AFTER
  // this callback returns, so one uncaught exception anywhere in
  // `frame()` (a modulation node, a pattern, post-FX, the HUD) used to
  // freeze the output until reload — on stage, a dead projector. Now the
  // loop keeps running, the first errors are logged in full (then
  // sampled so the console isn't flooded at 60 fps), and a small badge
  // tells the performer something is wrong.
  let frameErrors = 0;
  const guardedFrame = (): void => {
    try {
      frame();
    } catch (err) {
      frameErrors++;
      if (frameErrors <= 3 || frameErrors % 600 === 0) {
        console.error(`[ruttetra] frame error #${frameErrors}`, err);
      }
      showStatusBadge(`render error ×${frameErrors} — see console`, 'error');
    }
  };
  // Output popouts can drive this same frame when the main window's rAF
  // stops (hidden behind a fullscreen popout) — renderer/frameDriver.ts.
  setFrameRunner(() => { if (!renderer.xr.isPresenting) guardedFrame(); });
  let splashShown = true;
  renderer.setAnimationLoop(() => {
    noteMainFrame();
    guardedFrame();
    if (splashShown) { splashShown = false; hideSplash(); } // first frame is up
  });

  // GPU context loss (driver reset, phone backgrounding, sleep). three
  // already calls preventDefault on 'webglcontextlost' so the browser may
  // restore the context, and rebuilds its own GPU state on restore; we
  // tell the performer what's happening and re-apply sizing once it's back.
  canvas.addEventListener('webglcontextlost', () => {
    console.warn('[ruttetra] WebGL context lost — waiting for the browser to restore it');
    showStatusBadge('GPU context lost — recovering…', 'info', 60_000);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    console.info('[ruttetra] WebGL context restored');
    showStatusBadge('GPU context restored', 'info', 3_000);
    resize();
  });
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
