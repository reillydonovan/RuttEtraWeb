/**
 * Mini rotary knob for the Patch Bay — the compact, self-contained
 * cousin of the hardware skin's knob face inside `widgets.ts`'s
 * `slider()` (same SVG recipe: 270° pot sweep, arc track + fill, cap,
 * pointer line; same gesture: vertical drag ≈160px = full span, Shift =
 * fine ×0.1, double-click = reset). It exists separately because
 * `slider()` is a full panel row bound to a Settings key with five
 * faces, stop chips, range-override plumbing, and timeline auto-key —
 * far heavier than a jack-cell or graph-node param row needs, and the
 * bay also binds knobs to NON-Settings values (graph node params).
 *
 * Adds one thing slider()'s knob doesn't have: a LIVE pointer — a
 * second, thinner amber needle showing the modulated value riding on
 * top of the base the knob edits (owner: the bay must show the live
 * value the way Controls' orange badge does). Display only; nothing
 * here ever writes a live value (base/live split, principle 2).
 */

const KNOB_SWEEP = 270; // degrees of pot travel, -135°..+135°, 0° = up
const SVG_NS = 'http://www.w3.org/2000/svg';

export interface MiniKnobOpts {
  min: number;
  max: number;
  step: number;
  /** Aria label / tooltip context. */
  label: string;
  /** Read the current BASE value. */
  get(): number;
  /** Write a new BASE value (already snapped/clamped). */
  set(v: number): void;
  /** Double-click reset target; omit to disable the gesture. */
  defaultValue?: number;
}

export interface MiniKnob {
  el: HTMLElement;
  /** Re-read `get()` and update the pointer/fill. Cheap no-op when the
   *  value hasn't changed since the last call. */
  refresh(): void;
  /** Show/update the amber live-value needle; `null` hides it. Cheap
   *  no-op when unchanged. */
  setLive(v: number | null): void;
}

function arcPath(r: number): string {
  const pt = (deg: number): string => {
    const a = (deg * Math.PI) / 180;
    return `${(20 + r * Math.sin(a)).toFixed(3)} ${(20 - r * Math.cos(a)).toFixed(3)}`;
  };
  return `M ${pt(-KNOB_SWEEP / 2)} A ${r} ${r} 0 1 1 ${pt(KNOB_SWEEP / 2)}`;
}

export function createMiniKnob(opts: MiniKnobOpts): MiniKnob {
  const el = document.createElement('div');
  el.className = 'rw-pbknob';
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-orientation', 'vertical');
  el.setAttribute('aria-label', opts.label);
  el.tabIndex = 0;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('class', 'rw-pbknob-svg');
  const track = document.createElementNS(SVG_NS, 'path');
  track.setAttribute('d', arcPath(17));
  track.setAttribute('class', 'rw-pbknob-track');
  const fill = document.createElementNS(SVG_NS, 'path');
  fill.setAttribute('d', arcPath(17));
  fill.setAttribute('pathLength', String(KNOB_SWEEP));
  fill.setAttribute('stroke-dasharray', `0 ${KNOB_SWEEP}`);
  fill.setAttribute('class', 'rw-pbknob-fill');
  const cap = document.createElementNS(SVG_NS, 'circle');
  cap.setAttribute('cx', '20');
  cap.setAttribute('cy', '20');
  cap.setAttribute('r', '13');
  cap.setAttribute('class', 'rw-pbknob-cap');
  const ptr = document.createElementNS(SVG_NS, 'line');
  ptr.setAttribute('x1', '20'); ptr.setAttribute('y1', '20');
  ptr.setAttribute('x2', '20'); ptr.setAttribute('y2', '9');
  ptr.setAttribute('class', 'rw-pbknob-ptr');
  const livePtr = document.createElementNS(SVG_NS, 'line');
  livePtr.setAttribute('x1', '20'); livePtr.setAttribute('y1', '20');
  livePtr.setAttribute('x2', '20'); livePtr.setAttribute('y2', '6');
  livePtr.setAttribute('class', 'rw-pbknob-liveptr');
  livePtr.setAttribute('visibility', 'hidden');
  svg.append(track, fill, cap, ptr, livePtr);
  el.appendChild(svg);

  const clamp = (v: number): number => Math.min(opts.max, Math.max(opts.min, v));
  const snap = (v: number): number => {
    const s = opts.step;
    return s > 0 ? Math.round(v / s) * s : v;
  };
  const angleFor = (v: number): number => {
    const span = opts.max - opts.min;
    const t = span === 0 ? 0 : Math.min(1, Math.max(0, (v - opts.min) / span));
    return -KNOB_SWEEP / 2 + t * KNOB_SWEEP;
  };

  let lastShown = Number.NaN;
  function refresh(): void {
    const v = opts.get();
    if (Object.is(v, lastShown)) return;
    lastShown = v;
    const a = angleFor(v);
    ptr.setAttribute('transform', `rotate(${a.toFixed(2)} 20 20)`);
    const t = (a + KNOB_SWEEP / 2) / KNOB_SWEEP;
    fill.setAttribute('stroke-dasharray', `${(t * KNOB_SWEEP).toFixed(2)} ${KNOB_SWEEP}`);
    el.setAttribute('aria-valuenow', String(v));
  }

  let lastLive: number | null = null;
  function setLive(v: number | null): void {
    if (v === lastLive || (v !== null && lastLive !== null && Object.is(v, lastLive))) return;
    const wasShown = lastLive !== null;
    lastLive = v;
    if (v === null) {
      livePtr.setAttribute('visibility', 'hidden');
      return;
    }
    if (!wasShown) livePtr.setAttribute('visibility', 'visible');
    livePtr.setAttribute('transform', `rotate(${angleFor(v).toFixed(2)} 20 20)`);
  }

  el.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    ev.stopPropagation(); // don't start a board pan / unit drag
    const doc = el.ownerDocument;
    const id = ev.pointerId;
    const startY = ev.clientY;
    const startVal = opts.get();
    const onMove = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      e.preventDefault();
      const fine = e.shiftKey ? 0.1 : 1;
      const span = opts.max - opts.min;
      opts.set(clamp(snap(startVal + ((startY - e.clientY) / 160) * span * fine)));
      refresh();
    };
    const onUp = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerup', onUp);
      doc.removeEventListener('pointercancel', onUp);
    };
    doc.addEventListener('pointermove', onMove, { passive: false });
    doc.addEventListener('pointerup', onUp);
    doc.addEventListener('pointercancel', onUp);
  });
  if (opts.defaultValue !== undefined) {
    el.addEventListener('dblclick', () => { opts.set(opts.defaultValue!); refresh(); });
  }
  el.addEventListener('keydown', (ev) => {
    let v = opts.get();
    switch (ev.key) {
      case 'ArrowUp': case 'ArrowRight': v += opts.step; break;
      case 'ArrowDown': case 'ArrowLeft': v -= opts.step; break;
      case 'PageUp': v += opts.step * 10; break;
      case 'PageDown': v -= opts.step * 10; break;
      case 'Home': v = opts.min; break;
      case 'End': v = opts.max; break;
      default: return;
    }
    ev.preventDefault();
    opts.set(clamp(snap(v)));
    refresh();
  });

  refresh();
  return { el, refresh, setLive };
}
