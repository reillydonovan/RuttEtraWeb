/**
 * Timeline dock root: assembles the Transport / Ruler / Track / Inspector
 * and wires keyboard shortcuts + dock-position handling. Lives in its own
 * #timeline-dock element so it overlays the canvas independently of the
 * side ControlPanel.
 */

import { SettingsStore } from '../../state/Settings';
import { Sequencer } from '../../sequencer/Sequencer';
import { TimelineTransport } from './TimelineTransport';
import { TimelineRuler } from './TimelineRuler';
import { TimelineTrack } from './TimelineTrack';
import { TimelineInspector } from './TimelineInspector';
import { LaneEditor } from './LaneEditor';
import { LanePointSel } from './LaneRow';
import { setDockActions } from '../keyframeAffordance';
import { attachTooltip } from '../tooltip';

export class TimelineDock {
  private host: HTMLElement;
  /** Movable content wrapper (see build()) — public for the workspace
   *  region system. */
  viewRoot!: HTMLElement;
  private settings: SettingsStore;
  private seq: Sequencer;

  private transport: TimelineTransport;
  private ruler: TimelineRuler;
  private track: TimelineTrack;
  private inspector: TimelineInspector;
  private laneEditor: LaneEditor;
  private body!: HTMLElement;
  private scroller!: HTMLElement;
  private canvas!: HTMLElement;
  private mini!: HTMLElement;
  private pixelsPerBar = 60;
  private hovered = false;

  /**
   * Which lane point the inspector edits. Mutually exclusive with the
   * sequencer's scene-keyframe selection: picking one clears the other.
   */
  private laneSelection: LanePointSel | null = null;

  private setLaneSelection(sel: LanePointSel | null): void {
    this.laneSelection = sel;
    if (sel && this.seq.selectedKeyframeId) this.seq.selectKeyframe(null);
    this.laneEditor.applySelection();
    this.inspector.render();
  }

  constructor(host: HTMLElement, settings: SettingsStore, seq: Sequencer) {
    this.host = host;
    this.settings = settings;
    this.seq = seq;

    this.transport = new TimelineTransport(settings, seq, {
      onZoomChange: (z) => this.setZoom(z),
      onJumpKeyframe: (dir) => this.jumpToKeyframe(dir),
    });
    this.ruler     = new TimelineRuler(seq, settings);
    this.track     = new TimelineTrack(seq);
    this.inspector = new TimelineInspector(seq, {
      settings,
      laneSelection: () => this.laneSelection,
      setLaneSelection: (sel) => this.setLaneSelection(sel),
      // Typing in the inspector's Offset field live-previews the curve
      // in the lane row before the change commits.
      previewToTimeline: (laneId, bar, value) => this.laneEditor.previewPoint(laneId, bar, value),
    });
    this.laneEditor = new LaneEditor(settings, seq, {
      selection: () => this.laneSelection,
      selectPoint: (sel) => this.setLaneSelection(sel),
      // Dragging a point live-updates the inspector's Bar/Offset fields
      // before the drag commits.
      previewToInspector: (laneId, bar, value) => this.inspector.previewLanePoint(laneId, bar, value),
    });

    this.build();
    this.bindEvents();
    this.applyDockState(settings.get('timelineDock'), settings.get('timelineHeight'));
    this.refreshAll();

    // Let the panel ◆ diamonds' "Open in timeline" reach this dock.
    setDockActions({ revealLane: (id) => this.revealLane(id) });
  }

  /** Scroll a lane into view and flash it (used by the panel ◆ menu). */
  revealLane(laneId: string): void {
    this.laneEditor.revealLane(laneId);
  }

  /**
   * Jump the playhead to the previous/next keyframe. When a lane point
   * is selected, navigate that lane's points (and select the landed
   * point); otherwise navigate the union of scene bars and every lane's
   * point bars.
   */
  jumpToKeyframe(dir: -1 | 1): void {
    const t = this.seq.timeline;
    if (!t) return;
    const laneId = this.laneSelection?.laneId ?? null;
    const lane = laneId ? t.lanes.find((l) => l.id === laneId) : null;
    const bars = lane
      ? lane.points.map((p) => p.bar)
      : [
          ...t.keyframes.map((k) => k.bar),
          ...t.lanes.flatMap((l) => l.points.map((p) => p.bar)),
        ];
    bars.sort((a, b) => a - b);
    const eps = 1e-6;
    const head = this.seq.playheadBar;
    const target = dir > 0
      ? bars.find((b) => b > head + eps)
      : [...bars].reverse().find((b) => b < head - eps);
    if (target === undefined) return;
    this.seq.seek(target);
    if (lane) this.setLaneSelection({ laneId: lane.id, bar: target });
  }

  // -----------------------------------------------------------------
  // Layout
  // -----------------------------------------------------------------

  private build(): void {
    this.host.innerHTML = '';

    // Mini-strip handle for hidden mode. Restores last visible dock side.
    this.mini = document.createElement('div');
    this.mini.className = 'rw-tl-mini';
    this.refreshMiniLabel();
    this.mini.addEventListener('click', () => {
      this.settings.set('timelineDock', this.settings.get('timelineLastDock'));
    });
    this.host.appendChild(this.mini);

    // Movable CONTENT wrapper (transport + body) — the workspace region
    // system re-parents this to host the Timeline view in another
    // region. Shell chrome (mini strip, height handle) stays on host.
    this.viewRoot = document.createElement('div');
    this.viewRoot.className = 'rw-timeline-view';
    this.host.appendChild(this.viewRoot);

    // Header (transport)
    this.viewRoot.appendChild(this.transport.el);

    // Body: scroller + inspector
    this.body = document.createElement('div');
    this.body.className = 'rw-tl-body';

    this.scroller = document.createElement('div');
    this.scroller.className = 'rw-tl-scroller';

    this.canvas = document.createElement('div');
    this.canvas.className = 'rw-tl-canvas';
    this.canvas.appendChild(this.ruler.el);
    this.canvas.appendChild(this.track.el);
    // Lane editor sits under the track INSIDE the shared canvas, so lane
    // rows inherit the ruler's bar scale and horizontal scroll for free.
    this.canvas.appendChild(this.laneEditor.el);
    this.scroller.appendChild(this.canvas);

    this.body.appendChild(this.scroller);
    this.body.appendChild(this.inspector.el);
    this.body.appendChild(this.buildInspectorResizeHandle());
    this.viewRoot.appendChild(this.body);

    // Height drag handle on the dock's free edge (top edge when docked
    // bottom, bottom edge when docked top — CSS picks the side).
    this.host.appendChild(this.buildHeightResizeHandle());

    // Hover-focus tracking for keyboard shortcuts.
    this.host.addEventListener('mouseenter', () => { this.hovered = true; });
    this.host.addEventListener('mouseleave', () => { this.hovered = false; });
  }

  private bindEvents(): void {
    // Sequencer events
    this.seq.onPlayStateChange = () => this.transport.refresh();
    this.seq.onPlayheadChange = (bar) => {
      this.track.updatePlayhead(bar);
      this.laneEditor.updatePlayhead(bar);
      this.transport.updateReadout(bar);
    };
    this.seq.onTimelineChange = () => {
      this.refreshAll();
      // Persistence lives in main.ts (addTimelineListener) so edits made
      // without the dock mounted also save.
    };
    this.seq.onSelectionChange = (id) => {
      // Scene and lane selection are mutually exclusive.
      if (id && this.laneSelection) this.setLaneSelection(null);
      this.track.applySelection(id);
      this.inspector.render();
    };

    // Settings -> dock state. Whenever a *visible* dock is chosen we record
    // it as the "last visible" side so toggling out of hidden returns to
    // the side the user prefers.
    this.settings.subscribe('timelineDock', (v) => {
      if (v === 'top' || v === 'bottom') this.settings.set('timelineLastDock', v);
      this.applyDockState(v, this.settings.get('timelineHeight'));
      this.refreshMiniLabel();
    });
    this.settings.subscribe('timelineLastDock', () => this.refreshMiniLabel());
    this.settings.subscribe('timelineHeight', (h) => {
      this.applyDockState(this.settings.get('timelineDock'), h);
    });
    // Fires immediately with the persisted value, then on every change
    // (drag handle, project load, migration backfill).
    this.settings.subscribe('timelineInspectorWidth', (w) => this.applyInspectorWidth(w));

    // Keyboard shortcuts (only when dock is hovered or focused).
    document.addEventListener('keydown', this.onKeyDown);
  }

  private onKeyDown = (ev: KeyboardEvent): void => {
    // Skip if focus is in an editable element.
    const tgt = ev.target as HTMLElement | null;
    const tag = tgt?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // Undo/redo is GLOBAL — not gated on dock hover like the rest of
    // these shortcuts. The point of a history stack is reaching for it
    // right after an edit made anywhere in the panel (including a
    // keyframe value tweaked via a slider with the timeline dock fully
    // hidden), without moving the mouse down to the timeline strip
    // first. Ctrl/Cmd+Z undoes; Ctrl+Y or Ctrl/Cmd+Shift+Z redoes
    // (Windows and Mac conventions both work).
    if ((ev.ctrlKey || ev.metaKey) && (ev.code === 'KeyZ' || ev.code === 'KeyY')) {
      if (!this.seq.timeline) return;
      ev.preventDefault();
      const isRedo = ev.code === 'KeyY' || ev.shiftKey;
      if (isRedo) this.seq.redo(); else this.seq.undo();
      return;
    }

    if (!this.hovered && this.settings.get('timelineDock') === 'hidden') return;

    const t = this.seq.timeline;
    if (!t) return;
    if (ev.code === 'Space' && this.hovered) {
      ev.preventDefault();
      if (this.seq.isPlaying) this.seq.pause(); else this.seq.play();
    } else if (ev.code === 'ArrowLeft' && this.hovered) {
      ev.preventDefault();
      const step = ev.shiftKey ? 1 : 1 / t.beatsPerBar;
      this.seq.seek(this.seq.playheadBar - step);
    } else if (ev.code === 'ArrowRight' && this.hovered) {
      ev.preventDefault();
      const step = ev.shiftKey ? 1 : 1 / t.beatsPerBar;
      this.seq.seek(this.seq.playheadBar + step);
    } else if (ev.code === 'Home' && this.hovered) {
      ev.preventDefault();
      this.seq.seek(0);
    } else if (ev.code === 'Comma' && this.hovered) {
      ev.preventDefault();
      this.jumpToKeyframe(-1);
    } else if (ev.code === 'Period' && this.hovered) {
      ev.preventDefault();
      this.jumpToKeyframe(1);
    } else if ((ev.code === 'KeyK') && this.hovered) {
      ev.preventDefault();
      const name = window.prompt('Scene name?', `scene @ ${this.seq.playheadBar.toFixed(2)}`);
      this.seq.addKeyframe(this.seq.playheadBar, name ?? undefined);
    } else if (ev.code === 'Delete' && this.hovered) {
      const id = this.seq.selectedKeyframeId;
      if (id) {
        ev.preventDefault();
        this.seq.removeKeyframe(id);
      }
    }
  };

  // -----------------------------------------------------------------
  // Inspector column resize (drag its left edge; clamped 180–420)
  // -----------------------------------------------------------------

  private static readonly INSP_MIN = 180;
  private static readonly INSP_MAX = 420;

  private applyInspectorWidth(w: number): void {
    const clamped = Math.max(TimelineDock.INSP_MIN, Math.min(TimelineDock.INSP_MAX, w));
    // A custom property (not an inline grid-template) so the compact
    // media query's `grid-template-columns: 1fr` still wins.
    this.body.style.setProperty('--tl-insp-w', `${clamped}px`);
  }

  private buildInspectorResizeHandle(): HTMLElement {
    const handle = document.createElement('div');
    handle.className = 'rw-tl-insp-resize';
    attachTooltip(handle, 'Drag to resize the inspector');
    handle.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      handle.setPointerCapture?.(ev.pointerId);
      handle.classList.add('active');
      const startX = ev.clientX;
      const startW = Math.max(TimelineDock.INSP_MIN, Math.min(
        TimelineDock.INSP_MAX, this.settings.get('timelineInspectorWidth')));
      let lastW = startW;
      const onMove = (mv: PointerEvent): void => {
        // Dragging left widens the right-hand column.
        lastW = Math.max(TimelineDock.INSP_MIN, Math.min(
          TimelineDock.INSP_MAX, startW + (startX - mv.clientX)));
        this.applyInspectorWidth(lastW);
      };
      const onUp = (mv: PointerEvent): void => {
        handle.releasePointerCapture?.(mv.pointerId);
        handle.classList.remove('active');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        // Persist once per gesture, not per pixel.
        this.settings.set('timelineInspectorWidth', Math.round(lastW));
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    return handle;
  }

  // -----------------------------------------------------------------
  // Dock height resize (drag the free edge; clamped 100–900)
  // -----------------------------------------------------------------

  private static readonly HEIGHT_MIN = 100;
  private static readonly HEIGHT_MAX = 900;

  private buildHeightResizeHandle(): HTMLElement {
    const handle = document.createElement('div');
    handle.className = 'rw-tl-height-resize';
    attachTooltip(handle, 'Drag to resize the timeline dock');
    handle.addEventListener('pointerdown', (ev) => {
      if (this.settings.get('timelineDock') === 'hidden') return;
      ev.preventDefault();
      handle.setPointerCapture?.(ev.pointerId);
      handle.classList.add('active');
      const startY = ev.clientY;
      const startH = Math.max(TimelineDock.HEIGHT_MIN, Math.min(
        TimelineDock.HEIGHT_MAX, this.settings.get('timelineHeight')));
      // Docked bottom: dragging UP grows the dock. Docked top: down.
      const sign = this.settings.get('timelineDock') === 'top' ? 1 : -1;
      let lastH = startH;
      const onMove = (mv: PointerEvent): void => {
        lastH = Math.max(TimelineDock.HEIGHT_MIN, Math.min(
          TimelineDock.HEIGHT_MAX, startH + sign * (mv.clientY - startY)));
        this.host.style.height = `${lastH}px`;
        // Let the render canvas track the dock's footprint live, mid-drag.
        window.dispatchEvent(new Event('rw:layout-resize'));
      };
      const onUp = (mv: PointerEvent): void => {
        handle.releasePointerCapture?.(mv.pointerId);
        handle.classList.remove('active');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        // Persist once per gesture, not per pixel.
        this.settings.set('timelineHeight', Math.round(lastH));
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    return handle;
  }

  private applyDockState(dock: 'top' | 'bottom' | 'hidden', height: number): void {
    this.host.dataset.dock = dock;
    if (dock === 'hidden') {
      this.host.style.height = ``;
      this.mini.style.display = '';
      // Place the mini handle on the same side the user last had the dock.
      const last = this.settings.get('timelineLastDock');
      this.host.dataset.miniSide = last;
    } else {
      this.host.style.height = `${Math.max(TimelineDock.HEIGHT_MIN,
        Math.min(TimelineDock.HEIGHT_MAX, height))}px`;
      this.mini.style.display = 'none';
      this.host.dataset.miniSide = dock;
    }
  }

  /** Reflect the last visible dock side in the mini-handle's label. */
  private refreshMiniLabel(): void {
    const last = this.settings.get('timelineLastDock');
    this.mini.textContent = last === 'top' ? '▼ SHOW TIMELINE' : '▲ SHOW TIMELINE';
  }

  setZoom(z: number): void {
    this.pixelsPerBar = z;
    this.transport.setZoom(z);
    this.ruler.setPixelsPerBar(z);
    this.track.setPixelsPerBar(z);
    this.laneEditor.setPixelsPerBar(z);
  }

  resize(): void {
    // Recompute widths if needed (no-op currently because widths follow
    // pixelsPerBar * lengthBars; placeholder for future).
    this.ruler.render();
    this.track.render();
    this.laneEditor.render();
  }

  /** Drop the lane selection if its lane/point no longer exists. */
  private validateLaneSelection(): void {
    const sel = this.laneSelection;
    if (!sel) return;
    const lane = this.seq.timeline?.lanes.find((l) => l.id === sel.laneId);
    const point = lane?.points.find((p) => Math.abs(p.bar - sel.bar) <= 1e-9);
    if (!lane || !point) this.laneSelection = null;
  }

  refreshAll(): void {
    this.validateLaneSelection();
    this.ruler.setPixelsPerBar(this.pixelsPerBar);
    this.track.setPixelsPerBar(this.pixelsPerBar);
    this.laneEditor.setPixelsPerBar(this.pixelsPerBar);
    this.transport.refresh();
    this.inspector.render();
  }
}
