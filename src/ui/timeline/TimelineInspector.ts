/**
 * Inspector column (fixed 220px, right of the scroller). Two modes:
 *   - KEYFRAME: the selected scene keyframe (bar / easing / name / lock).
 *   - LANE POINT: the selected automation-lane point (bar / ABSOLUTE
 *     value with a base·offset breakdown / easing), plus the lane's
 *     mute/delete. Values read and edit in the same numbers as the
 *     panel knob; the stored offset is derived at commit time.
 * Scene and lane selection are mutually exclusive; TimelineDock owns the
 * lane selection and passes accessors in.
 */

import { Sequencer } from '../../sequencer/Sequencer';
import { EasingType } from '../../sequencer/types';
import { upsertPoint, removePointAt } from '../../sequencer/lanes';
import { SettingsStore } from '../../state/Settings';
import { TARGETS } from '../targets';
import { LanePointSel } from './LaneRow';
import { attachTooltip } from '../tooltip';

const EASINGS: EasingType[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'step', 'hold'];

export interface LaneSelectionAccess {
  settings: SettingsStore;
  laneSelection(): LanePointSel | null;
  setLaneSelection(sel: LanePointSel | null): void;
  /** Live-preview a not-yet-committed ABSOLUTE value in the lane row's curve. */
  previewToTimeline(laneId: string, bar: number, value: number): void;
}

/** Live references to the LANE POINT form fields, for drag-follow updates. */
interface LanePointRefs {
  laneId: string;
  barInput: HTMLInputElement;
  valueInput: HTMLInputElement;
  updateHint: (absValue: number) => void;
}

export class TimelineInspector {
  el: HTMLElement;
  private seq: Sequencer;
  private laneAccess: LaneSelectionAccess | null;
  private laneRefs: LanePointRefs | null = null;
  /** Base-value subscription for the selected lane point's param, so the
   *  Value field tracks panel-knob drags. Released on every re-render. */
  private unsubBase: (() => void) | null = null;

  constructor(seq: Sequencer, laneAccess: LaneSelectionAccess | null = null) {
    this.seq = seq;
    this.laneAccess = laneAccess;
    this.el = document.createElement('div');
    this.el.className = 'rw-tl-inspector';
    this.render();
  }

  /**
   * Mirror an in-progress point drag into the form fields without
   * touching the (not-yet-committed) timeline data. `value` is the
   * ABSOLUTE param value at the drag position.
   */
  previewLanePoint(laneId: string, bar: number, value: number): void {
    if (!this.laneRefs || this.laneRefs.laneId !== laneId) return;
    this.laneRefs.barInput.value = String(Math.round(bar * 100) / 100);
    this.laneRefs.valueInput.value = String(Math.round(value * 1000) / 1000);
    this.laneRefs.updateHint(value);
  }

  render(): void {
    const t = this.seq.timeline;
    this.laneRefs = null;
    this.unsubBase?.();
    this.unsubBase = null;
    this.el.innerHTML = '';

    // Lane-point mode wins when a lane selection exists and still
    // resolves against the current timeline.
    const laneSel = this.laneAccess?.laneSelection() ?? null;
    if (t && laneSel && this.laneAccess) {
      const lane = t.lanes.find((l) => l.id === laneSel.laneId);
      const point = lane?.points.find((p) => Math.abs(p.bar - laneSel.bar) <= 1e-9);
      if (lane && point) {
        this.renderLanePoint(this.laneAccess, lane, point, t.lengthBars);
        return;
      }
    }

    const id = this.seq.selectedKeyframeId;
    const kf = t && id ? t.keyframes.find(k => k.id === id) : null;

    const h = document.createElement('h4');
    h.textContent = 'SCENE';
    this.el.appendChild(h);

    if (!kf) {
      const e = document.createElement('div');
      e.className = 'rw-empty';
      e.textContent = 'select a scene or lane point';
      this.el.appendChild(e);
      return;
    }

    // Name
    this.el.appendChild(this.row('Name', this.text(kf.presetName ?? '', (v) => {
      this.seq.updateKeyframe(kf.id, { presetName: v || undefined });
    })));

    // Bar
    this.el.appendChild(this.row('Bar', this.numInput(kf.bar, 0, t!.lengthBars, 0.01, (v) => {
      this.seq.moveKeyframe(kf.id, v);
    })));

    // Easing
    {
      const sel = document.createElement('select');
      sel.className = 'rw-select';
      for (const e of EASINGS) {
        const o = document.createElement('option');
        o.value = e; o.textContent = e;
        if (kf.easing === e) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => this.seq.updateKeyframe(kf.id, { easing: sel.value as EasingType }));
      this.el.appendChild(this.row('Easing', sel));
    }

    // Color
    {
      const c = document.createElement('input');
      c.type = 'color';
      c.value = kf.color ?? '#5fff85';
      c.addEventListener('change', () => this.seq.updateKeyframe(kf.id, { color: c.value }));
      this.el.appendChild(this.row('Color', c));
    }

    // Lock
    {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!kf.locked;
      cb.addEventListener('change', () => this.seq.updateKeyframe(kf.id, { locked: cb.checked }));
      this.el.appendChild(this.row('Lock', cb));
    }

    // Buttons row
    const actions = document.createElement('div');
    actions.className = 'rw-tl-insp-actions';
    actions.appendChild(this.button('PREVIEW', () => this.seq.preview(kf.id)));
    actions.appendChild(this.button('REPLACE', () => this.seq.replaceSnapshot(kf.id), 'Capture current settings'));
    actions.appendChild(this.button('DUP',     () => this.seq.duplicateKeyframe(kf.id)));
    actions.appendChild(this.button('DEL',     () => this.seq.removeKeyframe(kf.id), undefined, 'warn'));
    this.el.appendChild(actions);
  }

  // -- lane-point mode --

  private renderLanePoint(
    access: LaneSelectionAccess,
    lane: { id: string; paramKey: string; enabled: boolean; points: { bar: number; value: number; easing?: EasingType }[] },
    point: { bar: number; value: number; easing?: EasingType },
    lengthBars: number,
  ): void {
    const h = document.createElement('h4');
    h.textContent = 'LANE POINT';
    this.el.appendChild(h);

    const label = document.createElement('div');
    label.className = 'rw-tl-insp-param';
    label.textContent = TARGETS.find((x) => x.v === lane.paramKey)?.l ?? lane.paramKey;
    attachTooltip(label, lane.paramKey);
    this.el.appendChild(label);

    // Bar — moving the point re-selects it at its new position.
    const barInput = this.numInput(point.bar, 0, lengthBars, 0.01, (v) => {
      this.seq.editLanes(() => {
        lane.points = upsertPoint(removePointAt(lane.points, point.bar), { ...point, bar: v });
      });
      access.setLaneSelection({ laneId: lane.id, bar: v });
    });
    this.el.appendChild(this.row('Bar', barInput));

    // Value — the ABSOLUTE param value at this point, same numbers as
    // the panel knob (traditional keyframe-editor presentation). The
    // stored offset is derived from the base at commit time; the hint
    // line below shows the breakdown.
    const baseOf = (): number => {
      const b = access.settings.get(lane.paramKey as never) as unknown;
      return typeof b === 'number' ? b : 0;
    };
    const hint = document.createElement('div');
    hint.className = 'rw-tl-insp-resolved';
    const updateHint = (abs: number): void => {
      const base = baseOf();
      const off = abs - base;
      hint.textContent =
        `= base ${base.toFixed(3)} ${off >= 0 ? '+' : '−'} ${Math.abs(off).toFixed(3)}`;
    };
    updateHint(baseOf() + point.value);
    const valueInput = this.numInput(baseOf() + point.value, -1e9, 1e9, 0.01, (v) => {
      this.seq.editLanes(() => {
        lane.points = upsertPoint(lane.points, { ...point, value: v - baseOf() });
      });
    });
    valueInput.addEventListener('input', () => {
      const v = parseFloat(valueInput.value);
      if (!Number.isFinite(v)) return;
      updateHint(v);
      // Live-preview the curve in the lane row before committing.
      access.previewToTimeline(lane.id, point.bar, v);
    });
    this.el.appendChild(this.row('Value', valueInput));
    this.el.appendChild(hint);

    // Registered AFTER both fields exist so a drag in the lane row can
    // mirror into them live.
    this.laneRefs = { laneId: lane.id, barInput, valueInput, updateHint };

    // Track panel-knob drags: the point's offset is fixed, so a base
    // change moves its absolute value — keep the field and hint in sync
    // (unless the user is mid-edit in the field itself).
    let firstFire = true;
    this.unsubBase = access.settings.subscribe(lane.paramKey as never, () => {
      if (firstFire) { firstFire = false; return; } // immediate fire; already fresh
      if (valueInput.ownerDocument.activeElement === valueInput) return;
      const abs = baseOf() + point.value;
      valueInput.value = String(Math.round(abs * 1000) / 1000);
      updateHint(abs);
    });

    // Easing into this point.
    {
      const sel = document.createElement('select');
      sel.className = 'rw-select';
      for (const e of EASINGS) {
        const o = document.createElement('option');
        o.value = e; o.textContent = e;
        if ((point.easing ?? 'linear') === e) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => this.seq.editLanes(() => {
        lane.points = upsertPoint(lane.points, { ...point, easing: sel.value as EasingType });
      }));
      this.el.appendChild(this.row('Easing', sel));
    }

    const ptActions = document.createElement('div');
    ptActions.className = 'rw-tl-insp-actions';
    ptActions.appendChild(this.button('DEL POINT', () => {
      access.setLaneSelection(null);
      this.seq.editLanes(() => {
        lane.points = removePointAt(lane.points, point.bar);
      });
    }, undefined, 'warn'));
    this.el.appendChild(ptActions);

    // Lane-level controls under a thin divider.
    const div = document.createElement('div');
    div.className = 'rw-tl-insp-divider';
    this.el.appendChild(div);

    {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = lane.enabled;
      cb.addEventListener('change', () => this.seq.editLanes(() => {
        lane.enabled = cb.checked;
      }));
      this.el.appendChild(this.row('Lane on', cb));
    }
    const laneActions = document.createElement('div');
    laneActions.className = 'rw-tl-insp-actions';
    laneActions.appendChild(this.button('DELETE LANE', () => {
      access.setLaneSelection(null);
      this.seq.editLanes((tl) => {
        tl.lanes = tl.lanes.filter((l) => l.id !== lane.id);
      });
    }, 'Remove the lane and all its points (undoable)', 'warn'));
    this.el.appendChild(laneActions);
  }

  // -- helpers --
  private row(label: string, control: HTMLElement): HTMLElement {
    const r = document.createElement('div');
    r.className = 'rw-row';
    const l = document.createElement('label');
    l.textContent = label;
    r.append(l, control);
    return r;
  }

  private text(value: string, onChange: (v: string) => void): HTMLInputElement {
    const i = document.createElement('input');
    i.type = 'text'; i.className = 'rw-text'; i.value = value;
    i.addEventListener('change', () => onChange(i.value));
    return i;
  }

  private numInput(value: number, min: number, max: number, step: number, onChange: (v: number) => void): HTMLInputElement {
    const i = document.createElement('input');
    i.type = 'number'; i.className = 'rw-num';
    i.min = String(min); i.max = String(max); i.step = String(step);
    i.value = String(value);
    i.addEventListener('change', () => {
      const v = parseFloat(i.value);
      if (Number.isFinite(v)) onChange(v);
    });
    return i;
  }

  private button(label: string, onClick: () => void, title?: string, kind?: 'warn'): HTMLElement {
    const b = document.createElement('button');
    b.className = 'rw-btn'; b.type = 'button'; b.textContent = label;
    if (title) attachTooltip(b, title);
    if (kind) b.classList.add(kind);
    b.addEventListener('click', onClick);
    return b;
  }
}
