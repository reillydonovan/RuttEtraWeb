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
import { PatternRenderer } from './renderer/patterns/PatternRenderer';
import { PatternSignalBus } from './renderer/patterns/PatternSignalBus';
import type { OscilloscopeBuffer } from './renderer/patterns/OscilloscopeBuffer';
import { VideoTap } from './modulation/graph/VideoTap';
import { MeshAnalyzer } from './audio/MeshAnalyzer';
import { Sonification } from './audio/Sonification';
import { ProjectStore } from './project/ProjectStore';
import { AutoSave } from './project/AutoSave';
import { maybePackageRecoveredSession } from './project/RecoveredSession';
import { describeSummary } from './project/Project';
import { ModMatrix } from './modulation/ModMatrix';
import { activeTargetsBus } from './modulation/ActiveTargetsBus';
import { LiveValuesStore } from './modulation/LiveValues';
import { attachModDebugOverlayIfRequested } from './modulation/ModDebugOverlay';
import type { GraphEngine } from './modulation/graph/GraphEngine';
import { ControlPanel } from './ui/ControlPanel';
import { createSourceSection } from './ui/sections/SourceSection';
import { createDcuSection } from './ui/sections/DcuSection';
import { createDualRasterSection } from './ui/sections/DualRasterSection';
import { createModulationContainerSection } from './ui/sections/ModulationContainerSection';
import { createCameraSection } from './ui/sections/CameraSection';
import { createColorPostFxSection } from './ui/sections/ColorPostFxSection';
import { createGeometrySection } from './ui/sections/GeometrySection';
import { createPresetsSection } from './ui/sections/PresetsSection';
import { createPerformanceSection } from './ui/sections/PerformanceSection';
import { createXrSection } from './ui/sections/XrSection';
import { XRManager } from './renderer/XRManager';
import { layoutManager } from './ui/layout/LayoutManager';
import { ResponsivePanel } from './ui/layout/ResponsivePanel';
import { DebugOverlay } from './ui/layout/DebugOverlay';
import { PerformanceProfileManager } from './perf/PerformanceProfile';
import { FrameBudgetWatcher } from './perf/FrameBudgetWatcher';
import { attachHaptics, haptic } from './platform/HapticFeedback';
import * as keyframeAffordance from './ui/keyframeAffordance';
import { registerLiveValues } from './ui/liveValueBus';
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
  const panelHost = document.getElementById('panel-root') as HTMLElement;
  // Boot source picker elements
  const bootWebcam   = document.getElementById('boot-webcam')         as HTMLButtonElement;
  const bootScreen   = document.getElementById('boot-screen')         as HTMLButtonElement;
  const bootFile     = document.getElementById('boot-file')           as HTMLButtonElement;
  const bootStreamBtn = document.getElementById('boot-stream-btn')    as HTMLButtonElement;
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
  // Restore the live video binding when the user disables the layer.
  settings.subscribe('patternEnabled', (enabled) => {
    if (!enabled) patternRenderer.bypass();
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

  // -------------------- Sonification (audible output) --------------------
  // First audio-output feature: a single voice driven by mesh
  // statistics. Boots disabled — settings migration always forces
  // `sonification.enabled = false` regardless of saved value, so no
  // audio can leak out without an explicit user gesture. The Enable
  // toggle in the I/O panel is itself a click event (satisfies
  // browser autoplay policy); the canvas-click fallback below handles
  // the edge case where settings flip enabled=true after load
  // without any user gesture having occurred (e.g. URL-driven config).
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
  function dismissOverlay(): void {
    overlayDismissed = true;
    overlay.classList.add('hidden');
  }
  source.subscribe((st) => {
    if (st.kind !== 'none') dismissOverlay();
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
    subscribeAllSettings: (fn) => settings.subscribeAll(() => fn()),
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
  const BASE_TITLE = 'RUTT/ETRA - Web Video Synthesizer';
  projectStore.subscribe((s) => {
    if (s.name) {
      document.title = `${s.name}${s.dirty ? ' *' : ''} — RUTT/ETRA`;
    } else if (s.dirty) {
      document.title = `Untitled * — RUTT/ETRA`;
    } else {
      document.title = BASE_TITLE;
    }
  });

  // Boot-time recovery prompt. If the previous session had unsaved
  // changes (auto-save) or this is the first launch with the
  // Recovered Session migration above, surface a single prompt.
  // Deferred until after the panel is built so the toast can land.
  const pendingRecovery = AutoSave.loadPending();

  // beforeunload — flush an autosave snapshot if dirty so a crash
  // or accidental close still leaves a recoverable trail. Synchronous
  // only; we can't await async writes here.
  window.addEventListener('beforeunload', () => {
    if (projectStore.getState().dirty) autoSave.tick();
  });

  // Keyboard shortcuts: Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S.
  // We must `preventDefault` Ctrl+S (browser "save page as") and
  // Ctrl+O ("open file"). New / Open / Save dispatch through the
  // ProjectStore directly; Save As opens a name prompt.
  window.addEventListener('keydown', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey)) return;
    const k = ev.key.toLowerCase();
    if (k === 's') {
      ev.preventDefault();
      if (ev.shiftKey) {
        const name = window.prompt('Project name:', projectStore.getState().name ?? `Project ${new Date().toLocaleDateString()}`);
        if (name != null) void projectStore.saveAs(name).then((ok) => {
          if (ok) AutoSave.clearPending();
        });
      } else {
        const cur = projectStore.getState();
        if (!cur.name) {
          const name = window.prompt('Project name:', `Project ${new Date().toLocaleDateString()}`);
          if (name != null) void projectStore.saveAs(name).then((ok) => {
            if (ok) AutoSave.clearPending();
          });
        } else {
          void projectStore.saveToCurrent().then((ok) => {
            if (ok) AutoSave.clearPending();
          });
        }
      }
    } else if (k === 'o') {
      ev.preventDefault();
      const cur = projectStore.getState();
      if (cur.dirty && !confirm('Unsaved changes will be lost. Continue?')) return;
      if (cur.hasFsAccess) void projectStore.openWithPicker();
    } else if (k === 'n') {
      ev.preventDefault();
      const cur = projectStore.getState();
      if (cur.dirty && !confirm('Unsaved changes will be lost. Continue?')) return;
      projectStore.newProject();
      AutoSave.clearPending();
    }
  });

  // -------------------------- UI panel ---------------------------------
  const panel = new ControlPanel(panelHost, settings);

  // Two-screen popout (v19): move the whole control panel into its own
  // window so output can go fullscreen on a second display. Same JS
  // context — no state sync needed. Desktop feature; the button simply
  // does nothing if the popup is blocked.
  {
    const { createPanelPopout } = await import('./ui/PanelPopout');
    const popoutBtn = document.createElement('button');
    popoutBtn.title = 'Pop controls out into a separate window (two-screen setup)';
    popoutBtn.textContent = '⧉';
    const popout = createPanelPopout(panelHost, (open) => {
      popoutBtn.textContent = open ? '⧈' : '⧉';
      popoutBtn.title = open
        ? 'Return controls to this window'
        : 'Pop controls out into a separate window (two-screen setup)';
      // While the panel lives in the popup the main window has no panel
      // footprint — let the timeline dock reclaim the full width. On
      // pop-in the panel recomputes its insets.
      if (open) {
        const style = document.documentElement.style;
        style.setProperty('--rw-panel-inset-right', '0px');
        style.setProperty('--rw-panel-inset-left', '0px');
      } else {
        panel.refreshInset();
      }
    });
    popoutBtn.addEventListener('click', () => popout.toggle());
    panel.addTitleAction(popoutBtn);
  }

  // Render-canvas popout: the OUTPUT side of the same two-screen rig —
  // pop the live output into its own draggable window (a captured
  // MediaStream, not the canvas itself — see RenderPopout.ts for why),
  // which carries its own fullscreen toggle for "seamless" projector use.
  {
    const { createRenderPopout } = await import('./renderer/RenderPopout');
    const renderPopoutBtn = document.createElement('button');
    renderPopoutBtn.title = 'Pop the output out into a separate window (fullscreen there for a projector/second display)';
    renderPopoutBtn.textContent = '⛶';
    const renderPopout = createRenderPopout(canvas, (open) => {
      renderPopoutBtn.textContent = open ? '⛶•' : '⛶';
      renderPopoutBtn.title = open
        ? 'Output window is open — click to bring it back / close it'
        : 'Pop the output out into a separate window (fullscreen there for a projector/second display)';
    });
    renderPopoutBtn.addEventListener('click', () => renderPopout.toggle());
    panel.addTitleAction(renderPopoutBtn);
  }

  // Panel-wide param search + tab hotkeys (v19, AUDIT item 26). `/`
  // focuses the search, 1/2/3 switch panel tabs — both only when the
  // keystroke isn't going into a text field.
  const { createPanelSearch, isTypingTarget } = await import('./ui/PanelSearch');
  const panelSearch = createPanelSearch(panelHost, settings);
  panel.addBeforeTabs(panelSearch.el);
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
    if (e.key === '/') { e.preventDefault(); panelSearch.focus(); return; }
    // `F` toggles native fullscreen on the MAIN window (documented in
    // the Shortcuts help). Distinct from the render popout's own `F`,
    // which is scoped to that separate window.
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen().catch(() => {});
      return;
    }
    // `H` toggles the on-screen FPS/source HUD.
    if (e.key === 'h' || e.key === 'H') {
      e.preventDefault();
      settings.set('hudVisible', !settings.get('hudVisible'));
      return;
    }
    // [ / ] cycle panel tabs. Deliberately NOT digit keys: the About
    // reference reserves 1-9 for preset snapshot slots.
    if (e.key === '[' || e.key === ']') {
      const order: Array<'synth' | 'io' | 'help'> = ['synth', 'io', 'help'];
      const cur = order.indexOf(settings.get('panelTab') ?? 'synth');
      const next = (cur + (e.key === ']' ? 1 : order.length - 1)) % order.length;
      settings.set('panelTab', order[next]);
    }
  });

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
      tab: 'synth', title: 'Project', initiallyOpen: true,
      body: psMod.createProjectSection({ projectStore, autoSave, toast: projectToast }),
    });
  })();

  // Boot-time recovery prompt. Defer one frame so the panel finishes
  // mounting before the alert / confirm fires.
  if (pendingRecovery) {
    setTimeout(() => {
      const age = AutoSave.formatAge(pendingRecovery.writtenAt);
      const ok = confirm(
        `Recover unsaved changes from "${pendingRecovery.projectName}" (${age})?\n\n` +
        'Click OK to restore. Cancel discards the snapshot.',
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

  panel.addSection({ tab: 'synth', title: 'Source',                body: createSourceSection(settings, source),       initiallyOpen: true });
  panel.addSection({ tab: 'synth', title: 'Display Control Unit',  body: createDcuSection(settings),                  initiallyOpen: true });
  panel.addSection({ tab: 'synth', title: 'Dual Raster',           body: createDualRasterSection(settings) });
  panel.addSection({ tab: 'synth', title: 'Camera',                body: createCameraSection(settings, cameraRig) });
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
    panel.addSection({ tab: 'synth', title: 'Record', body: rs.createRecordSection(settings, {
      recorder,
      sequencer,
      stereoCompositor,
      stereoPreview,
      toast: { show: projectToast },
    }) });
    panel.addSection({ tab: 'synth', title: 'Share',  body: ss.createShareSection(settings, broadcaster, whipPublisher, canvas) });
    panel.addSection({ tab: 'io',    title: 'MIDI',  body: ms.createMidiSection(settings, io.midiManager), initiallyOpen: true });
    panel.addSection({ tab: 'io',    title: 'Audio', body: as.createAudioSection(settings, io.fft, io.beat, liveValues), initiallyOpen: true });
    panel.addSection({ tab: 'io',    title: 'OSC',   body: os.createOscSection(settings, io.osc) });
    panel.addSection({ tab: 'io',    title: 'CV',    body: cvs.createCVSection({ settings, cv: io.cv, gamepad: io.gamepad, osc: io.osc }) });
    panel.addSection({ tab: 'io',    title: 'CV Out', body: cvos.createCVOutputSection({ settings, cvOut: io.cvOut }) });
    panel.addSection({ tab: 'io',    title: 'Sonification', body: sons.createSonificationSection({ settings, sonification }) });
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

  // -------------------------- Boot source picker ---------------------------
  function bootErr(msg: string): void {
    bootError.textContent = msg;
  }
  function bootClearErr(): void {
    bootError.textContent = '';
  }

  bootWebcam.addEventListener('click', async () => {
    bootClearErr();
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
      bootErr(`Webcam: ${(err as Error).message}`);
    }
  });

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
      bootStreamConnect.textContent = 'CONNECT';
      bootStreamConnect.disabled = false;
    }
  }
  bootStreamConnect.addEventListener('click', connectBootStream);
  bootStreamInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connectBootStream();
  });

  bootSkip.addEventListener('click', () => {
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

    const panelEl = document.getElementById('panel-root');
    if (panelEl) {
      const w = panelEl.getBoundingClientRect().width;
      if (settings.get('panelDock') === 'left') left = w; else right = w;
    }
    const dockEl = document.getElementById('timeline-dock');
    if (dockEl) {
      const h = dockEl.getBoundingClientRect().height;
      const dock = settings.get('timelineDock');
      const side = dock === 'hidden' ? settings.get('timelineLastDock') : dock;
      if (side === 'top') top = h; else bottom = h;
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
  for (const key of ['panelWidth', 'panelCollapsed', 'panelDock', 'timelineHeight', 'timelineDock', 'timelineLastDock'] as const) {
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

    // Pattern Generator: render the synthesized layer + composite with
    // the live video texture, then bind the result as the DCU's input.
    // No-op when disabled — the live VideoTexture stays bound from
    // RuttEtraScene.attachVideo().
    if (settings.get('patternEnabled')) {
      patternRenderer.tick(t, dt, ruttEtra.videoTexture);
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
  renderer.setAnimationLoop(frame);

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
