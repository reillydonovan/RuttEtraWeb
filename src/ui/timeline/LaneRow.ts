/**
 * One automation lane rendered as a horizontal strip in the lane editor:
 * a sticky-left header chip (mute / label / point count / expand / delete),
 * a canvas-2d curve, and DOM point diamonds draggable in 2D (bar + offset).
 *
 * All mutations go through `seq.editLanes()` — the single lane write path
 * with undo. Drags preview against a working copy and commit ONCE on
 * pointerup (one undo step per gesture, same contract as the scene
 * track's keyframe drag).
 *
 * The value axis shows ABSOLUTE param values (traditional keyframe-
 * editor presentation — the curve reads in the same numbers as the
 * panel knob). It spans the param's effective slider range (designed
 * range from paramRangeRegistry, overridden by the user's v19 custom
 * range if set) and expands to fit outlier points. A dashed line marks
 * the current BASE value; points are stored as offsets from it, so
 * moving the panel knob visibly shifts the whole curve.
 */

import { Sequencer } from '../../sequencer/Sequencer';
import { AutomationLane, AutomationPoint, EasingType } from '../../sequencer/types';
import { upsertPoint, removePointAt, evalLane } from '../../sequencer/lanes';
import { SettingsStore } from '../../state/Settings';
import { TARGETS } from '../targets';
import { getDesignedRange } from '../paramRangeRegistry';
import { showContextMenu } from './contextMenu';
import { attachTooltip } from '../tooltip';
import {
  LaneAxis, laneAxisAbs, barToX, valueToY, snapBarToBeat, sampleLane, dragResult,
} from './laneGeometry';

const EASINGS: EasingType[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'step', 'hold'];
const COLLAPSED_H = 28;
const EXPANDED_H = 64;
const PT_HIT = 10; // diamond box size in px

export interface LanePointSel {
  laneId: string;
  bar: number;
}

export interface LaneRowHost {
  pixelsPerBar(): number;
  selection(): LanePointSel | null;
  selectPoint(sel: LanePointSel | null): void;
  isExpanded(laneId: string): boolean;
  setExpanded(laneId: string, expanded: boolean): void;
  /** Live-update the inspector's fields while a point drags.
   *  `value` is the ABSOLUTE param value (base + offset). */
  previewToInspector(laneId: string, bar: number, value: number): void;
}

export class LaneRow {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ptsLayer: HTMLElement;
  private axis: LaneAxis = { min: -1, max: 1 };
  private dragTip: HTMLElement | null = null;
  private unsubBase: (() => void) | null = null;

  constructor(
    private settings: SettingsStore,
    private seq: Sequencer,
    private lane: AutomationLane,
    private host: LaneRowHost,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'rw-tl-lane-row';
    this.el.dataset.laneId = lane.id;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'rw-tl-lane-canvas';
    this.ptsLayer = document.createElement('div');
    this.ptsLayer.className = 'rw-tl-lane-pts';

    this.el.append(this.canvas, this.ptsLayer, this.buildChip());
    this.el.addEventListener('dblclick', this.onRowDblClick);
    this.el.addEventListener('click', this.onRowClick);
    this.el.addEventListener('contextmenu', this.onRowContext);

    // The curve renders base + offsets, so a panel-knob drag must redraw
    // it live. Fires immediately, which is also the constructor render.
    this.unsubBase = this.settings.subscribe(
      this.lane.paramKey as never, () => this.render());
  }

  /** Drop the settings subscription (LaneEditor calls this on rebuild). */
  dispose(): void {
    this.unsubBase?.();
    this.unsubBase = null;
  }

  /** Current base value of the lane's param (0 for non-numeric keys). */
  private baseValue(): number {
    const b = this.settings.get(this.lane.paramKey as never) as unknown;
    return typeof b === 'number' ? b : 0;
  }

  /** Effective slider range for the value axis: user override > designed. */
  private effectiveRange(): { min: number; max: number } | null {
    const overrides = this.settings.get('paramRangeOverrides') as
      Record<string, { min: number; max: number }> | undefined;
    const ov = overrides?.[this.lane.paramKey];
    if (ov) return ov;
    return getDesignedRange(this.lane.paramKey);
  }

  private rowHeight(): number {
    return this.host.isExpanded(this.lane.id) ? EXPANDED_H : COLLAPSED_H;
  }

  private timelineWidth(): number {
    const t = this.seq.timeline;
    return t ? t.lengthBars * this.host.pixelsPerBar() : 0;
  }

  render(): void {
    const expanded = this.host.isExpanded(this.lane.id);
    this.el.classList.toggle('expanded', expanded);
    this.el.classList.toggle('muted', !this.lane.enabled);
    this.el.style.height = `${this.rowHeight()}px`;
    this.el.style.width = `${this.timelineWidth()}px`;

    this.axis = laneAxisAbs(this.effectiveRange(), this.baseValue(), this.lane.points);
    this.renderPoints(this.lane.points);
    this.drawCurve(this.lane.points);
  }

  /**
   * Live-preview an edited ABSOLUTE value for the point at `bar` (typed
   * in the inspector, not yet committed): move its diamond and redraw
   * the curve from a working copy. The commit re-renders consistently.
   */
  previewValue(bar: number, absValue: number): void {
    const offset = absValue - this.baseValue();
    const preview = upsertPoint(this.lane.points, { bar, value: offset });
    for (const el of Array.from(this.ptsLayer.children) as HTMLElement[]) {
      if (parseFloat(el.dataset.bar ?? '') === bar) this.positionPoint(el, bar, offset);
    }
    this.drawCurve(preview);
  }

  applySelection(): void {
    const sel = this.host.selection();
    for (const el of Array.from(this.ptsLayer.children) as HTMLElement[]) {
      const bar = parseFloat(el.dataset.bar ?? '');
      el.classList.toggle(
        'selected',
        !!sel && sel.laneId === this.lane.id && Math.abs(sel.bar - bar) <= 1e-9,
      );
    }
  }

  // ------------------------------------------------------------------
  // Header chip
  // ------------------------------------------------------------------

  private buildChip(): HTMLElement {
    const chip = document.createElement('div');
    chip.className = 'rw-tl-lane-chip';

    const en = document.createElement('input');
    en.type = 'checkbox';
    en.checked = this.lane.enabled;
    attachTooltip(en, 'Enable lane (muted lanes contribute nothing)');
    en.addEventListener('change', () => {
      this.seq.editLanes(() => { this.lane.enabled = en.checked; });
    });
    en.addEventListener('dblclick', (ev) => ev.stopPropagation());

    const label = document.createElement('span');
    label.className = 'rw-tl-lane-name';
    label.textContent = TARGETS.find((x) => x.v === this.lane.paramKey)?.l ?? this.lane.paramKey;
    attachTooltip(label, this.lane.paramKey);

    const count = document.createElement('span');
    count.className = 'rw-tl-lane-count';
    count.textContent = `${this.lane.points.length}`;
    attachTooltip(count, () => `${this.lane.points.length} point${this.lane.points.length === 1 ? '' : 's'}`);

    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'rw-btn rw-tl-lane-expand';
    expand.textContent = this.host.isExpanded(this.lane.id) ? '▾' : '▸';
    attachTooltip(expand, () => this.host.isExpanded(this.lane.id) ? 'Collapse lane (hide the curve)' : 'Expand lane (show the curve)');
    expand.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.host.setExpanded(this.lane.id, !this.host.isExpanded(this.lane.id));
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'rw-btn rw-x';
    del.textContent = '✕';
    attachTooltip(del, 'Delete lane (and all its points — undoable)');
    del.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.deleteLane();
    });

    chip.append(en, label, count, expand, del);
    // The chip floats over the curve; don't let its clicks fall through
    // to the row's add-point handlers.
    chip.addEventListener('dblclick', (ev) => ev.stopPropagation());
    chip.addEventListener('contextmenu', (ev) => ev.stopPropagation());
    return chip;
  }

  private deleteLane(): void {
    const sel = this.host.selection();
    if (sel?.laneId === this.lane.id) this.host.selectPoint(null);
    this.seq.editLanes((t) => {
      t.lanes = t.lanes.filter((l) => l.id !== this.lane.id);
    });
  }

  // ------------------------------------------------------------------
  // Points
  // ------------------------------------------------------------------

  private renderPoints(points: AutomationPoint[]): void {
    this.ptsLayer.replaceChildren();
    if (!this.host.isExpanded(this.lane.id)) return;
    const base = this.baseValue();
    for (const p of points) {
      const d = document.createElement('div');
      d.className = 'rw-tl-lane-pt';
      d.dataset.bar = String(p.bar);
      this.positionPoint(d, p.bar, p.value);
      attachTooltip(d, () => `bar ${p.bar.toFixed(2)} · ${(base + p.value).toFixed(3)} (${p.easing ?? 'linear'}) — drag to move, right-click for more`);
      d.addEventListener('pointerdown', (ev) => this.onPointDown(ev, p));
      d.addEventListener('contextmenu', (ev) => this.onPointContext(ev, p));
      this.ptsLayer.appendChild(d);
    }
    this.applySelection();
  }

  /** `value` is the stored OFFSET; positioning happens in absolute space. */
  private positionPoint(el: HTMLElement, bar: number, value: number): void {
    const ppb = this.host.pixelsPerBar();
    el.style.left = `${barToX(bar, ppb) - PT_HIT / 2}px`;
    el.style.top = `${valueToY(this.baseValue() + value, this.axis, this.rowHeight()) - PT_HIT / 2}px`;
  }

  private onPointDown = (ev: PointerEvent, p: AutomationPoint): void => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    ev.preventDefault();
    this.host.selectPoint({ laneId: this.lane.id, bar: p.bar });

    const t = this.seq.timeline;
    if (!t) return;
    const target = ev.currentTarget as HTMLElement;
    target.setPointerCapture?.(ev.pointerId);
    const startX = ev.clientX;
    const startY = ev.clientY;
    const startBar = p.bar;
    const base = this.baseValue();
    // Drag math runs in ABSOLUTE value space (matches the axis); the
    // stored point value stays an offset from the base.
    const startAbs = base + p.value;
    let last = { bar: startBar, value: p.value };
    let moved = false;

    const onMove = (mv: PointerEvent) => {
      const r = dragResult(startBar, startAbs, mv.clientX - startX, mv.clientY - startY, {
        pixelsPerBar: this.host.pixelsPerBar(),
        rowHeight: this.rowHeight(),
        axis: this.axis,
        beatsPerBar: t.beatsPerBar,
        lengthBars: t.lengthBars,
        free: mv.altKey,
      });
      const offset = r.value - base;
      if (r.bar === last.bar && offset === last.value) return;
      last = { bar: r.bar, value: offset };
      moved = true;
      this.positionPoint(target, r.bar, offset);
      // Preview curve against a working copy — no store writes mid-drag.
      const preview = upsertPoint(
        removePointAt(this.lane.points, startBar),
        { bar: r.bar, value: offset, easing: p.easing },
      );
      this.drawCurve(preview);
      this.showDragTip(mv.clientX, mv.clientY, r.bar, r.value);
      // Keep the inspector's Bar/Value fields aligned with the drag.
      this.host.previewToInspector(this.lane.id, r.bar, r.value);
    };
    const onUp = (mv: PointerEvent) => {
      target.releasePointerCapture?.(mv.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.hideDragTip();
      if (!moved) return;
      // One editLanes call = one undo step per drag.
      this.seq.editLanes(() => {
        this.lane.points = upsertPoint(
          removePointAt(this.lane.points, startBar),
          { bar: last.bar, value: last.value, easing: p.easing },
        );
      });
      this.host.selectPoint({ laneId: this.lane.id, bar: last.bar });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  private onPointContext = (ev: MouseEvent, p: AutomationPoint): void => {
    ev.preventDefault();
    ev.stopPropagation();
    this.host.selectPoint({ laneId: this.lane.id, bar: p.bar });
    showContextMenu(ev.clientX, ev.clientY, [
      ...EASINGS.map((e) => ({
        label: `Easing: ${e}${(p.easing ?? 'linear') === e ? ' ✓' : ''}`,
        onClick: () => this.seq.editLanes(() => {
          this.lane.points = upsertPoint(this.lane.points, { ...p, easing: e });
        }),
      })),
      { separator: true, label: '' },
      {
        label: 'Delete point',
        onClick: () => {
          this.host.selectPoint(null);
          this.seq.editLanes(() => {
            this.lane.points = removePointAt(this.lane.points, p.bar);
          });
        },
      },
    ]);
  };

  // ------------------------------------------------------------------
  // Row-level interaction (add point / lane menu)
  // ------------------------------------------------------------------

  private barValueFromEvent(ev: MouseEvent): { bar: number; value: number } | null {
    const t = this.seq.timeline;
    if (!t) return null;
    if ((ev.target as HTMLElement).closest('.rw-tl-lane-pt, .rw-tl-lane-chip')) return null;
    const rect = this.el.getBoundingClientRect();
    let bar = (ev.clientX - rect.left) / this.host.pixelsPerBar();
    if (!ev.altKey) bar = snapBarToBeat(bar, t.beatsPerBar);
    bar = Math.max(0, Math.min(t.lengthBars, bar));
    // New points PIN the curve's current value at that bar — adding a
    // point never changes the live value, only creates a handle.
    return { bar, value: evalLane(this.lane.points, bar) };
  }

  private addPointAt(bar: number, value: number): void {
    if (!this.host.isExpanded(this.lane.id)) this.host.setExpanded(this.lane.id, true);
    this.seq.editLanes(() => {
      this.lane.points = upsertPoint(this.lane.points, { bar, value });
    });
    this.host.selectPoint({ laneId: this.lane.id, bar });
  }

  private onRowDblClick = (ev: MouseEvent): void => {
    const hit = this.barValueFromEvent(ev);
    if (!hit) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.addPointAt(hit.bar, hit.value);
  };

  private onRowClick = (ev: MouseEvent): void => {
    if (!ev.ctrlKey && !ev.metaKey) return;
    const hit = this.barValueFromEvent(ev);
    if (!hit) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.addPointAt(hit.bar, hit.value);
  };

  private onRowContext = (ev: MouseEvent): void => {
    const hit = this.barValueFromEvent(ev);
    if (!hit) return; // point/chip menus handle their own
    ev.preventDefault();
    ev.stopPropagation();
    showContextMenu(ev.clientX, ev.clientY, [
      { label: `Add point at bar ${hit.bar.toFixed(2)}`, onClick: () => this.addPointAt(hit.bar, hit.value) },
      { label: this.lane.enabled ? 'Mute lane' : 'Unmute lane', onClick: () => {
        this.seq.editLanes(() => { this.lane.enabled = !this.lane.enabled; });
      } },
      { separator: true, label: '' },
      { label: 'Delete lane', onClick: () => this.deleteLane() },
    ]);
  };

  // ------------------------------------------------------------------
  // Curve
  // ------------------------------------------------------------------

  private drawCurve(points: AutomationPoint[]): void {
    const t = this.seq.timeline;
    if (!t) return;
    const cssW = this.timelineWidth();
    const cssH = this.rowHeight();
    if (cssW <= 0 || cssH <= 0) return;

    // DPR pattern from CableLayer, with guards for very long timelines at
    // high zoom (canvas dimension limits).
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cssW * dpr > 8192) dpr = 1;
    this.canvas.width = Math.min(16384, Math.round(cssW * dpr));
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return; // jsdom / test environments
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const base = this.baseValue();
    const baseY = valueToY(base, this.axis, cssH);

    // Dashed line at the BASE value — the panel knob's contribution;
    // the curve rides on it and shifts when the knob moves.
    ctx.strokeStyle = 'rgba(95, 255, 133, 0.25)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    ctx.lineTo(cssW, baseY);
    ctx.stroke();
    ctx.setLineDash([]);

    if (points.length > 0) {
      const ppb = this.host.pixelsPerBar();
      const stepBars = Math.max(2 / ppb, t.lengthBars / 4096);
      const samples = sampleLane(points, 0, t.lengthBars, stepBars);

      ctx.beginPath();
      samples.forEach(([bar, value], i) => {
        const x = barToX(bar, ppb);
        const y = valueToY(base + value, this.axis, cssH);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = 'rgba(126, 255, 156, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Soft fill between curve and base line.
      ctx.lineTo(barToX(t.lengthBars, ppb), baseY);
      ctx.lineTo(0, baseY);
      ctx.closePath();
      ctx.fillStyle = 'rgba(95, 255, 133, 0.08)';
      ctx.fill();
    }

    // Axis extents (absolute values), faint, pinned to the left edge.
    if (this.host.isExpanded(this.lane.id)) {
      ctx.fillStyle = 'rgba(90, 154, 114, 0.7)';
      ctx.font = '9px monospace';
      ctx.fillText(fmtAxis(this.axis.max), 2, 8);
      ctx.fillText(fmtAxis(this.axis.min), 2, cssH - 2);
    }
  }

  // ------------------------------------------------------------------
  // Drag tooltip
  // ------------------------------------------------------------------

  /** `absValue` is the point's absolute param value at the drag position. */
  private showDragTip(clientX: number, clientY: number, bar: number, absValue: number): void {
    if (!this.dragTip) {
      this.dragTip = document.createElement('div');
      this.dragTip.className = 'rw-tl-lane-tip';
      document.body.appendChild(this.dragTip);
    }
    this.dragTip.textContent = `bar ${bar.toFixed(2)} · ${absValue.toFixed(3)}`;
    this.dragTip.style.left = `${clientX + 12}px`;
    this.dragTip.style.top = `${clientY - 24}px`;
  }

  private hideDragTip(): void {
    this.dragTip?.remove();
    this.dragTip = null;
  }
}

function fmtAxis(v: number): string {
  const a = Math.abs(v);
  return a >= 10 ? v.toFixed(0) : a >= 1 ? v.toFixed(1) : v.toFixed(2);
}
