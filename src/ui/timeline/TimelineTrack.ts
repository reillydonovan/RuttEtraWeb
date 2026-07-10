/**
 * Track surface: renders keyframe diamonds, supports drag to reposition,
 * right-click context menu, and is a drop-target for preset cards from the
 * Presets section (MIME `application/x-ruttetra-preset`).
 */

import { Sequencer } from '../../sequencer/Sequencer';
import { Keyframe } from '../../sequencer/types';
import { showContextMenu, dismissContextMenu } from './contextMenu';
import type { Preset } from '../presets';

const PRESET_MIME = 'application/x-ruttetra-preset';

export class TimelineTrack {
  el: HTMLElement;
  private seq: Sequencer;
  private pixelsPerBar = 60;
  private kfElems = new Map<string, HTMLElement>();

  constructor(seq: Sequencer) {
    this.seq = seq;
    this.el = document.createElement('div');
    this.el.className = 'rw-tl-track';
    this.el.addEventListener('contextmenu', this.onTrackContext);
    // Double-click on empty track space adds a keyframe — primary path
    // for Windows users where system-level features (Windows Ink, tablet
    // drivers, precision touchpad gestures) can intercept right-click
    // before the browser sees it. Also matches the MIDI piano-roll
    // convention that most users already know.
    this.el.addEventListener('dblclick', this.onTrackDblClick);
    // Ctrl+click: third path, unambiguous on all platforms.
    this.el.addEventListener('click', this.onTrackClick);
    this.el.addEventListener('dragover', this.onDragOver);
    this.el.addEventListener('dragleave', this.onDragLeave);
    this.el.addEventListener('drop', this.onDrop);
  }

  setPixelsPerBar(p: number): void {
    this.pixelsPerBar = p;
    this.render();
  }

  render(): void {
    const t = this.seq.timeline;
    this.el.innerHTML = '';
    this.kfElems.clear();
    if (!t) return;
    this.el.style.width = `${t.lengthBars * this.pixelsPerBar}px`;
    // Sticky gutter label: this row holds SCENES (full-settings
    // snapshots); the per-param lanes live in the rows below.
    const gutter = document.createElement('div');
    gutter.className = 'rw-tl-track-label';
    gutter.textContent = 'SCENES';
    this.el.appendChild(gutter);
    // playhead
    const head = document.createElement('div');
    head.className = 'rw-tl-playhead';
    head.id = 'rw-tl-playhead';
    head.style.left = `${this.seq.playheadBar * this.pixelsPerBar}px`;
    this.el.appendChild(head);
    // keyframes
    for (const kf of t.keyframes) {
      const d = this.makeDiamond(kf);
      this.el.appendChild(d);
      this.kfElems.set(kf.id, d);
    }
    this.applySelection(this.seq.selectedKeyframeId);
  }

  updatePlayhead(bar: number): void {
    const head = this.el.querySelector<HTMLElement>('#rw-tl-playhead');
    if (head) head.style.left = `${bar * this.pixelsPerBar}px`;
  }

  applySelection(id: string | null): void {
    for (const [kfId, el] of this.kfElems) {
      el.classList.toggle('selected', kfId === id);
    }
  }

  private makeDiamond(kf: Keyframe): HTMLElement {
    const d = document.createElement('div');
    d.className = 'rw-tl-kf';
    if (kf.locked) d.classList.add('locked');
    d.style.left = `${kf.bar * this.pixelsPerBar}px`;
    if (kf.color) {
      d.style.background = kf.color;
      d.style.borderColor = kf.color;
    }
    if (kf.presetName) d.title = kf.presetName;

    const lbl = document.createElement('div');
    lbl.className = 'rw-tl-kf-label';
    lbl.textContent = kf.presetName || `bar ${kf.bar.toFixed(2)}`;
    d.appendChild(lbl);

    d.addEventListener('pointerdown', (ev) => this.onDiamondDown(ev, kf));
    d.addEventListener('contextmenu', (ev) => this.onDiamondContext(ev, kf));
    d.addEventListener('dblclick', (ev) => {
      ev.stopPropagation();
      this.seq.preview(kf.id);
    });
    return d;
  }

  // ====== drag keyframe ======
  private onDiamondDown = (ev: PointerEvent, kf: Keyframe): void => {
    if (kf.locked) return;
    if (ev.button !== 0) return;
    ev.stopPropagation();
    ev.preventDefault();
    this.seq.selectKeyframe(kf.id);

    const t = this.seq.timeline!;
    const startBar = kf.bar;
    const trackRect = this.el.getBoundingClientRect();
    const startX = ev.clientX;
    const target = ev.currentTarget as HTMLElement;
    target.setPointerCapture?.(ev.pointerId);

    const beatSnap = !ev.altKey;
    let lastBar = startBar;

    const onMove = (mv: PointerEvent) => {
      const dx = mv.clientX - startX;
      const dBars = dx / this.pixelsPerBar;
      let newBar = startBar + dBars;
      const free = mv.altKey || !beatSnap;
      if (!free) {
        const beats = newBar * t.beatsPerBar;
        const snappedBeats = Math.round(beats);
        newBar = snappedBeats / t.beatsPerBar;
      }
      newBar = Math.max(0, Math.min(t.lengthBars, newBar));
      if (newBar !== lastBar) {
        target.style.left = `${newBar * this.pixelsPerBar}px`;
        lastBar = newBar;
      }
    };
    const onUp = (mv: PointerEvent) => {
      target.releasePointerCapture?.(mv.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (lastBar !== startBar) {
        this.seq.moveKeyframe(kf.id, lastBar);
      }
      // trackRect not used after — silence linter without changing behaviour
      void trackRect;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ====== add keyframe via double-click / Ctrl+click ======

  /** Resolve click/dblclick position to a bar number. Returns null if the
   *  event originated on a keyframe diamond (so we don't accidentally add
   *  a keyframe when interacting with an existing one). */
  private barFromTrackEvent(ev: MouseEvent): number | null {
    const t = this.seq.timeline;
    if (!t) return null;
    // Ignore events that bubble up from a diamond — they have their own handlers.
    if ((ev.target as HTMLElement).closest('.rw-tl-kf')) return null;
    const rect = this.el.getBoundingClientRect();
    const x = ev.clientX - rect.left + this.el.scrollLeft;
    return Math.max(0, Math.min(t.lengthBars, x / this.pixelsPerBar));
  }

  private onTrackDblClick = (ev: MouseEvent): void => {
    const bar = this.barFromTrackEvent(ev);
    if (bar === null) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.seq.addKeyframe(bar);
  };

  private onTrackClick = (ev: MouseEvent): void => {
    if (!ev.ctrlKey && !ev.metaKey) return; // only Ctrl/Cmd+click
    const bar = this.barFromTrackEvent(ev);
    if (bar === null) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.seq.addKeyframe(bar);
  };

  // ====== context menus ======
  private onTrackContext = (ev: MouseEvent): void => {
    const t = this.seq.timeline;
    if (!t) return;
    ev.preventDefault();
    const rect = this.el.getBoundingClientRect();
    const x = ev.clientX - rect.left + this.el.scrollLeft;
    const bar = Math.max(0, Math.min(t.lengthBars, x / this.pixelsPerBar));
    showContextMenu(ev.clientX, ev.clientY, [
      { label: `Add scene at bar ${bar.toFixed(2)}`, onClick: () => {
        this.seq.addKeyframe(bar);
      } },
      { label: 'Seek here', onClick: () => this.seq.seek(bar) },
    ]);
  };

  private onDiamondContext = (ev: MouseEvent, kf: Keyframe): void => {
    ev.preventDefault();
    ev.stopPropagation();
    this.seq.selectKeyframe(kf.id);
    showContextMenu(ev.clientX, ev.clientY, [
      { label: 'Preview', onClick: () => this.seq.preview(kf.id) },
      { label: 'Replace snapshot with current', onClick: () => this.seq.replaceSnapshot(kf.id) },
      { label: 'Duplicate (+1 bar)', onClick: () => this.seq.duplicateKeyframe(kf.id) },
      { label: kf.locked ? 'Unlock' : 'Lock', onClick: () => this.seq.updateKeyframe(kf.id, { locked: !kf.locked }) },
      { separator: true, label: '' },
      { label: 'Easing: linear',    onClick: () => this.seq.updateKeyframe(kf.id, { easing: 'linear' }) },
      { label: 'Easing: easeIn',    onClick: () => this.seq.updateKeyframe(kf.id, { easing: 'easeIn' }) },
      { label: 'Easing: easeOut',   onClick: () => this.seq.updateKeyframe(kf.id, { easing: 'easeOut' }) },
      { label: 'Easing: easeInOut', onClick: () => this.seq.updateKeyframe(kf.id, { easing: 'easeInOut' }) },
      { label: 'Easing: step',      onClick: () => this.seq.updateKeyframe(kf.id, { easing: 'step' }) },
      { label: 'Easing: hold',      onClick: () => this.seq.updateKeyframe(kf.id, { easing: 'hold' }) },
      { separator: true, label: '' },
      { label: 'Delete', onClick: () => this.seq.removeKeyframe(kf.id) },
    ]);
  };

  // ====== drag-from-presets drop ======
  private onDragOver = (ev: DragEvent): void => {
    if (!ev.dataTransfer) return;
    if (Array.from(ev.dataTransfer.types).includes(PRESET_MIME)) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
      this.el.classList.add('drop-active');
    }
  };
  private onDragLeave = (): void => {
    this.el.classList.remove('drop-active');
  };
  private onDrop = (ev: DragEvent): void => {
    this.el.classList.remove('drop-active');
    const t = this.seq.timeline;
    if (!t || !ev.dataTransfer) return;
    const raw = ev.dataTransfer.getData(PRESET_MIME);
    if (!raw) return;
    ev.preventDefault();
    let preset: Preset;
    try {
      preset = JSON.parse(raw) as Preset;
    } catch {
      return;
    }
    const rect = this.el.getBoundingClientRect();
    const x = ev.clientX - rect.left + this.el.scrollLeft;
    let bar = x / this.pixelsPerBar;
    // Snap to beat unless Alt is held.
    if (!ev.altKey) {
      const beats = bar * t.beatsPerBar;
      bar = Math.round(beats) / t.beatsPerBar;
    }
    bar = Math.max(0, Math.min(t.lengthBars, bar));
    this.seq.addKeyframeFromPreset(bar, preset.values, preset.name);
  };

  destroy(): void {
    dismissContextMenu();
  }
}
