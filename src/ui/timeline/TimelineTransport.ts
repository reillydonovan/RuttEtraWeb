/**
 * Top-strip transport: timeline picker, play/pause/stop/loop, BPM, length,
 * sync mode, dock-position toggle, zoom +/-, bar readout.
 */

import { SettingsStore } from '../../state/Settings';
import { Sequencer } from '../../sequencer/Sequencer';
import {
  loadTimelines, saveTimelines, upsertTimeline, deleteTimeline,
  exportTimeline, importTimelineJson,
} from '../../sequencer/store';
import { makeEmptyTimeline } from '../../sequencer/types';

export interface TransportEvents {
  onZoomChange?: (pixelsPerBar: number) => void;
  onTimelineSelected?: (id: string | null) => void;
  onDockToggle?: () => void;
  /** Jump the playhead to the previous / next keyframe (scene or lane point). */
  onJumpKeyframe?: (dir: -1 | 1) => void;
}

export class TimelineTransport {
  el: HTMLElement;
  private settings: SettingsStore;
  private seq: Sequencer;
  private events: TransportEvents;

  private timelinePicker!: HTMLSelectElement;
  private playBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private loopBtn!: HTMLButtonElement;
  private bpmInput!: HTMLInputElement;
  private lenInput!: HTMLInputElement;
  private bpbInput!: HTMLInputElement;
  private syncSel!: HTMLSelectElement;
  private readout!: HTMLSpanElement;
  private zoom = 60;

  constructor(settings: SettingsStore, seq: Sequencer, events: TransportEvents = {}) {
    this.settings = settings;
    this.seq = seq;
    this.events = events;
    this.el = document.createElement('div');
    this.el.className = 'rw-tl-header';
    this.build();
    this.refresh();
    // Mirror the global BPM into the transport input whenever it changes
    // anywhere (e.g. the Modulation panel's Tempo BPM control). The single
    // shared source ensures all three places — Timeline, Classic LFO,
    // Graph clock — stay in sync.
    settings.subscribe('internalBpm', (v) => {
      const s = String(v);
      if (this.bpmInput && this.bpmInput.value !== s) this.bpmInput.value = s;
    });
  }

  setZoom(z: number): void { this.zoom = z; }

  // -----------------------------------------------------------------
  // Build
  // -----------------------------------------------------------------

  private build(): void {
    const title = document.createElement('span');
    title.className = 'rw-tl-title';
    title.textContent = 'TIMELINE';
    this.el.appendChild(title);

    // Timeline picker
    this.timelinePicker = document.createElement('select');
    this.timelinePicker.className = 'rw-select';
    this.timelinePicker.title = 'Active timeline';
    this.timelinePicker.addEventListener('change', () => this.onPickTimeline());
    this.el.appendChild(this.timelinePicker);

    this.el.appendChild(this.btn('+ NEW', () => this.onNewTimeline()));
    this.el.appendChild(this.btn('SAVE',  () => this.onSaveTimeline()));
    this.el.appendChild(this.btn('REN',   () => this.onRenameTimeline(), 'Rename'));
    this.el.appendChild(this.btn('DEL',   () => this.onDeleteTimeline(), 'Delete', 'warn'));
    this.el.appendChild(this.btn('EXPORT', () => this.onExportTimeline(), 'Export JSON'));
    this.el.appendChild(this.btn('IMPORT', () => this.onImportTimeline(), 'Import JSON'));

    // Transport buttons
    this.playBtn = this.btn('PLAY', () => this.onPlayPause()) as HTMLButtonElement;
    this.playBtn.classList.add('primary');
    this.el.appendChild(this.playBtn);
    this.stopBtn = this.btn('STOP', () => this.seq.stop()) as HTMLButtonElement;
    this.el.appendChild(this.stopBtn);
    // Keyframe navigation: jump to the previous / next scene or lane
    // point (the selected lane's points when a lane point is selected).
    this.el.appendChild(this.btn('|◀', () => this.events.onJumpKeyframe?.(-1),
      'Jump to previous keyframe (,)'));
    this.el.appendChild(this.btn('▶|', () => this.events.onJumpKeyframe?.(1),
      'Jump to next keyframe (.)'));
    this.loopBtn = this.btn('LOOP', () => {
      const t = this.seq.timeline;
      if (!t) return;
      this.seq.setLoop(!t.loop);
    }) as HTMLButtonElement;
    this.el.appendChild(this.loopBtn);

    // BPM
    {
      const lbl = document.createElement('label');
      lbl.textContent = 'BPM';
      this.bpmInput = document.createElement('input');
      this.bpmInput.type = 'number';
      this.bpmInput.min = '20'; this.bpmInput.max = '400'; this.bpmInput.step = '1';
      this.bpmInput.className = 'rw-num';
      this.bpmInput.style.width = '64px';
      this.bpmInput.addEventListener('change', () => {
        const v = parseFloat(this.bpmInput.value);
        if (!Number.isNaN(v)) this.seq.setBpm(v);
      });
      lbl.appendChild(this.bpmInput);
      this.el.appendChild(lbl);
    }

    // Length (bars)
    {
      const lbl = document.createElement('label');
      lbl.textContent = 'BARS';
      this.lenInput = document.createElement('input');
      this.lenInput.type = 'number';
      this.lenInput.min = '1'; this.lenInput.max = '999'; this.lenInput.step = '1';
      this.lenInput.className = 'rw-num';
      this.lenInput.style.width = '54px';
      this.lenInput.addEventListener('change', () => {
        const v = parseInt(this.lenInput.value, 10);
        if (!Number.isNaN(v)) this.seq.setLengthBars(v);
      });
      lbl.appendChild(this.lenInput);
      this.el.appendChild(lbl);
    }

    // Beats per bar
    {
      const lbl = document.createElement('label');
      lbl.textContent = 'B/BAR';
      this.bpbInput = document.createElement('input');
      this.bpbInput.type = 'number';
      this.bpbInput.min = '1'; this.bpbInput.max = '16'; this.bpbInput.step = '1';
      this.bpbInput.className = 'rw-num';
      this.bpbInput.style.width = '48px';
      this.bpbInput.addEventListener('change', () => {
        const v = parseInt(this.bpbInput.value, 10);
        if (!Number.isNaN(v)) this.seq.setBeatsPerBar(v);
      });
      lbl.appendChild(this.bpbInput);
      this.el.appendChild(lbl);
    }

    // Sync mode
    {
      const lbl = document.createElement('label');
      lbl.textContent = 'SYNC';
      this.syncSel = document.createElement('select');
      this.syncSel.className = 'rw-select';
      const oi = document.createElement('option'); oi.value = 'internal'; oi.textContent = 'INTERNAL';
      const om = document.createElement('option'); om.value = 'midi';     om.textContent = 'MIDI';
      this.syncSel.append(oi, om);
      this.syncSel.addEventListener('change', () => this.seq.setSyncMode(this.syncSel.value as 'internal' | 'midi'));
      lbl.appendChild(this.syncSel);
      this.el.appendChild(lbl);
    }

    // Zoom +/-
    {
      const lbl = document.createElement('label');
      lbl.textContent = 'ZOOM';
      const minus = this.btn('−', () => this.changeZoom(0.66));
      const plus  = this.btn('+', () => this.changeZoom(1.5));
      lbl.append(minus, plus);
      this.el.appendChild(lbl);
    }

    // Dock position toggle
    {
      const container = document.createElement('span');
      container.style.display = 'inline-flex';
      container.style.alignItems = 'center';
      container.style.gap = '4px';
      const label = document.createElement('span');
      label.textContent = 'DOCK';
      label.style.marginRight = '4px';
      const top = this.btn('TOP',    () => this.settings.set('timelineDock', 'top'));
      const bot = this.btn('BOT',    () => this.settings.set('timelineDock', 'bottom'));
      const hide = this.btn('HIDE', () => this.settings.set('timelineDock', 'hidden'));
      container.append(label, top, bot, hide);
      this.el.appendChild(container);
    }

    // Spacer
    const spacer = document.createElement('span');
    spacer.className = 'rw-tl-spacer';
    this.el.appendChild(spacer);

    // Bar readout
    this.readout = document.createElement('span');
    this.readout.className = 'rw-readout';
    this.readout.textContent = 'bar 0.00 / 16';
    this.el.appendChild(this.readout);
  }

  private btn(label: string, onClick: () => void, title?: string, kind?: 'primary' | 'warn'): HTMLElement {
    const b = document.createElement('button');
    b.className = 'rw-btn';
    if (kind) b.classList.add(kind);
    b.type = 'button';
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  // -----------------------------------------------------------------
  // Refresh from sequencer/settings
  // -----------------------------------------------------------------

  refresh(): void {
    const t = this.seq.timeline;
    // Picker
    let list = loadTimelines();
    const activeId = this.settings.get('activeTimelineId');
    
    // If there's a currently loaded timeline but it's not in the persisted
    // list (autoPersist = false), add it to the list so it shows in the picker.
    if (t && !list.find(tl => tl.id === t.id)) {
      list = [t, ...list];
    }
    
    this.timelinePicker.innerHTML = '';
    if (list.length === 0) {
      const opt = document.createElement('option');
      opt.value = ''; opt.textContent = '(no timelines)';
      this.timelinePicker.appendChild(opt);
    }
    for (const tl of list) {
      const opt = document.createElement('option');
      opt.value = tl.id; opt.textContent = tl.name;
      if (tl.id === activeId) opt.selected = true;
      this.timelinePicker.appendChild(opt);
    }
    // Transport state
    this.playBtn.textContent = this.seq.isPlaying ? 'PAUSE' : 'PLAY';
    // BPM is the global Settings.internalBpm (single shared source) — the
    // timeline no longer owns its own value, so we always show the global
    // BPM here regardless of whether a timeline is loaded.
    this.bpmInput.value = String(this.settings.get('internalBpm'));
    if (t) {
      this.lenInput.value = String(t.lengthBars);
      this.bpbInput.value = String(t.beatsPerBar);
      this.syncSel.value  = t.syncMode;
      this.loopBtn.classList.toggle('primary', t.loop);
      this.loopBtn.textContent = t.loop ? 'LOOP ON' : 'LOOP OFF';
    } else {
      this.lenInput.value = '16';
      this.bpbInput.value = '4';
      this.syncSel.value = 'internal';
    }
    this.updateReadout(this.seq.playheadBar);
  }

  updateReadout(bar: number): void {
    const t = this.seq.timeline;
    const len = t ? t.lengthBars : 0;
    this.readout.textContent = `bar ${bar.toFixed(2)} / ${len}`;
  }

  // -----------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------

  private onPlayPause(): void {
    if (!this.seq.timeline) return;
    if (this.seq.isPlaying) this.seq.pause();
    else this.seq.play();
  }

  private onPickTimeline(): void {
    const id = this.timelinePicker.value || null;
    this.settings.set('activeTimelineId', id);
    if (!id) {
      this.seq.load(null);
      this.events.onTimelineSelected?.(null);
      this.refresh();
      return;
    }
    const tl = loadTimelines().find(t => t.id === id);
    if (tl) {
      this.seq.load(tl);
      this.events.onTimelineSelected?.(id);
    }
    this.refresh();
  }

  private onNewTimeline(): void {
    const name = window.prompt('Name for new timeline?', 'Untitled');
    if (!name) return;
    const tl = makeEmptyTimeline(name);
    upsertTimeline(tl);
    this.settings.set('activeTimelineId', tl.id);
    this.seq.load(tl);
    this.refresh();
  }

  private onSaveTimeline(): void {
    if (!this.seq.timeline) return;
    upsertTimeline(this.seq.timeline);
    this.flashReadout('saved');
  }

  private onRenameTimeline(): void {
    if (!this.seq.timeline) return;
    const name = window.prompt('Rename timeline:', this.seq.timeline.name);
    if (!name) return;
    this.seq.rename(name);
    upsertTimeline(this.seq.timeline);
    this.refresh();
  }

  private onDeleteTimeline(): void {
    if (!this.seq.timeline) return;
    if (!window.confirm(`Delete timeline "${this.seq.timeline.name}"?`)) return;
    const id = this.seq.timeline.id;
    deleteTimeline(id);
    this.settings.set('activeTimelineId', null);
    this.seq.load(null);
    this.refresh();
  }

  private onExportTimeline(): void {
    if (!this.seq.timeline) return;
    const json = exportTimeline(this.seq.timeline, 'snapshots');
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug(this.seq.timeline.name)}.timeline.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  private onImportTimeline(): void {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json';
    inp.addEventListener('change', async () => {
      const f = inp.files?.[0];
      if (!f) return;
      const text = await f.text();
      try {
        const tl = importTimelineJson(text);
        const list = loadTimelines();
        list.push(tl);
        saveTimelines(list);
        this.settings.set('activeTimelineId', tl.id);
        this.seq.load(tl);
        this.refresh();
      } catch (err) {
        window.alert(`Import failed: ${(err as Error).message}`);
      }
    });
    inp.click();
  }

  private changeZoom(mult: number): void {
    this.zoom = Math.max(20, Math.min(240, Math.round(this.zoom * mult)));
    this.events.onZoomChange?.(this.zoom);
  }

  private flashReadout(msg: string): void {
    const orig = this.readout.textContent;
    this.readout.textContent = msg;
    setTimeout(() => { this.readout.textContent = orig; }, 800);
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'timeline';
}
