/**
 * Inspector column (fixed 220px, right of the scroller). Two modes:
 *   - KEYFRAME: the selected scene keyframe (bar / easing / name / lock).
 *   - LANE POINT: the selected automation-lane point (bar / offset with a
 *     resolved-absolute preview / easing), plus the lane's mute/delete.
 * Scene and lane selection are mutually exclusive; TimelineDock owns the
 * lane selection and passes accessors in.
 */

import { Sequencer } from '../../sequencer/Sequencer';
import { EasingType } from '../../sequencer/types';
import { upsertPoint, removePointAt } from '../../sequencer/lanes';
import { SettingsStore } from '../../state/Settings';
import { TARGETS } from '../targets';
import { LanePointSel } from './LaneRow';

const EASINGS: EasingType[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'step', 'hold'];

export interface LaneSelectionAccess {
  settings: SettingsStore;
  laneSelection(): LanePointSel | null;
  setLaneSelection(sel: LanePointSel | null): void;
}

export class TimelineInspector {
  el: HTMLElement;
  private seq: Sequencer;
  private laneAccess: LaneSelectionAccess | null;

  constructor(seq: Sequencer, laneAccess: LaneSelectionAccess | null = null) {
    this.seq = seq;
    this.laneAccess = laneAccess;
    this.el = document.createElement('div');
    this.el.className = 'rw-tl-inspector';
    this.render();
  }

  render(): void {
    const t = this.seq.timeline;
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
    actions.style.display = 'flex'; actions.style.gap = '4px'; actions.style.marginTop = '6px';
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
    label.title = lane.paramKey;
    this.el.appendChild(label);

    // Bar — moving the point re-selects it at its new position.
    this.el.appendChild(this.row('Bar', this.numInput(point.bar, 0, lengthBars, 0.01, (v) => {
      this.seq.editLanes(() => {
        lane.points = upsertPoint(removePointAt(lane.points, point.bar), { ...point, bar: v });
      });
      access.setLaneSelection({ laneId: lane.id, bar: v });
    })));

    // Offset (the stored relative value) with a live resolved-absolute
    // preview — the owner-decided display affordance for the relative model.
    const resolved = document.createElement('div');
    resolved.className = 'rw-tl-insp-resolved';
    const updateResolved = (off: number): void => {
      const base = access.settings.get(lane.paramKey as never) as unknown;
      resolved.textContent = typeof base === 'number'
        ? `→ resolves to ${(base + off).toFixed(3)} (base ${base.toFixed(3)})`
        : '';
    };
    updateResolved(point.value);
    const offsetInput = this.numInput(point.value, -1e9, 1e9, 0.01, (v) => {
      this.seq.editLanes(() => {
        lane.points = upsertPoint(lane.points, { ...point, value: v });
      });
    });
    offsetInput.addEventListener('input', () => {
      const v = parseFloat(offsetInput.value);
      if (Number.isFinite(v)) updateResolved(v);
    });
    this.el.appendChild(this.row('Offset', offsetInput));
    this.el.appendChild(resolved);

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
    ptActions.style.display = 'flex'; ptActions.style.gap = '4px'; ptActions.style.marginTop = '6px';
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
    laneActions.style.display = 'flex'; laneActions.style.gap = '4px'; laneActions.style.marginTop = '6px';
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
    if (title) b.title = title;
    if (kind) b.classList.add(kind);
    b.addEventListener('click', onClick);
    return b;
  }
}
