/**
 * Bar/beat ruler. Click anywhere to seek the playhead. Updates DOM lazily —
 * only re-rendered on timeline structural change or zoom change.
 *
 * Tick label text follows the transport's DISPLAY format
 * (`Settings.timelineReadoutFormat`) — Bars/Beats, Timecode, Frames, or
 * Samples — so the ruler and the counter always agree on what a given
 * position means (previously the ruler always showed bar numbers even
 * with the counter in Timecode mode, so e.g. "8" on the ruler and
 * "00:00:16" on the counter looked contradictory instead of being the
 * same position in two units). Tick POSITIONS stay bar-spaced
 * regardless of format — editing, snapping, and zoom are all bar-based
 * and that doesn't change; only the printed label changes.
 */

import { Sequencer } from '../../sequencer/Sequencer';
import { SettingsStore } from '../../state/Settings';
import { formatRulerTick } from '../../sequencer/timecode';

export class TimelineRuler {
  el: HTMLElement;
  private seq: Sequencer;
  private settings: SettingsStore;
  private pixelsPerBar = 60;

  constructor(seq: Sequencer, settings: SettingsStore) {
    this.seq = seq;
    this.settings = settings;
    this.el = document.createElement('div');
    this.el.className = 'rw-tl-ruler';
    this.el.addEventListener('click', this.onClick);
    // Any of these changing re-labels every tick immediately.
    for (const key of ['timelineReadoutFormat', 'timelineReadoutFps', 'timelineReadoutSampleRate', 'internalBpm'] as const) {
      settings.subscribe(key, () => this.render());
    }
  }

  setPixelsPerBar(p: number): void {
    this.pixelsPerBar = p;
    this.render();
  }

  render(): void {
    const t = this.seq.timeline;
    this.el.innerHTML = '';
    if (!t) return;
    const w = t.lengthBars * this.pixelsPerBar;
    this.el.style.width = `${w}px`;
    const format = this.settings.get('timelineReadoutFormat');
    const bpm = this.settings.get('internalBpm');
    const fps = this.settings.get('timelineReadoutFps');
    const sampleRate = this.settings.get('timelineReadoutSampleRate');
    for (let bar = 0; bar <= t.lengthBars; bar++) {
      const barTick = document.createElement('div');
      barTick.className = 'rw-tl-bar';
      barTick.style.left = `${bar * this.pixelsPerBar}px`;
      barTick.textContent = formatRulerTick(format, bar, bpm, t.beatsPerBar, fps, sampleRate);
      this.el.appendChild(barTick);
      // beat ticks — unlabeled minor gridlines regardless of format.
      if (bar < t.lengthBars) {
        for (let b = 1; b < t.beatsPerBar; b++) {
          const beat = document.createElement('div');
          beat.className = 'rw-tl-bar beat';
          beat.style.left = `${(bar + b / t.beatsPerBar) * this.pixelsPerBar}px`;
          this.el.appendChild(beat);
        }
      }
    }
  }

  private onClick = (ev: MouseEvent): void => {
    const t = this.seq.timeline;
    if (!t) return;
    const rect = this.el.getBoundingClientRect();
    const x = ev.clientX - rect.left + this.el.scrollLeft;
    const bar = x / this.pixelsPerBar;
    this.seq.seek(bar);
  };
}
