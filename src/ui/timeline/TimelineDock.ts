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
import { upsertTimeline } from '../../sequencer/store';

export class TimelineDock {
  private host: HTMLElement;
  private settings: SettingsStore;
  private seq: Sequencer;

  private transport: TimelineTransport;
  private ruler: TimelineRuler;
  private track: TimelineTrack;
  private inspector: TimelineInspector;
  private body!: HTMLElement;
  private scroller!: HTMLElement;
  private canvas!: HTMLElement;
  private mini!: HTMLElement;
  private pixelsPerBar = 60;
  private hovered = false;

  constructor(host: HTMLElement, settings: SettingsStore, seq: Sequencer) {
    this.host = host;
    this.settings = settings;
    this.seq = seq;

    this.transport = new TimelineTransport(settings, seq, {
      onZoomChange: (z) => this.setZoom(z),
    });
    this.ruler     = new TimelineRuler(seq);
    this.track     = new TimelineTrack(seq);
    this.inspector = new TimelineInspector(seq);

    this.build();
    this.bindEvents();
    this.applyDockState(settings.get('timelineDock'), settings.get('timelineHeight'));
    this.refreshAll();
  }

  // -----------------------------------------------------------------
  // Layout
  // -----------------------------------------------------------------

  private build(): void {
    this.host.innerHTML = '';

    // Mini-strip handle for hidden mode.
    this.mini = document.createElement('div');
    this.mini.className = 'rw-tl-mini';
    this.mini.textContent = '▲ SHOW TIMELINE';
    this.mini.addEventListener('click', () => {
      this.settings.set('timelineDock', 'bottom');
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
      this.transport.updateReadout(bar);
    };
    this.seq.onTimelineChange = () => {
      this.refreshAll();
      // Persist immediately on structural changes.
      if (this.seq.timeline) upsertTimeline(this.seq.timeline);
    };
    this.seq.onSelectionChange = (id) => {
      this.track.applySelection(id);
      this.inspector.render();
    };

    // Settings -> dock state
    this.settings.subscribe('timelineDock', (v) => {
      this.applyDockState(v, this.settings.get('timelineHeight'));
    });
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
      const name = window.prompt('Keyframe name?', `kf @ ${this.seq.playheadBar.toFixed(2)}`);
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
    } else {
      this.host.style.height = `${Math.max(140, Math.min(600, height))}px`;
      this.mini.style.display = 'none';
    }
  }

  setZoom(z: number): void {
    this.pixelsPerBar = z;
    this.transport.setZoom(z);
    this.ruler.setPixelsPerBar(z);
    this.track.setPixelsPerBar(z);
  }

  resize(): void {
    // Recompute widths if needed (no-op currently because widths follow
    // pixelsPerBar * lengthBars; placeholder for future).
    this.ruler.render();
    this.track.render();
  }

  refreshAll(): void {
    this.ruler.setPixelsPerBar(this.pixelsPerBar);
    this.track.setPixelsPerBar(this.pixelsPerBar);
    this.transport.refresh();
    this.inspector.render();
  }
}
