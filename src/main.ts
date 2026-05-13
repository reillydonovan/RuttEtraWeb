/**
 * Entry point.
 *
 * Routes between two modes:
 *   - synth mode (default): full Rutt/Etra app
 *   - viewer mode (`?view=<peerId>`): connect to a broadcaster and show
 *     the live stream fullscreen with no UI
 */

import * as THREE from 'three';
import { settings } from './state/Settings';
import { VideoSourceManager } from './input/sources';
import { RuttEtraScene } from './renderer/RuttEtra';
import { CameraRig } from './renderer/CameraRig';
import { PostFX } from './renderer/Postfx';
import { ModMatrix } from './modulation/ModMatrix';
import { CanvasRecorder } from './record/Recorder';
import { Broadcaster } from './stream/Broadcaster';
import { Viewer } from './stream/Viewer';
import { ControlPanel } from './ui/ControlPanel';
import { createSourceSection } from './ui/sections/SourceSection';
import { createDcuSection } from './ui/sections/DcuSection';
import { createModulationSection } from './ui/sections/ModulationSection';
import { createCameraSection } from './ui/sections/CameraSection';
import { createColorPostFxSection } from './ui/sections/ColorPostFxSection';
import { createGeometrySection } from './ui/sections/GeometrySection';
import { createPresetsSection } from './ui/sections/PresetsSection';
import { createRecordSection } from './ui/sections/RecordSection';
import { createShareSection } from './ui/sections/ShareSection';
import { createMidiSection } from './ui/sections/MidiSection';
import { createAudioSection } from './ui/sections/AudioSection';
import { createOscSection } from './ui/sections/OscSection';
import { MidiClock } from './midi/MidiClock';
import { MidiMapping } from './midi/MidiMapping';
import { MidiManager } from './midi/MidiManager';
import { FFTAnalyzer } from './audio/FFTAnalyzer';
import { BeatDetector } from './audio/BeatDetector';
import { OscClient } from './osc/OscClient';

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

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const source = new VideoSourceManager(video);

  const ruttEtra = new RuttEtraScene(settings, video);
  const cameraRig = new CameraRig(settings, canvas);
  const postfx = new PostFX(renderer, ruttEtra.scene, cameraRig.camera, settings, window.innerWidth, window.innerHeight);

  // I/O subsystems — constructed before the matrix so we can pass them in.
  const midiClock = new MidiClock();
  const midiMapping = new MidiMapping(settings);
  const midiManager = new MidiManager(settings, midiClock, midiMapping);

  const fft = new FFTAnalyzer();
  const beat = new BeatDetector(fft);
  // Apply persisted FFT params eagerly so initial UI labels match.
  fft.setFftSize(settings.get('audioFftSize'));
  fft.setBandCount(settings.get('audioBandCount'));
  fft.setSpacing(settings.get('audioBandSpacing'));
  fft.setBandShape({
    attackMs:    settings.get('audioAttackMs'),
    releaseMs:   settings.get('audioReleaseMs'),
    gain:        settings.get('audioGain'),
    floor:       settings.get('audioFloor'),
    thresholdDb: settings.get('audioThresholdDb'),
  });
  beat.setEnabled(settings.get('beatEnabled'));
  beat.setSensitivity(settings.get('beatSensitivity'));

  const osc = new OscClient(settings);

  const matrix = new ModMatrix(settings, {
    fft, beat, midiClock, midiMapping, midiManager, osc,
  });

  let lastDefault = JSON.stringify(settings.get('defaultView'));
  settings.subscribe('defaultView', (v) => {
    const cur = JSON.stringify(v);
    if (cur === lastDefault) return;
    lastDefault = cur;
    cameraRig.applySavedView(v);
  });

  const recorder = new CanvasRecorder(canvas);
  const broadcaster = new Broadcaster();

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

  // Build UI — Synth tab gets the existing sections, I/O tab gets MIDI/Audio/OSC.
  const panel = new ControlPanel(panelHost, settings);
  panel.addSection({ tab: 'synth', title: 'Source',                body: createSourceSection(settings, source),       initiallyOpen: true });
  panel.addSection({ tab: 'synth', title: 'Display Control Unit',  body: createDcuSection(settings),                  initiallyOpen: true });
  panel.addSection({ tab: 'synth', title: 'Camera',                body: createCameraSection(settings, cameraRig) });
  panel.addSection({ tab: 'synth', title: 'Color / Post FX',       body: createColorPostFxSection(settings) });
  panel.addSection({ tab: 'synth', title: 'Modulation',            body: createModulationSection(settings, matrix) });
  panel.addSection({ tab: 'synth', title: 'Geometry',              body: createGeometrySection(settings) });
  panel.addSection({ tab: 'synth', title: 'Presets',               body: createPresetsSection(settings) });
  panel.addSection({ tab: 'synth', title: 'Record',                body: createRecordSection(settings, recorder) });
  panel.addSection({ tab: 'synth', title: 'Share',                 body: createShareSection(settings, broadcaster, canvas) });

  panel.addSection({ tab: 'io', title: 'MIDI',  body: createMidiSection(settings, midiManager),  initiallyOpen: true });
  panel.addSection({ tab: 'io', title: 'Audio', body: createAudioSection(settings, fft, beat),   initiallyOpen: true });
  panel.addSection({ tab: 'io', title: 'OSC',   body: createOscSection(settings, osc) });

  startBtn.addEventListener('click', async () => {
    try {
      await source.useWebcam({
        width:  settings.get('requestedWidth'),
        height: settings.get('requestedHeight'),
        fps:    settings.get('requestedFps'),
      });
      settings.set('sourceKind', 'webcam');
    } catch (err) {
      const e = err as Error;
      const line = document.createElement('div');
      line.className = 'boot-line dim';
      line.textContent = `Couldn't access webcam: ${e.message}. Try a file or screen share from the Source panel.`;
      document.getElementById('boot-message')?.appendChild(line);
    }
  });

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    cameraRig.resize(w, h);
    postfx.resize(w, h);
    ruttEtra.setSize(w, h);
  }
  window.addEventListener('resize', resize);
  resize();

  postfx.setCamera(cameraRig.camera);

  const clock = new THREE.Clock();
  let frames = 0;
  let fpsClock = performance.now();
  let fps = 0;

  function frame() {
    const dt = clock.getDelta();
    const t = clock.elapsedTime;

    midiClock.tick(dt);
    fft.tick(dt);
    beat.tick(dt);
    matrix.tick(dt);
    cameraRig.tick(dt);
    ruttEtra.updateSpectrum(fft.bands);
    ruttEtra.tick(dt, t);
    postfx.render(dt);

    frames++;
    const now = performance.now();
    if (now - fpsClock >= 500) {
      fps = (frames * 1000) / (now - fpsClock);
      frames = 0;
      fpsClock = now;
      const st = source.getState();
      hud.textContent = `${fps.toFixed(0)} fps  ·  ${st.kind === 'none' ? 'no source' : `${st.kind} ${st.width}×${st.height}`}`;
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
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

  const viewer = new Viewer(targetId, v);
  viewer.start();

  v.addEventListener('playing', () => { status.textContent = ''; });

  document.body.addEventListener('click', () => {
    v.muted = false;
    v.play().catch(() => {});
  }, { once: true });
}
