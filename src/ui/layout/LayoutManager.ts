/**
 * Single source of truth for responsive layout decisions.
 *
 * Three modes — `compact`, `standard`, `expansive` — derived from viewport
 * width and pointer/hover media queries. Plus exposed signals for touch,
 * hover, reduced motion, orientation, and safe-area insets.
 *
 * The thresholds match the brief's testing matrix:
 *   compact:   < 768px  OR  (pointer:coarse AND < 1024px)
 *   standard:  768..1919px
 *   expansive: >= 1920px
 *
 * Override via URL: `?layout=compact|standard|expansive` for testing.
 */

export type LayoutMode = 'compact' | 'standard' | 'expansive';

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

type ModeListener = (mode: LayoutMode) => void;

export class LayoutManager {
  /** Currently resolved mode. Use `current()` for a stable read. */
  private _mode: LayoutMode;
  private listeners = new Set<ModeListener>();
  private resizeTimer: number | null = null;
  private mqCoarse:  MediaQueryList;
  private mqHover:   MediaQueryList;
  private mqReduce:  MediaQueryList;
  private mqPortrait: MediaQueryList;
  private mqStandalone: MediaQueryList;
  private overrideMode: LayoutMode | null;
  private debugFlag: boolean;
  private debugGraphFlag: boolean;

  constructor() {
    this.mqCoarse     = window.matchMedia('(pointer: coarse)');
    this.mqHover      = window.matchMedia('(hover: hover)');
    this.mqReduce     = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.mqPortrait   = window.matchMedia('(orientation: portrait)');
    this.mqStandalone = window.matchMedia('(display-mode: standalone)');

    const params = new URLSearchParams(window.location.search);
    const layoutParam = params.get('layout');
    this.overrideMode = (layoutParam === 'compact' || layoutParam === 'standard' || layoutParam === 'expansive')
      ? layoutParam
      : null;
    this.debugFlag = params.get('debug') === 'layout';
    // `?debug=graph` overlays GraphEngine stats alongside the layout panel.
    this.debugGraphFlag = params.get('debug') === 'graph';

    this._mode = this.compute();

    // Wire listeners.
    const re = () => this.scheduleRecompute();
    window.addEventListener('resize', re);
    window.addEventListener('orientationchange', re);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', re);
    }
    addMqListener(this.mqCoarse,   re);
    addMqListener(this.mqHover,    re);
    addMqListener(this.mqPortrait, re);
    // reduced-motion change is observable by consumers via `prefersReducedMotion` getter; nothing to recompute.
  }

  // ------------------------------------------------------------ public API

  current(): LayoutMode { return this._mode; }
  get mode(): LayoutMode { return this._mode; }

  onModeChange(fn: ModeListener): () => void {
    this.listeners.add(fn);
    fn(this._mode);
    return () => { this.listeners.delete(fn); };
  }

  get hasTouch():  boolean { return this.mqCoarse.matches; }
  get hasHover():  boolean { return this.mqHover.matches; }
  get prefersReducedMotion(): boolean { return this.mqReduce.matches; }
  get orientation(): 'portrait' | 'landscape' { return this.mqPortrait.matches ? 'portrait' : 'landscape'; }
  get isStandalone(): boolean { return this.mqStandalone.matches; }
  get isDebug():   boolean { return this.debugFlag; }
  /** True when the URL contains `?debug=graph`. */
  get isDebugGraph(): boolean { return this.debugGraphFlag; }

  /** Read CSS env() insets via a hidden probe element. */
  safeAreaInsets(): SafeAreaInsets {
    return readSafeAreaInsets();
  }

  /** Returns viewport size honoring visualViewport when available (URL bar correctness on mobile). */
  viewport(): { width: number; height: number } {
    if (window.visualViewport) {
      return {
        width:  Math.round(window.visualViewport.width),
        height: Math.round(window.visualViewport.height),
      };
    }
    return { width: window.innerWidth, height: window.innerHeight };
  }

  /** Force a re-compute (debounced ~150ms). */
  scheduleRecompute(): void {
    if (this.resizeTimer != null) return;
    this.resizeTimer = window.setTimeout(() => {
      this.resizeTimer = null;
      const next = this.compute();
      if (next !== this._mode) {
        this._mode = next;
        for (const fn of this.listeners) fn(next);
      }
    }, 150);
  }

  // ---------------------------------------------------------------- internals

  private compute(): LayoutMode {
    if (this.overrideMode) return this.overrideMode;
    const w = this.viewport().width;
    const coarse = this.mqCoarse.matches;
    if (w < 768 || (coarse && w < 1024)) return 'compact';
    if (w >= 1920) return 'expansive';
    return 'standard';
  }
}

function addMqListener(mql: MediaQueryList, fn: () => void): void {
  // Older Safari only supports the legacy `addListener` API.
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', fn);
  } else {
    (mql as MediaQueryList & { addListener: (fn: () => void) => void }).addListener(fn);
  }
}

function readSafeAreaInsets(): SafeAreaInsets {
  // Use a transient probe element so we don't pollute the DOM on every call.
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;' +
    'padding-top:env(safe-area-inset-top);' +
    'padding-right:env(safe-area-inset-right);' +
    'padding-bottom:env(safe-area-inset-bottom);' +
    'padding-left:env(safe-area-inset-left);' +
    'visibility:hidden;pointer-events:none;';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const out: SafeAreaInsets = {
    top:    parseFloat(cs.paddingTop)    || 0,
    right:  parseFloat(cs.paddingRight)  || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left:   parseFloat(cs.paddingLeft)   || 0,
  };
  probe.remove();
  return out;
}

/** Singleton accessor (constructed lazily). */
let _instance: LayoutManager | null = null;
export function layoutManager(): LayoutManager {
  if (!_instance) _instance = new LayoutManager();
  return _instance;
}
