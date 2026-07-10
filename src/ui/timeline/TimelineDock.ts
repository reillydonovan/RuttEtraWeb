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

export class TimelineDock {
  private host: HTMLElement;
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
    });
    this.ruler     = new TimelineRuler(seq);
    this.track     = new TimelineTrack(seq);
    this.inspector = new TimelineInspector(seq, {
      settings,
      laneSelection: () => this.laneSelection,
      setLaneSelection: (sel) => this.setLaneSelection(sel),
    });
    this.laneEditor = new LaneEditor(settings, seq, {
      selection: () => this.laneSelection,
      selectPoint: (sel) => this.setLaneSelection(sel),
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

    // Header (transport)
    this.host.appendChild(this.transport.el);

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
    this.host.appendChild(this.body);

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

    // Keyboard shortcuts (only when dock is hovered or focused).
    document.addEventListener('keydown', this.onKeyDown);
  }

  private onKeyDown = (ev: KeyboardEvent): void => {
    // Skip if focus is in an editable element.
    const tgt = ev.target as HTMLElement | null;
    const tag = tgt?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
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
    } else if ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyZ') {
      if (!this.hovered) return;
      ev.preventDefault();
      if (ev.shiftKey) this.seq.redo(); else this.seq.undo();
    }
  };

  private applyDockState(dock: 'top' | 'bottom' | 'hidden', height: number): void {
    this.host.dataset.dock = dock;
    if (dock === 'hidden') {
      this.host.style.height = ``;
      this.mini.style.display = '';
      // Place the mini handle on the same side the user last had the dock.
      const last = this.settings.get('timelineLastDock');
      this.host.dataset.miniSide = last;
    } else {
      this.host.style.height = `${Math.max(140, Math.min(600, height))}px`;
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
