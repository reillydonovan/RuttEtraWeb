/**
 * Automation-lane editor region: one LaneRow per lane, stacked under the
 * scene track INSIDE the dock's shared scroll canvas — so lanes inherit
 * the ruler's bar scale and horizontal scroll with zero sync code.
 *
 * Replaces the v2-preview LanesPanel strip. Selection (which lane point
 * the inspector edits) is owned by TimelineDock and passed in via the
 * LaneRowHost; per-lane expand state is UI-local (not persisted).
 */

import { Sequencer } from '../../sequencer/Sequencer';
import { newLaneId } from '../../sequencer/types';
import { SettingsStore } from '../../state/Settings';
import { TARGETS } from '../targets';
import { LaneRow, LaneRowHost, LanePointSel } from './LaneRow';
import { attachTooltip } from '../tooltip';

export class LaneEditor {
  readonly el: HTMLElement;
  private rows = new Map<string, LaneRow>();
  private playheadEl: HTMLElement;
  private expanded = new Map<string, boolean>();
  private pixelsPerBarValue = 60;

  constructor(
    private settings: SettingsStore,
    private seq: Sequencer,
    private selectionHost: {
      selection(): LanePointSel | null;
      selectPoint(sel: LanePointSel | null): void;
      /** Live-update the inspector's fields while a point drags. */
      previewToInspector(laneId: string, bar: number, value: number): void;
    },
  ) {
    this.el = document.createElement('div');
    this.el.className = 'rw-tl-lanes-region';

    this.playheadEl = document.createElement('div');
    this.playheadEl.className = 'rw-tl-playhead rw-tl-playhead--lanes';

    // Re-scale lane value axes when the user changes a custom slider range.
    this.settings.subscribe('paramRangeOverrides', () => this.render());

    this.render();
  }

  private host(): LaneRowHost {
    return {
      pixelsPerBar: () => this.pixelsPerBarValue,
      selection: () => this.selectionHost.selection(),
      selectPoint: (sel) => this.selectionHost.selectPoint(sel),
      isExpanded: (laneId) => this.expanded.get(laneId) ?? true,
      setExpanded: (laneId, ex) => {
        this.expanded.set(laneId, ex);
        this.render();
      },
      previewToInspector: (laneId, bar, value) =>
        this.selectionHost.previewToInspector(laneId, bar, value),
    };
  }

  /** Live-preview a point's ABSOLUTE value in its lane row (inspector typing). */
  previewPoint(laneId: string, bar: number, value: number): void {
    this.rows.get(laneId)?.previewValue(bar, value);
  }

  setPixelsPerBar(p: number): void {
    this.pixelsPerBarValue = p;
    this.render();
  }

  updatePlayhead(bar: number): void {
    this.playheadEl.style.left = `${bar * this.pixelsPerBarValue}px`;
  }

  applySelection(): void {
    for (const row of this.rows.values()) row.applySelection();
  }

  /** Scroll a lane into view and flash it (diamond menu "Open in timeline"). */
  revealLane(laneId: string): void {
    const row = this.rows.get(laneId);
    if (!row) return;
    row.el.scrollIntoView({ block: 'nearest' });
    row.el.classList.remove('rw-tl-lane-flash');
    void row.el.offsetWidth;
    row.el.classList.add('rw-tl-lane-flash');
  }

  render(): void {
    this.el.replaceChildren();
    // Rows hold a settings subscription (base-value redraws) — release
    // them before dropping the references.
    for (const row of this.rows.values()) row.dispose();
    this.rows.clear();
    const t = this.seq.timeline;
    if (!t) { this.el.style.width = ''; return; }

    this.el.style.width = `${t.lengthBars * this.pixelsPerBarValue}px`;
    this.el.appendChild(this.playheadEl);
    this.updatePlayhead(this.seq.playheadBar);

    const host = this.host();
    for (const lane of t.lanes) {
      const row = new LaneRow(this.settings, this.seq, lane, host);
      this.rows.set(lane.id, row);
      this.el.appendChild(row.el);
    }

    // Add-lane row — sticky-left so it stays visible while scrolling.
    const addRow = document.createElement('div');
    addRow.className = 'rw-tl-lane-add';
    const sel = document.createElement('select');
    sel.className = 'rw-select';
    // A placeholder, not the first param: a picker sitting on "H Position"
    // under an empty timeline read as an H Pos lane that appeared by itself.
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Add a lane…';
    sel.appendChild(none);
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
    attachTooltip(addBtn, 'Add an automation lane for the chosen parameter — every param with a slider is available here');
    attachTooltip(sel, 'Parameter to automate — any slider-backed param in the panel');
    addBtn.disabled = true;
    sel.addEventListener('change', () => { addBtn.disabled = !sel.value; });
    addBtn.addEventListener('click', () => {
      if (!sel.value) return;
      this.seq.editLanes((tl) => {
        tl.lanes.push({ id: newLaneId(), paramKey: sel.value, enabled: true, points: [] });
      });
    });
    addRow.append(sel, addBtn);
    this.el.appendChild(addRow);
  }
}
