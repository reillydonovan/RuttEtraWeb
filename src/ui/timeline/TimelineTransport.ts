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
import {
  ReadoutFormat, READOUT_FPS_OPTIONS, READOUT_SAMPLE_RATE_OPTIONS, formatReadout,
  lengthDisplayFromBars, lengthBarsFromDisplay,
} from '../../sequencer/timecode';
import { attachTooltip } from '../tooltip';
import { showContextMenu } from './contextMenu';
import { infoButton } from '../help/infoModal';
import { TIMELINE_INFO } from '../help/infoContent';
import { attachNumberDragScrub } from '../widgets';

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
  private lenLabel!: HTMLLabelElement;
  private bpbInput!: HTMLInputElement;
  private syncSel!: HTMLSelectElement;
  private formatSel!: HTMLSelectElement;
  private fpsSel!: HTMLSelectElement;
  private srSel!: HTMLSelectElement;
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
      this.updateReadout(this.seq.playheadBar);
      if (this.lenLabel) this.updateLengthField();
    });
    // Readout display-format prefs — also settable from outside this
    // component in principle (project load), so mirror + re-render.
    settings.subscribe('timelineReadoutFormat', (v) => {
      if (this.formatSel && this.formatSel.value !== v) this.formatSel.value = v;
      this.updateReadoutVisibility();
      this.updateReadout(this.seq.playheadBar);
      if (this.lenLabel) this.updateLengthField();
    });
    settings.subscribe('timelineReadoutFps', (v) => {
      const s = String(v);
      if (this.fpsSel && this.fpsSel.value !== s) this.fpsSel.value = s;
      this.updateReadout(this.seq.playheadBar);
      if (this.lenLabel) this.updateLengthField();
    });
    settings.subscribe('timelineReadoutSampleRate', (v) => {
      const s = String(v);
      if (this.srSel && this.srSel.value !== s) this.srSel.value = s;
      this.updateReadout(this.seq.playheadBar);
      if (this.lenLabel) this.updateLengthField();
    });
  }

  setZoom(z: number): void { this.zoom = z; }

  // -----------------------------------------------------------------
  // Build
  // -----------------------------------------------------------------

  private build(): void {
    // ⓘ first, where a newcomer looks: how the timeline works, in order.
    const info = infoButton(() => TIMELINE_INFO, 'How the timeline works');
    info.classList.add('rw-tl-info');
    attachTooltip(info, 'How the timeline works');

    // ---- Zone 1: SCORE — which timeline, plus its file actions ------
    // (Resolve/AE pattern: the document picker is primary; the rarely
    // used file verbs live behind one ⋯ menu instead of six buttons.)
    const zone = (cls: string): HTMLElement => {
      const z = document.createElement('div');
      z.className = `rw-tl-zone ${cls}`;
      this.el.appendChild(z);
      return z;
    };
    const score = zone('rw-tl-zone--score');
    score.appendChild(info);
    this.timelinePicker = document.createElement('select');
    this.timelinePicker.className = 'rw-select';
    attachTooltip(this.timelinePicker, 'Active timeline — the score currently loaded into the dock');
    this.timelinePicker.addEventListener('change', () => this.onPickTimeline());
    score.appendChild(this.timelinePicker);
    const newBtn = this.btn('+', () => this.onNewTimeline(), 'New timeline');
    newBtn.dataset.tl = 'new';
    newBtn.classList.add('rw-tl-icon');
    const moreBtn = this.btn('⋯', () => {
      const r = moreBtn.getBoundingClientRect();
      const dock = this.settings.get('timelineDock');
      // Deferred a tick: the menu's outside-click dismiss listens on the
      // document, and this very click would otherwise close it at once.
      setTimeout(() => showContextMenu(r.left, r.bottom + 4, [
        { label: 'Save timeline', onClick: () => this.onSaveTimeline() },
        { label: 'Rename…', onClick: () => this.onRenameTimeline() },
        { label: 'Export JSON…', onClick: () => this.onExportTimeline() },
        { label: 'Import JSON…', onClick: () => this.onImportTimeline() },
        { label: '', separator: true },
        { label: 'Delete timeline…', onClick: () => this.onDeleteTimeline() },
        { label: '', separator: true },
        { label: `${dock === 'top' ? '✓ ' : ''}Dock at top`, onClick: () => this.settings.set('timelineDock', 'top') },
        { label: `${dock === 'bottom' ? '✓ ' : ''}Dock at bottom`, onClick: () => this.settings.set('timelineDock', 'bottom') },
        { label: 'Hide dock', onClick: () => this.settings.set('timelineDock', 'hidden') },
      ]), 0);
    }, 'Timeline file actions: save, rename, export, import, delete, dock position');
    moreBtn.dataset.tl = 'more';
    moreBtn.classList.add('rw-tl-icon');
    score.append(newBtn, moreBtn);

    // ---- Zone 2: TRANSPORT — the time, then the deck controls --------
    const transport = zone('rw-tl-zone--transport');
    this.readout = document.createElement('span');
    this.readout.className = 'rw-readout rw-tl-time';
    this.readout.textContent = 'bar 0.00 / 16';
    attachTooltip(this.readout, 'Playhead position in the selected DISPLAY format. Non-Bars/Beats readings append the bar position (e.g. "frame 60 · bar 1.00") so it always ties back to where the playhead sits on the ruler.');
    transport.appendChild(this.readout);
    const deck = document.createElement('span');
    deck.className = 'rw-tl-group rw-tl-deck';
    const prev = this.btn('|◀', () => this.events.onJumpKeyframe?.(-1), 'Previous keyframe (,)');
    prev.dataset.tl = 'prev';
    this.stopBtn = this.btn('■', () => this.seq.stop()) as HTMLButtonElement;
    this.stopBtn.dataset.tl = 'stop';
    attachTooltip(this.stopBtn, 'Stop and return the playhead to bar 0');
    this.playBtn = this.btn('▶', () => this.onPlayPause()) as HTMLButtonElement;
    this.playBtn.dataset.tl = 'play';
    this.playBtn.classList.add('primary');
    attachTooltip(this.playBtn, () => this.seq.isPlaying ? 'Pause (Space)' : 'Play (Space)');
    const next = this.btn('▶|', () => this.events.onJumpKeyframe?.(1), 'Next keyframe (.)');
    next.dataset.tl = 'next';
    this.loopBtn = this.btn('⟲', () => {
      const t = this.seq.timeline;
      if (!t) return;
      this.seq.setLoop(!t.loop);
    }) as HTMLButtonElement;
    this.loopBtn.dataset.tl = 'loop';
    attachTooltip(this.loopBtn, () =>
      this.seq.timeline?.loop
        ? 'Loop is on — the playhead wraps to bar 0 at the end. Click to play once and stop.'
        : 'Loop is off — plays once and stops at the end. Click to loop.');
    for (const b of [prev, this.stopBtn, this.playBtn, next, this.loopBtn]) b.classList.add('rw-tl-icon');
    deck.append(prev, this.stopBtn, this.playBtn, next, this.loopBtn);
    transport.appendChild(deck);

    // ---- Zone 3: CLOCK & VIEW — tempo, length, meter, sync, format, zoom
    const clock = zone('rw-tl-zone--clock');
    const into = (el: HTMLElement): void => { clock.appendChild(el); };

    // BPM
    {
      const lbl = document.createElement('label');
      lbl.textContent = 'BPM';
      this.bpmInput = document.createElement('input');
      this.bpmInput.type = 'number';
      this.bpmInput.min = '20'; this.bpmInput.max = '400'; this.bpmInput.step = '1';
      this.bpmInput.className = 'rw-num rw-num-scrubbable';
      this.bpmInput.style.width = '64px';
      this.bpmInput.addEventListener('change', () => {
        const v = parseFloat(this.bpmInput.value);
        if (!Number.isNaN(v)) this.seq.setBpm(v);
      });
      attachNumberDragScrub(this.bpmInput, () => 1);
      lbl.appendChild(this.bpmInput);
      attachTooltip(lbl, 'Tempo — the single shared clock every LFO, Graph clock node, and this timeline reads (Settings.internalBpm)');
      into(lbl);
    }

    // Length — follows the DISPLAY format (bars by default; total
    // runtime/frames/samples in the other formats, see updateLengthField).
    {
      this.lenLabel = document.createElement('label');
      this.lenLabel.textContent = 'BARS';
      this.lenInput = document.createElement('input');
      this.lenInput.type = 'number';
      this.lenInput.min = '1'; this.lenInput.step = '1';
      this.lenInput.className = 'rw-num rw-num-scrubbable';
      this.lenInput.style.width = '64px';
      this.lenInput.addEventListener('change', () => {
        const v = parseFloat(this.lenInput.value);
        if (Number.isNaN(v)) return;
        const bars = lengthBarsFromDisplay(
          this.settings.get('timelineReadoutFormat'),
          v,
          this.settings.get('internalBpm'),
          this.seq.timeline?.beatsPerBar ?? 4,
          this.settings.get('timelineReadoutFps'),
          this.settings.get('timelineReadoutSampleRate'),
        );
        this.seq.setLengthBars(bars);
      });
      attachNumberDragScrub(this.lenInput, () => parseFloat(this.lenInput.step) || 1);
      this.lenLabel.appendChild(this.lenInput);
      attachTooltip(this.lenLabel, () => {
        const fmt = this.settings.get('timelineReadoutFormat');
        if (fmt === 'timecode') return 'Timeline length as total runtime (seconds) — converts to/from the underlying bar count';
        if (fmt === 'frames') return 'Timeline length as a total frame count — converts to/from the underlying bar count';
        if (fmt === 'samples') return 'Timeline length as a total sample count — converts to/from the underlying bar count';
        return 'Timeline length in bars — where the loop point and the end of the ruler sit';
      });
      into(this.lenLabel);
    }

    // Beats per bar
    {
      const lbl = document.createElement('label');
      lbl.textContent = 'B/BAR';
      this.bpbInput = document.createElement('input');
      this.bpbInput.type = 'number';
      this.bpbInput.min = '1'; this.bpbInput.max = '16'; this.bpbInput.step = '1';
      this.bpbInput.className = 'rw-num rw-num-scrubbable';
      this.bpbInput.style.width = '48px';
      this.bpbInput.addEventListener('change', () => {
        const v = parseInt(this.bpbInput.value, 10);
        if (!Number.isNaN(v)) this.seq.setBeatsPerBar(v);
      });
      attachNumberDragScrub(this.bpbInput, () => 1);
      lbl.appendChild(this.bpbInput);
      attachTooltip(lbl, 'Beats per bar — sets the ruler\'s minor gridlines and beat-snap spacing');
      into(lbl);
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
      attachTooltip(lbl, 'Clock source: Internal runs off the BPM above; MIDI locks the transport to an incoming MIDI clock');
      into(lbl);
    }

    // Zoom +/- (appended last, after DISPLAY)
    let zoomLbl: HTMLElement | null = null;
    {
      const lbl = document.createElement('label');
      lbl.textContent = 'ZOOM';
      const minus = this.btn('−', () => this.changeZoom(0.66), 'Zoom out (fewer pixels per bar)');
      const plus  = this.btn('+', () => this.changeZoom(1.5), 'Zoom in (more pixels per bar)');
      minus.classList.add('rw-tl-icon'); plus.classList.add('rw-tl-icon');
      const zg = document.createElement('span');
      zg.className = 'rw-tl-group';
      zg.append(minus, plus);
      lbl.append(zg);
      zoomLbl = lbl;
    }

    // Counter cluster: format picker + rate picker + the readout itself,
    // grouped in ONE container so they wrap together as a single unit
    // instead of independently — with this many transport controls, a
    // plain flex-wrap left the rate picker and the readout stranding on
    // separate lines with nothing visually tying them together (you'd
    // see "30fps" alone on one line and "frame 58" alone on another,
    // with no indication they described the same reading). Bars/Beats
    // is the real clock (BPM × beats-per-bar); Timecode/Frames/Samples
    // are pure reformattings of the same playhead position (see
    // sequencer/timecode.ts). The FPS / sample-rate pickers are
    // notational references for those formats, shown only when relevant.
    const counterCluster = document.createElement('div');
    counterCluster.className = 'rw-tl-counter-cluster';
    into(counterCluster);

    {
      const lbl = document.createElement('label');
      lbl.textContent = 'DISPLAY';
      attachTooltip(lbl, 'Transport counter display format — Bars/Beats is the timeline\'s real clock; Timecode/Frames/Samples are pure reformattings of the same position for editors who think in video/audio terms');
      this.formatSel = document.createElement('select');
      this.formatSel.className = 'rw-select';
      const opts: [ReadoutFormat, string][] = [
        ['bars', 'BARS/BEATS'], ['timecode', 'TIMECODE'], ['frames', 'FRAMES'], ['samples', 'SAMPLES'],
      ];
      for (const [v, l] of opts) {
        const o = document.createElement('option');
        o.value = v; o.textContent = l;
        this.formatSel.appendChild(o);
      }
      this.formatSel.addEventListener('change', () => {
        this.settings.set('timelineReadoutFormat', this.formatSel.value as ReadoutFormat);
      });
      lbl.appendChild(this.formatSel);
      counterCluster.appendChild(lbl);
    }
    this.fpsSel = document.createElement('select');
    this.fpsSel.className = 'rw-select';
    attachTooltip(this.fpsSel, 'Frame rate for Timecode / Frames display (notational — independent of Record’s capture FPS)');
    for (const fps of READOUT_FPS_OPTIONS) {
      const o = document.createElement('option');
      o.value = String(fps); o.textContent = `${fps}fps`;
      this.fpsSel.appendChild(o);
    }
    this.fpsSel.addEventListener('change', () => {
      this.settings.set('timelineReadoutFps', parseFloat(this.fpsSel.value));
    });
    counterCluster.appendChild(this.fpsSel);

    this.srSel = document.createElement('select');
    this.srSel.className = 'rw-select';
    attachTooltip(this.srSel, 'Sample rate for Samples display (notational — independent of the audio hardware’s actual rate)');
    for (const sr of READOUT_SAMPLE_RATE_OPTIONS) {
      const o = document.createElement('option');
      o.value = String(sr); o.textContent = `${sr / 1000}kHz`;
      this.srSel.appendChild(o);
    }
    this.srSel.addEventListener('change', () => {
      this.settings.set('timelineReadoutSampleRate', parseInt(this.srSel.value, 10));
    });
    counterCluster.appendChild(this.srSel);

    // (The playhead readout itself leads the TRANSPORT zone above.)
    if (zoomLbl) into(zoomLbl);
  }

  /** Show the FPS picker for Timecode/Frames, the sample-rate picker
   *  for Samples, and hide both for the default Bars/Beats format. */
  private updateReadoutVisibility(): void {
    const fmt = this.settings.get('timelineReadoutFormat');
    this.fpsSel.hidden = !(fmt === 'timecode' || fmt === 'frames');
    this.srSel.hidden = fmt !== 'samples';
  }

  /** Re-label the LENGTH field and repopulate it in the current DISPLAY
   *  format's units (owner request: BARS should read as total runtime
   *  in Timecode, total frame count in Frames, total sample count in
   *  Samples — not stay bar-labeled while everything else reformats). */
  private updateLengthField(): void {
    const fmt = this.settings.get('timelineReadoutFormat');
    const labels: Record<ReadoutFormat, string> = {
      bars: 'BARS', timecode: 'LENGTH (s)', frames: 'FRAMES', samples: 'SAMPLES',
    };
    this.lenLabel.firstChild!.textContent = labels[fmt];
    this.lenInput.max = fmt === 'bars' ? '999' : '';
    const bpm = this.settings.get('internalBpm');
    const t = this.seq.timeline;
    const beatsPerBar = t?.beatsPerBar ?? 4;
    const fps = this.settings.get('timelineReadoutFps');
    const sampleRate = this.settings.get('timelineReadoutSampleRate');
    // The step MUST be exactly one bar's worth in the current display
    // unit — the underlying model only stores a whole bar count, so a
    // smaller step (the previous flat 0.1s for Timecode) round-trips
    // back to the SAME bar on release and the native spinner arrows
    // (and drag-scrub) look like they do nothing (owner bug report).
    const oneBar = lengthDisplayFromBars(fmt, 1, bpm, beatsPerBar, fps, sampleRate);
    this.lenInput.step = String(oneBar || 1);
    const bars = t ? t.lengthBars : 16;
    const display = lengthDisplayFromBars(fmt, bars, bpm, beatsPerBar, fps, sampleRate);
    this.lenInput.value = String(display);
  }

  private btn(label: string, onClick: () => void, title?: string, kind?: 'primary' | 'warn'): HTMLElement {
    const b = document.createElement('button');
    b.className = 'rw-btn';
    if (kind) b.classList.add(kind);
    b.type = 'button';
    b.textContent = label;
    if (title) attachTooltip(b, title);
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
    this.playBtn.textContent = this.seq.isPlaying ? '❚❚' : '▶';
    // BPM is the global Settings.internalBpm (single shared source) — the
    // timeline no longer owns its own value, so we always show the global
    // BPM here regardless of whether a timeline is loaded.
    this.bpmInput.value = String(this.settings.get('internalBpm'));
    if (t) {
      this.bpbInput.value = String(t.beatsPerBar);
      this.syncSel.value  = t.syncMode;
      this.loopBtn.classList.toggle('active', t.loop);
      this.loopBtn.setAttribute('aria-pressed', String(t.loop));
    } else {
      this.bpbInput.value = '4';
      this.syncSel.value = 'internal';
    }
    this.updateLengthField();
    this.formatSel.value = this.settings.get('timelineReadoutFormat');
    this.fpsSel.value = String(this.settings.get('timelineReadoutFps'));
    this.srSel.value = String(this.settings.get('timelineReadoutSampleRate'));
    this.updateReadoutVisibility();
    this.updateReadout(this.seq.playheadBar);
  }

  updateReadout(bar: number): void {
    const t = this.seq.timeline;
    this.readout.textContent = formatReadout(
      this.settings.get('timelineReadoutFormat'),
      bar,
      t ? t.lengthBars : 0,
      this.settings.get('internalBpm'),
      t?.beatsPerBar ?? 4,
      this.settings.get('timelineReadoutFps'),
      this.settings.get('timelineReadoutSampleRate'),
    );
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
