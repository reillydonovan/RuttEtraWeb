/**
 * Bar/beat ruler. Click anywhere to seek the playhead. Updates DOM lazily —
 * only re-rendered on timeline structural change or zoom change.
 */

import { Sequencer } from '../../sequencer/Sequencer';

export class TimelineRuler {
  el: HTMLElement;
  private seq: Sequencer;
  private pixelsPerBar = 60;

  constructor(seq: Sequencer) {
    this.seq = seq;
    this.el = document.createElement('div');
    this.el.className = 'rw-tl-ruler';
    this.el.addEventListener('click', this.onClick);
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
    for (let bar = 0; bar <= t.lengthBars; bar++) {
      const barTick = document.createElement('div');
      barTick.className = 'rw-tl-bar';
      barTick.style.left = `${bar * this.pixelsPerBar}px`;
      barTick.textContent = String(bar);
      this.el.appendChild(barTick);
      // beat ticks
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
