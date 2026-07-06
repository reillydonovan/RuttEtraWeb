/**
 * Automation lanes — MINIMAL data-layer editor (Keyframing v2 preview,
 * AUDIT item 25).
 *
 * Deliberately crude, per the run instructions: the full timeline-lane
 * UI (drawable curves on the track, drag handles, record-knob-moves)
 * waits for owner review of docs/design/keyframing-v2.md. This panel
 * exercises the data layer end-to-end: add/mute/delete lanes, set or
 * remove a point at the playhead, and see the RESOLVED absolute value
 * (base + offset) next to the relative offset you type — the display
 * decision from the owner review.
 */

import { Sequencer } from '../../sequencer/Sequencer';
import { upsertPoint, removePointAt, evalLane } from '../../sequencer/lanes';
import { newLaneId } from '../../sequencer/types';
import { SettingsStore } from '../../state/Settings';
import { TARGETS } from '../targets';

export class LanesPanel {
  readonly el: HTMLElement;

  constructor(private settings: SettingsStore, private seq: Sequencer) {
    this.el = document.createElement('div');
    this.el.className = 'rw-tl-lanes';
    this.render();
  }

  refresh(): void {
    this.render();
  }

  private mutate(fn: (t: NonNullable<Sequencer['timeline']>) => void): void {
    if (!this.seq.timeline) return;
    this.seq.editLanes(fn);
    this.render();
  }

  private render(): void {
    this.el.innerHTML = '';
    const t = this.seq.timeline;
    const head = document.createElement('div');
    head.className = 'rw-tl-lanes-head';
    head.textContent = 'LANES (v2 preview)';
    this.el.appendChild(head);
    if (!t) {
      const msg = document.createElement('div');
      msg.className = 'rw-tl-lanes-empty';
      msg.textContent = 'Load a timeline to add automation lanes.';
      this.el.appendChild(msg);
      return;
    }

    for (const lane of t.lanes) {
      const row = document.createElement('div');
      row.className = 'rw-tl-lane';

      const en = document.createElement('input');
      en.type = 'checkbox';
      en.checked = lane.enabled;
      en.title = 'Enable lane';
      en.addEventListener('change', () => this.mutate(() => { lane.enabled = en.checked; }));

      const label = document.createElement('span');
      label.className = 'rw-tl-lane-name';
      label.textContent = TARGETS.find((x) => x.v === lane.paramKey)?.l ?? lane.paramKey;

      const offset = document.createElement('input');
      offset.type = 'number';
      offset.step = '0.01';
      offset.className = 'rw-num';
      offset.title = 'Relative offset at the playhead';
      offset.value = String(evalLane(lane.points, this.seq.playheadBar).toFixed(3));

      // Resolved-value preview: base + offset (display only — the lane
      // stores the OFFSET; this is the owner-decided UI affordance).
      const resolved = document.createElement('span');
      resolved.className = 'rw-tl-lane-resolved';
      const updateResolved = (): void => {
        const base = this.settings.get(lane.paramKey as never) as unknown;
        const off = parseFloat(offset.value) || 0;
        resolved.textContent = typeof base === 'number'
          ? `→ ${(base + off).toFixed(3)}`
          : '';
      };
      updateResolved();
      offset.addEventListener('input', updateResolved);

      const setBtn = document.createElement('button');
      setBtn.type = 'button';
      setBtn.className = 'rw-btn';
      setBtn.textContent = 'Set @ playhead';
      setBtn.addEventListener('click', () => this.mutate(() => {
        const v = parseFloat(offset.value);
        if (!Number.isFinite(v)) return;
        lane.points = upsertPoint(lane.points, { bar: this.seq.playheadBar, value: v });
      }));

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'rw-btn';
      clearBtn.textContent = '⌫ pt';
      clearBtn.title = 'Remove the point at the playhead bar';
      clearBtn.addEventListener('click', () => this.mutate(() => {
        lane.points = removePointAt(lane.points, this.seq.playheadBar);
      }));

      const count = document.createElement('span');
      count.className = 'rw-tl-lane-count';
      count.textContent = `${lane.points.length} pt${lane.points.length === 1 ? '' : 's'}`;

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'rw-btn';
      del.textContent = '×';
      del.title = 'Delete lane';
      del.addEventListener('click', () => this.mutate((tl) => {
        tl.lanes = tl.lanes.filter((l) => l.id !== lane.id);
      }));

      row.append(en, label, offset, resolved, setBtn, clearBtn, count, del);
      this.el.appendChild(row);
    }

    // Add-lane row.
    const addRow = document.createElement('div');
    addRow.className = 'rw-tl-lane rw-tl-lane-add';
    const sel = document.createElement('select');
    sel.className = 'rw-select';
    for (const opt of TARGETS) {
      const o = document.createElement('option');
      o.value = opt.v as string;
      o.textContent = opt.l;
      sel.appendChild(o);
    }
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'rw-btn';
    addBtn.textContent = '+ Lane';
    addBtn.addEventListener('click', () => this.mutate((tl) => {
      tl.lanes.push({ id: newLaneId(), paramKey: sel.value, enabled: true, points: [] });
    }));
    addRow.append(sel, addBtn);
    this.el.appendChild(addRow);
  }
}
