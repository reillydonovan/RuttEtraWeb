/**
 * Manages render-target resolution independently of the display canvas's
 * CSS size. The canvas always fills its container visually; this module
 * controls how many GPU pixels are actually rendered and how the resulting
 * image is letterboxed / filled / stretched inside the viewport.
 *
 * Three operating modes (set via `settings.renderResolutionId`):
 *   'match'  – render matches the canvas CSS display size (default)
 *   preset   – fixed pixel count (e.g. 1920×1080) irrespective of window
 *   'custom' – user-supplied width × height
 *
 * Fit modes (set via `settings.renderFitMode`):
 *   'letterbox' – center the render inside the viewport with black bars
 *   'fill'      – scale up so the render fills the viewport, cropping edges
 *   'stretch'   – use the preset's aspect ratio but scale to match viewport's
 *                 longest axis, then stretch CSS to fill (no bars/crop)
 */

import * as THREE from 'three';
import type { SettingsStore } from '../state/Settings';
import type { PostFX } from './Postfx';
import type { RuttEtraScene } from './RuttEtra';
import type { CameraRig } from './CameraRig';
import type { PatternRenderer } from './patterns/PatternRenderer';

export interface ResolutionPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  description: string;
  /** Hide on compact (mobile) layout — 4K on a phone is hostile. */
  desktopOnly?: boolean;
}

export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { id: 'match',  label: 'Match Window',    width: 0,    height: 0,    description: 'Render at the canvas display size (default).' },
  { id: 'sd',     label: 'SD (480p)',        width: 854,  height: 480,  description: '854×480 — low GPU load, retro feel.' },
  { id: 'hd',     label: 'HD (720p)',        width: 1280, height: 720,  description: '1280×720 — balanced quality and performance.' },
  { id: 'fhd',    label: 'Full HD (1080p)',  width: 1920, height: 1080, description: '1920×1080 — standard recording resolution.' },
  { id: 'qhd',    label: 'QHD (1440p)',      width: 2560, height: 1440, description: '2560×1440 — high quality, moderate GPU load.', desktopOnly: true },
  { id: 'uhd',    label: '4K UHD (2160p)',   width: 3840, height: 2160, description: '3840×2160 — maximum quality, heavy GPU load.', desktopOnly: true },
  { id: 'dci4k',  label: 'DCI 4K',           width: 4096, height: 2160, description: '4096×2160 — cinema-standard 4K.', desktopOnly: true },
  { id: 'custom', label: 'Custom…',          width: 0,    height: 0,    description: 'Enter your own width and height.' },
];

export class ResolutionManager {
  private _actualW = 0;
  private _actualH = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly settings: SettingsStore,
  ) {}

  get actualWidth():  number { return this._actualW; }
  get actualHeight(): number { return this._actualH; }

  /**
   * Called from main.ts' `resize()`. Computes the render-target dimensions,
   * updates the renderer / composer / camera, and repositions the canvas
   * element for the chosen fit mode.
   *
   * @param viewportW/H The space AVAILABLE to the canvas — the full window
   *                    minus whatever the side panel and timeline dock
   *                    currently occupy, not necessarily the raw window
   *                    size (see `availableCanvasRect()` in main.ts).
   * @param dpr         Effective device-pixel-ratio for Match Window mode
   *                    (already incorporates the render-scale slider).
   * @param renderScale Raw user render-scale value (used for preset modes so
   *                    device DPR is not double-applied against the preset's
   *                    fixed pixel count).
   * @param offsetX/Y   Top-left corner of that available space within the
   *                    viewport (nonzero when the panel is docked left or
   *                    the timeline dock is docked top) — the canvas is
   *                    positioned there instead of always at (0, 0), so it
   *                    fills its own bounded region rather than the panel
   *                    and dock overlaying a full-bleed canvas.
   */
  apply(
    renderer:    THREE.WebGLRenderer,
    postfx:      PostFX,
    ruttEtra:    RuttEtraScene,
    rig:         CameraRig,
    viewportW:   number,
    viewportH:   number,
    dpr:         number,
    renderScale: number,
    patternRenderer: PatternRenderer | null = null,
    offsetX = 0,
    offsetY = 0,
  ): void {
    const id      = this.settings.get('renderResolutionId');
    const fitMode = this.settings.get('renderFitMode');

    // ---- Match Window: delegate to existing resize logic ----
    if (id === 'match') {
      this._commitRenderer(renderer, postfx, ruttEtra, patternRenderer, viewportW, viewportH, dpr);
      this._resetCanvasCSS(viewportW, viewportH, offsetX, offsetY);
      rig.resize(viewportW, viewportH);
      return;
    }

    // ---- Resolve target dimensions ----
    let targetW: number, targetH: number;

    if (id === 'custom') {
      targetW = Math.max(256, Math.min(7680, Math.round(this.settings.get('renderResolutionCustomW'))));
      targetH = Math.max(256, Math.min(7680, Math.round(this.settings.get('renderResolutionCustomH'))));
    } else {
      const preset = RESOLUTION_PRESETS.find((p) => p.id === id);
      if (!preset || preset.width === 0) {
        // Unknown preset ID — fall back to match-window
        this._commitRenderer(renderer, postfx, ruttEtra, patternRenderer, viewportW, viewportH, dpr);
        this._resetCanvasCSS(viewportW, viewportH, offsetX, offsetY);
        rig.resize(viewportW, viewportH);
        return;
      }
      targetW = preset.width;
      targetH = preset.height;
    }

    // ---- Stretch: scale the preset's aspect to the viewport's longest axis ----
    if (fitMode === 'stretch') {
      const aspect   = targetW / targetH;
      const vpAspect = viewportW / viewportH;
      let renderW: number, renderH: number;
      if (vpAspect >= aspect) {
        renderH = viewportH;
        renderW = Math.round(renderH * aspect);
      } else {
        renderW = viewportW;
        renderH = Math.round(renderW / aspect);
      }
      // Render at aspect-correct size, then let CSS fill the available rect.
      this._commitRenderer(renderer, postfx, ruttEtra, patternRenderer, renderW, renderH, renderScale);
      const c = this.canvas;
      c.style.position = 'absolute';
      c.style.inset    = '';
      c.style.width    = `${viewportW}px`;
      c.style.height   = `${viewportH}px`;
      c.style.left     = `${offsetX}px`;
      c.style.top      = `${offsetY}px`;
      rig.resize(renderW, renderH);
      return;
    }

    // ---- Letterbox / Fill ----
    this._commitRenderer(renderer, postfx, ruttEtra, patternRenderer, targetW, targetH, renderScale);

    const scaleX  = viewportW / targetW;
    const scaleY  = viewportH / targetH;
    const scale   = fitMode === 'fill'
      ? Math.max(scaleX, scaleY)
      : Math.min(scaleX, scaleY);  // letterbox
    const cssW    = targetW * scale;
    const cssH    = targetH * scale;
    const offsetL = offsetX + (viewportW - cssW) / 2;
    const offsetT = offsetY + (viewportH - cssH) / 2;

    const c = this.canvas;
    c.style.position = 'absolute';
    c.style.inset    = '';
    c.style.width    = `${cssW}px`;
    c.style.height   = `${cssH}px`;
    c.style.left     = `${offsetL}px`;
    c.style.top      = `${offsetT}px`;

    // Resize rig AFTER CSS is applied so TrackballControls reads the correct
    // bounding rect (which determines gesture screen-space mapping).
    rig.resize(targetW, targetH);
  }

  private _commitRenderer(
    renderer:        THREE.WebGLRenderer,
    postfx:          PostFX,
    ruttEtra:        RuttEtraScene,
    patternRenderer: PatternRenderer | null,
    w:               number,
    h:               number,
    pixelRatio:      number,
  ): void {
    this._actualW = w;
    this._actualH = h;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    postfx.resize(w, h);
    ruttEtra.setSize(w, h);
    patternRenderer?.setSize(w, h);
  }

  /** Size + position the canvas to exactly the available rect (full
   *  viewport minus whatever the panel/timeline dock occupy — see the
   *  `offsetX/Y` doc on `apply()`). Explicit px, not `inset: 0` /
   *  `100%`, because the canvas is a SUB-region of `#app` now, not
   *  necessarily the whole thing. */
  private _resetCanvasCSS(w: number, h: number, offsetX: number, offsetY: number): void {
    const c = this.canvas;
    c.style.position = 'absolute';
    c.style.inset    = '';
    c.style.width    = `${w}px`;
    c.style.height   = `${h}px`;
    c.style.left     = `${offsetX}px`;
    c.style.top      = `${offsetY}px`;
  }
}
