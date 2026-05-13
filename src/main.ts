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

  // Renderer
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

  // Sources
  const source = new VideoSourceManager(video);

  // Scene + camera
  const ruttEtra = new RuttEtraScene(settings, video);
  const cameraRig = new CameraRig(settings, canvas);
  const postfx = new PostFX(renderer, ruttEtra.scene, cameraRig.camera, settings, window.innerWidth, window.innerHeight);

  // Modulation matrix
  const matrix = new ModMatrix(settings);

  // When a preset changes the default view, snap to it.
  let lastDefault = JSON.stringify(settings.get('defaultView'));
  settings.subscribe('defaultView', (v) => {
    const cur = JSON.stringify(v);
    if (cur === lastDefault) return;
    lastDefault = cur;
    cameraRig.applySavedView(v);
  });

  // Recorder + broadcaster
  const recorder = new CanvasRecorder(canvas);
  const broadcaster = new Broadcaster();

  // Refresh video texture & texel uniform when source metadata loads
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

  // Build UI
  const panel = new ControlPanel(panelHost, settings);
  panel.addSection({ title: 'Source',           body: createSourceSection(settings, source),       initiallyOpen: true });
  panel.addSection({ title: 'Display Control Unit', body: createDcuSection(settings),               initiallyOpen: true });
  panel.addSection({ title: 'Camera',           body: createCameraSection(settings, cameraRig) });
  panel.addSection({ title: 'Color / Post FX',  body: createColorPostFxSection(settings) });
  panel.addSection({ title: 'Modulation',       body: createModulationSection(settings, matrix) });
  panel.addSection({ title: 'Geometry',         body: createGeometrySection(settings) });
  panel.addSection({ title: 'Presets',          body: createPresetsSection(settings) });
  panel.addSection({ title: 'Record',           body: createRecordSection(settings, recorder) });
  panel.addSection({ title: 'Share',            body: createShareSection(settings, broadcaster, canvas) });

  // Start button -> webcam
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

  // Resize handling
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

  // Keep the post-fx camera reference in sync if it ever changes
  postfx.setCamera(cameraRig.camera);

  // Render loop
  const clock = new THREE.Clock();
  let frames = 0;
  let fpsClock = performance.now();
  let fps = 0;

  function frame() {
    const dt = clock.getDelta();
    const t = clock.elapsedTime;

    matrix.tick(dt);
    cameraRig.tick(dt);
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
  // Replace body content with a single fullscreen video element.
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

  // Tap to unmute (browsers block autoplay-with-audio without gesture).
  document.body.addEventListener('click', () => {
    v.muted = false;
    v.play().catch(() => {});
  }, { once: true });
}
