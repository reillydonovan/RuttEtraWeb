// @vitest-environment jsdom

/**
 * XRManager unit tests.
 *
 * The body of the manager is glue between four collaborators —
 * `navigator.xr`, `THREE.WebGLRenderer.xr`, the desktop `CameraRig`,
 * and `PerformanceProfileManager` — so each test stubs the minimum
 * surface needed and exercises one lifecycle path end-to-end.
 *
 * Visibility-change handling uses the documented jsdom pattern
 * (Object.defineProperty(document, 'hidden', ...) then
 * dispatchEvent(new Event('visibilitychange'))) rather than mocking
 * the Page Visibility API. The visibility-vs-focus correction is
 * load-bearing — see PRINCIPLES.md §3 — so the test must exercise
 * the renamed `xrAutoEndOnVisibilityChange` semantics directly
 * against the real DOM event.
 */

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { XRManager } from '../XRManager';
import { PerformanceProfileManager } from '../../perf/PerformanceProfile';
import { settings } from '../../state/Settings';
import type { CameraRig } from '../CameraRig';

// --------------------------------------------------------------------
// Test doubles
// --------------------------------------------------------------------

/**
 * Stub XRSession. Captures listeners so the test harness can trigger
 * the 'end' event imperatively (simulating a user pulling the
 * headset, system menu close, etc.).
 */
function makeStubSession() {
  const listeners = new Map<string, Set<EventListener>>();
  let ended = false;
  const session = {
    addEventListener: vi.fn((type: string, cb: EventListener) => {
      const set = listeners.get(type) ?? new Set();
      set.add(cb);
      listeners.set(type, set);
    }),
    removeEventListener: vi.fn((type: string, cb: EventListener) => {
      listeners.get(type)?.delete(cb);
    }),
    end: vi.fn(async () => {
      if (ended) return;
      ended = true;
      // Real sessions fire 'end' asynchronously after end() resolves.
      // We fire synchronously here for test determinism.
      listeners.get('end')?.forEach((cb) => cb(new Event('end')));
    }),
  };
  return {
    session: session as unknown as XRSession,
    triggerEnd() {
      ended = true;
      listeners.get('end')?.forEach((cb) => cb(new Event('end')));
    },
  };
}

/**
 * Stub the renderer's `xr` slice with just the bits XRManager calls.
 * Real three.js WebGLRenderer requires a WebGL context; not worth
 * bringing in for these lifecycle tests.
 */
function makeStubRenderer() {
  let presenting = false;
  return {
    xr: {
      get isPresenting() { return presenting; },
      enabled: false,
      setSession: vi.fn(async () => { presenting = true; }),
      getSession: vi.fn(() => null),
      setReferenceSpaceType: vi.fn(),
      setFramebufferScaleFactor: vi.fn(),
      setFoveation: vi.fn(),
    },
    _setPresenting(v: boolean) { presenting = v; },
  } as unknown as THREE.WebGLRenderer & { _setPresenting(v: boolean): void };
}

/**
 * Minimal CameraRig stand-in. The tests only need to verify that
 * `currentView()` is sampled on session start and `applySavedView`
 * is called with that snapshot on session end.
 */
function makeStubCameraRig() {
  return {
    currentView: vi.fn(() => ({
      posX: 1, posY: 2, posZ: 3,
      targetX: 0, targetY: 0, targetZ: 0,
      upX: 0, upY: 1, upZ: 0,
      fov: 50,
    })),
    applySavedView: vi.fn(),
  } as unknown as CameraRig & {
    currentView: ReturnType<typeof vi.fn>;
    applySavedView: ReturnType<typeof vi.fn>;
  };
}

/**
 * Test helper: install a fake `navigator.xr` that returns the given
 * supported modes and queues sessions to return on requestSession.
 */
function installFakeXR(opts: {
  supported: { vr: boolean; ar: boolean };
  session?: XRSession;
  requestThrows?: Error;
}) {
  const xr = {
    isSessionSupported: vi.fn(async (mode: string) =>
      mode === 'immersive-vr' ? opts.supported.vr : opts.supported.ar,
    ),
    requestSession: vi.fn(async () => {
      if (opts.requestThrows) throw opts.requestThrows;
      return opts.session!;
    }),
  };
  Object.defineProperty(navigator, 'xr', { value: xr, configurable: true });
  return xr;
}

function buildManager(deps?: {
  toast?: (msg: string) => void;
}) {
  const renderer = makeStubRenderer();
  const cameraRig = makeStubCameraRig();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x223344);
  const meshGroup = new THREE.Group();
  meshGroup.position.set(0, 0, 0);
  meshGroup.scale.set(1, 1, 1);

  // PerformanceProfileManager wants a SettingsStore and a targets bag;
  // we pass real settings (its v11 defaults include the XR keys) and
  // a no-op targets impl so beginXrSession / endXrSession exercise
  // the actual stash/restore path.
  const targets = {
    setBloomEnabled: vi.fn(),
    setChromaEnabled: vi.fn(),
    setVignetteEnabled: vi.fn(),
    setRenderQuality: vi.fn(),
  };
  const perfMgr = new PerformanceProfileManager(settings, targets);

  let layoutMode: 'compact' | 'standard' | 'expansive' = 'standard';
  const toastFn = deps?.toast ?? (() => {});

  const mgr = new XRManager(
    {
      renderer,
      scene,
      meshGroup,
      cameraRig,
      settings,
      perfMgr,
      getLayoutMode: () => layoutMode,
    },
    { show: toastFn },
  );

  return {
    mgr,
    renderer,
    cameraRig,
    perfMgr,
    scene,
    meshGroup,
    setLayoutMode(m: typeof layoutMode) { layoutMode = m; },
  };
}

// --------------------------------------------------------------------
// Suites
// --------------------------------------------------------------------

afterEach(() => {
  // Wipe injected XR globals + visibility hint between tests so cross-
  // contamination can't pass a test that should fail.
  delete (navigator as { xr?: unknown }).xr;
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});

describe('XRManager — feature detection', () => {
  it('returns false for both modes when navigator.xr is absent', async () => {
    delete (navigator as { xr?: unknown }).xr;
    const { mgr } = buildManager();
    const support = await mgr.getSupport();
    expect(support).toEqual({ vr: false, ar: false });
  });

  it('reflects per-mode support from navigator.xr', async () => {
    installFakeXR({ supported: { vr: true, ar: false } });
    const { mgr } = buildManager();
    const support = await mgr.getSupport();
    expect(support).toEqual({ vr: true, ar: false });
  });

  it('swallows isSessionSupported errors and reports false', async () => {
    Object.defineProperty(navigator, 'xr', {
      value: { isSessionSupported: vi.fn(async () => { throw new Error('boom'); }) },
      configurable: true,
    });
    const { mgr } = buildManager();
    expect(await mgr.isSupported('immersive-vr')).toBe(false);
  });
});

describe('XRManager — session lifecycle', () => {
  beforeEach(() => {
    // Restore default values that other suites may have flipped.
    settings.set('xrAutoEndOnVisibilityChange', true);
    settings.set('xrMeshScale', 'tabletop');
    settings.set('xrPerformanceProfile', 'balanced');
  });

  it('startSession wires three.js XR, stashes camera + mesh, fires onSessionStart', async () => {
    const { session } = makeStubSession();
    installFakeXR({ supported: { vr: true, ar: true }, session });
    const { mgr, renderer, cameraRig, meshGroup } = buildManager();

    const startCb = vi.fn();
    mgr.onSessionStart(startCb);

    await mgr.startSession('immersive-vr');

    expect(mgr.sessionMode).toBe('immersive-vr');
    expect(mgr.isActive).toBe(true);
    expect(cameraRig.currentView).toHaveBeenCalledTimes(1);
    expect(renderer.xr.setSession).toHaveBeenCalledWith(session);
    expect(renderer.xr.setReferenceSpaceType).toHaveBeenCalledWith('local-floor');
    expect(renderer.xr.setFramebufferScaleFactor).toHaveBeenCalled();
    expect(renderer.xr.setFoveation).toHaveBeenCalled();
    // Tabletop framing → mesh translated to chest height 1m ahead.
    expect(meshGroup.position.y).toBeCloseTo(1.2);
    expect(meshGroup.position.z).toBeCloseTo(-1.0);
    expect(startCb).toHaveBeenCalledTimes(1);
  });

  it('AR mode requests hit-test and clears scene background for passthrough', async () => {
    const { session } = makeStubSession();
    const xr = installFakeXR({ supported: { vr: true, ar: true }, session });
    const { mgr, scene } = buildManager();

    await mgr.startSession('immersive-ar');

    expect(xr.requestSession).toHaveBeenCalledWith(
      'immersive-ar',
      expect.objectContaining({
        requiredFeatures: ['local-floor'],
        optionalFeatures: expect.arrayContaining(['hit-test']),
      }),
    );
    expect(scene.background).toBeNull();
  });

  it('VR mode forces black scene background', async () => {
    const { session } = makeStubSession();
    installFakeXR({ supported: { vr: true, ar: true }, session });
    const { mgr, scene } = buildManager();

    await mgr.startSession('immersive-vr');

    expect(scene.background).toBeInstanceOf(THREE.Color);
    expect((scene.background as THREE.Color).getHex()).toBe(0x000000);
  });

  it('rejects double-start while a session is already active', async () => {
    const { session } = makeStubSession();
    installFakeXR({ supported: { vr: true, ar: true }, session });
    const { mgr } = buildManager();

    await mgr.startSession('immersive-vr');
    await expect(mgr.startSession('immersive-vr')).rejects.toThrow(/already active/);
  });

  it('endSession via the XRSession end event restores stash and fires onSessionEnd', async () => {
    const { session, triggerEnd } = makeStubSession();
    installFakeXR({ supported: { vr: true, ar: true }, session });
    const { mgr, cameraRig, meshGroup, scene } = buildManager();
    const originalBg = scene.background;

    await mgr.startSession('immersive-vr');
    const endCb = vi.fn();
    mgr.onSessionEnd(endCb);

    triggerEnd();

    expect(mgr.sessionMode).toBeNull();
    expect(mgr.isActive).toBe(false);
    expect(cameraRig.applySavedView).toHaveBeenCalledTimes(1);
    // Mesh transform restored to pre-XR identity.
    expect(meshGroup.position.x).toBe(0);
    expect(meshGroup.position.y).toBe(0);
    expect(meshGroup.position.z).toBe(0);
    expect(scene.background).toBe(originalBg);
    expect(endCb).toHaveBeenCalledTimes(1);
  });
});

describe('XRManager — visibilitychange handling', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  it('ends the session when document becomes hidden and the setting is on', async () => {
    settings.set('xrAutoEndOnVisibilityChange', true);
    const { session } = makeStubSession();
    installFakeXR({ supported: { vr: true, ar: true }, session });
    const { mgr } = buildManager();

    await mgr.startSession('immersive-vr');
    expect(mgr.isActive).toBe(true);

    // Standard jsdom pattern: flip document.hidden, then fire the event.
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    // session.end() is async; wait a tick for the end event to settle.
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(mgr.isActive).toBe(false);
  });

  it('does NOT end the session when document.hidden goes back to false', async () => {
    settings.set('xrAutoEndOnVisibilityChange', true);
    const { session } = makeStubSession();
    installFakeXR({ supported: { vr: true, ar: true }, session });
    const { mgr } = buildManager();

    await mgr.startSession('immersive-vr');
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(mgr.isActive).toBe(true);
  });

  it('ignores visibilitychange when the setting is off', async () => {
    settings.set('xrAutoEndOnVisibilityChange', false);
    const { session } = makeStubSession();
    installFakeXR({ supported: { vr: true, ar: true }, session });
    const { mgr } = buildManager();

    await mgr.startSession('immersive-vr');
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(mgr.isActive).toBe(true);
  });
});

describe('XRManager — performance profile stash/restore', () => {
  beforeEach(() => {
    settings.set('xrAutoEndOnVisibilityChange', true);
    settings.set('performanceProfile', {
      compact: 'battery', standard: 'balanced', expansive: 'quality',
    });
  });

  it('restores stashed desktop profile when user did NOT change it during XR', async () => {
    const { session, triggerEnd } = makeStubSession();
    installFakeXR({ supported: { vr: true, ar: true }, session });
    const toast = vi.fn();
    const { mgr, perfMgr } = buildManager({ toast });

    await mgr.startSession('immersive-vr');
    expect(perfMgr.inXrSession).toBe(true);
    triggerEnd();

    expect(perfMgr.inXrSession).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });

  it('keeps user-changed profile and toasts when desktop profile mutated mid-XR', async () => {
    const { session, triggerEnd } = makeStubSession();
    installFakeXR({ supported: { vr: true, ar: true }, session });
    const toast = vi.fn();
    const { mgr } = buildManager({ toast });

    await mgr.startSession('immersive-vr');
    // User changes desktop standard profile from 'balanced' to 'battery'
    // while wearing the headset.
    settings.set('performanceProfile', {
      compact: 'battery', standard: 'battery', expansive: 'quality',
    });
    triggerEnd();

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatch(/battery/);
    expect(toast.mock.calls[0][0]).toMatch(/during XR session/);
  });
});

describe('XRManager — setMeshScale', () => {
  it('persists scale setting and re-frames live mesh when called mid-session', async () => {
    const { session } = makeStubSession();
    installFakeXR({ supported: { vr: true, ar: true }, session });
    const { mgr, meshGroup } = buildManager();
    settings.set('xrMeshScale', 'tabletop');

    await mgr.startSession('immersive-vr');
    expect(meshGroup.position.z).toBeCloseTo(-1.0);

    mgr.setMeshScale('roomscale');
    expect(settings.get('xrMeshScale')).toBe('roomscale');
    expect(meshGroup.position.z).toBeCloseTo(-2.0);
    expect(meshGroup.scale.x).toBeCloseTo(1.5);
  });
});
