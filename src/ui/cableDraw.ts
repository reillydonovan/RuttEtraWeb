/**
 * Shared patch-cable drawing primitive — the ONE bezier/glow/dash recipe
 * used by both cable surfaces (one concept, one source):
 *
 *   - the graph editor's CableLayer (`ui/graph/CableLayer.ts`), which
 *     draws horizontal signal-flow cables between node ports, and
 *   - the rack skin's RackLayer (`ui/rack/RackLayer.ts`), which draws
 *     gravity-sagged cables between mod-slot output jacks and param
 *     input jacks.
 *
 * `cableControlPoints` is pure (unit-tested); `drawPatchCable` is the
 * thin canvas wrapper around it.
 */

export interface CablePoint { x: number; y: number }

/** Last-applied sizing per canvas so per-frame calls don't churn style. */
const fitCache = new WeakMap<HTMLCanvasElement, { w: number; h: number; z: number; dpr: number }>();

/** Backing-store axis cap — beyond this a canvas risks failing to
 *  allocate entirely (which Chromium paints as an opaque white rect,
 *  far worse than a slightly soft cable). */
const MAX_BACKING_PX = 8192;

/**
 * The canvas's accumulated CSS `zoom` factor (its own × every
 * ancestor's). Global Text Size applies `zoom` to each workspace
 * window's direct children, and WHERE that boundary sits relative to
 * the canvas varies by surface — the rack overlay's canvas is itself a
 * zoomed direct child of the shell, while the bay's sits deeper. So the
 * factor must be read from the canvas's own chain, not inferred from
 * some host element's box ratio (measuring the SHELL's ratio reads 1.0
 * even though the canvas inside it is zoomed — that mismatch once fed a
 * runaway resize loop, see fitCableCanvas).
 */
function accumulatedZoom(el: Element): number {
  const win = el.ownerDocument.defaultView;
  if (!win) return 1;
  let z = 1;
  for (let n: Element | null = el; n; n = n.parentElement) {
    const zv = parseFloat((win.getComputedStyle(n) as CSSStyleDeclaration & { zoom?: string }).zoom || '1');
    if (Number.isFinite(zv) && zv > 0 && zv !== 1) z *= zv;
  }
  return z;
}

/**
 * Size a cable canvas so its VISUAL (on-screen) size exactly matches
 * `coverage`, and set the context transform so one drawing unit = one
 * visual pixel.
 *
 * Why this exists: every cable surface measures jack/port anchors in
 * visual screen pixels (`getBoundingClientRect`/`clientX`) and maps
 * them canvas-local by subtracting the reference rect's origin. That's
 * only correct if the canvas's visual size (and therefore its drawing-
 * unit-to-screen mapping) matches. The naive `canvas.style.width =
 * rect.width + 'px'` breaks under Global Text Size: that style is CSS
 * pixels INSIDE the ancestor's CSS `zoom`, so the canvas renders
 * `zoom×` bigger and every drawn coordinate lands scaled by `zoom`
 * from the top-left — cables drift progressively further off their
 * jacks the further down/right they are (confirmed live at text scale
 * 110%: drawn endpoints matched the jacks' visual coordinates exactly
 * but appeared at 1.1× them). Dividing the CSS size by the canvas's
 * accumulated zoom makes the visual size come out right; callers'
 * anchor math needs no change.
 *
 * `coverage` is VISUAL pixels and must be computed WITHOUT consulting
 * the canvas itself (e.g. never from a parent's scrollWidth while the
 * canvas is inside that parent): the canvas's own zoomed box feeding
 * back into its next size grows it ~zoom× per FRAME until allocation
 * fails and the canvas paints solid white (a 35,000×92,000px canvas
 * was reached within seconds when this rule was broken).
 */
export function fitCableCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  coverage: { width: number; height: number },
): { w: number; h: number } {
  const win = canvas.ownerDocument.defaultView ?? window;
  const dpr = Math.min(2, win.devicePixelRatio || 1);
  const w = Math.max(1, Math.floor(coverage.width));
  const h = Math.max(1, Math.floor(coverage.height));
  const z = accumulatedZoom(canvas);
  const prev = fitCache.get(canvas);
  if (!prev || prev.w !== w || prev.h !== h || Math.abs(prev.z - z) > 1e-3 || prev.dpr !== dpr) {
    canvas.width = Math.min(MAX_BACKING_PX, Math.floor(w * dpr));
    canvas.height = Math.min(MAX_BACKING_PX, Math.floor(h * dpr));
    canvas.style.width = `${w / z}px`;
    canvas.style.height = `${h / z}px`;
    fitCache.set(canvas, { w, h, z, dpr });
  }
  // One drawing unit = one visual pixel, even when the backing store
  // was capped (the cable just renders softer there, never misplaced).
  ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
  return { w, h };
}

export type CableStyle = 'flow' | 'sag';

/**
 * Bezier control points for a cable from `a` to `b`.
 *
 *   'flow' — horizontal editor flow: control points push outward in X
 *            (min 40px, else half the horizontal distance). The graph
 *            editor's historical shape, preserved exactly.
 *   'sag'  — physical patch cable: both control points hang below the
 *            endpoints, more for longer cables (capped so a cross-panel
 *            cable doesn't swing off-screen).
 */
export function cableControlPoints(a: CablePoint, b: CablePoint, style: CableStyle): [CablePoint, CablePoint] {
  if (style === 'flow') {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
    return [{ x: a.x + dx, y: a.y }, { x: b.x - dx, y: b.y }];
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const sag = Math.min(140, dist * 0.25 + 24);
  // A physical cable billows sideways under its own slack — most
  // noticeably when both ends sit at nearly the same x, where a purely
  // vertical 'sag' curve is visually indistinguishable from any other
  // same-column cable and looks like it terminates wherever it happens
  // to cross a jack it's only passing by (rack skin / Patch Bay bug:
  // several cables sharing one source jack, all landing in the same
  // left-rail column, collapsed into what read as a single cable
  // running through every module in between). The billow fades out
  // once the endpoints already have real horizontal separation, where
  // an already-diagonal curve reads fine without it.
  const straightness = Math.max(0, 1 - Math.abs(dx) / 60);
  const bow = straightness * Math.min(60, dist * 0.15);
  // A uniform "+sag downward from both ends" (the classic hammock hang)
  // only looks right when the endpoints are roughly level. For a mostly
  // VERTICAL cable, pushing the control point nearest whichever end is
  // physically LOWER even further down sends it PAST that endpoint —
  // the curve has to loop back on itself to reach it (confirmed live:
  // the billowed SOURCES-bus-to-module-jack cables in the Patch Bay drew
  // a visible hook well past their true jack, reading as "doesn't line
  // up with the input"). Blend each control point's sag toward "lean
  // inward, toward the other endpoint" as the cable gets more vertical;
  // a level cable (verticalness 0) keeps the original, unchanged shape.
  const verticalness = dist > 0 ? Math.abs(dy) / dist : 0;
  const dySign = dy === 0 ? 1 : Math.sign(dy);
  const c1Sag = sag * (1 - verticalness * (1 - dySign));
  const c2Sag = sag * (1 - verticalness * (1 + dySign));
  return [{ x: a.x + bow, y: a.y + c1Sag }, { x: b.x + bow, y: b.y + c2Sag }];
}

export interface CableDrawOpts {
  highlight?: boolean;
  /** Click-selected cable (Patch Bay: distinct from the drag rubber-band's
   *  `highlight` — a resting cable a user has clicked on to trace it). */
  selected?: boolean;
  /** Idle mouse-hover over a resting cable (no drag, no click) — subtler
   *  than `selected`. */
  hovered?: boolean;
  style?: CableStyle;
  /** Animated dash phase; pass undefined (or reduceMotion) for solid/static. */
  dashOffset?: number;
  /** Draw dashed even when static (CableLayer's reduced-motion look is solid). */
  dashed?: boolean;
  /** Extra alpha dim for disabled routings (rack: muted slot). */
  dim?: boolean;
  /**
   * Fade the stroke toward this color at the `b` end (a linear gradient
   * along the cable, `color` at `a` -> `gradientEnd` at `b`) — the
   * in-progress drag rubber-band uses this to show, right on the cable
   * itself, whether wherever the cursor currently is would accept the
   * drop (fades toward an "accept" tint) or not (fades toward a
   * "reject" tint), layered on top of the jack's own hover highlight
   * rather than replacing it.
   */
  gradientEnd?: string;
}

/**
 * Approximate min distance from `point` to the cable curve `a`->`b`
 * (given `style`), for click/hover hit-testing. Sampled along the cubic
 * bezier at a fixed step count — plenty of precision for a mouse-click
 * tolerance check, not a physics-grade nearest-point solve.
 */
export function distanceToCable(point: CablePoint, a: CablePoint, b: CablePoint, style: CableStyle): number {
  const [c1, c2] = cableControlPoints(a, b, style);
  const STEPS = 20;
  let prev = a;
  let min = Infinity;
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const mt = 1 - t;
    const x = mt * mt * mt * a.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * b.x;
    const y = mt * mt * mt * a.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * b.y;
    const cur = { x, y };
    const d = distanceToSegment(point, prev, cur);
    if (d < min) min = d;
    prev = cur;
  }
  return min;
}

function distanceToSegment(p: CablePoint, a: CablePoint, b: CablePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

export function drawPatchCable(
  ctx: CanvasRenderingContext2D,
  a: CablePoint,
  b: CablePoint,
  color: string,
  opts: CableDrawOpts = {},
): void {
  const [c1, c2] = cableControlPoints(a, b, opts.style ?? 'flow');
  ctx.save();
  if (opts.dim) ctx.globalAlpha = 0.35;
  ctx.lineCap = 'round';
  if (opts.dashed) {
    ctx.setLineDash([10, 6]);
    ctx.lineDashOffset = -(opts.dashOffset ?? 0);
  } else {
    ctx.setLineDash([]);
  }
  const tracePath = (): void => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
  };
  // A selected cable gets a bright outline pass UNDER the color stroke —
  // same color/width recipe as `highlight` (the drag rubber-band) would
  // look otherwise identical to a merely-hovered cable, so `selected`
  // needs a shape cue independent of glow color, not just a bigger glow.
  if (opts.selected) {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.lineWidth = 5;
    tracePath();
    ctx.stroke();
  }
  // Gradient along the cable toward `gradientEnd` (the drag rubber-
  // band's accept/reject tint) — the glow (`shadowColor`) stays the
  // solid base `color` since a gradient shadow reads muddy at this
  // size; only the stroke itself fades.
  if (opts.gradientEnd) {
    const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    grad.addColorStop(0, color);
    grad.addColorStop(1, opts.gradientEnd);
    ctx.strokeStyle = grad;
  } else {
    ctx.strokeStyle = color;
  }
  ctx.shadowColor = color;
  ctx.shadowBlur = opts.highlight ? 14 : opts.selected ? 12 : opts.hovered ? 9 : 6;
  ctx.lineWidth = opts.highlight ? 3 : opts.selected ? 3 : opts.hovered ? 2.5 : 2;
  tracePath();
  ctx.stroke();
  // Physical cables get plug dots so start/end points read at a glance
  // even where several cables overlap (owner feedback on the bay's
  // left rail). Editor-flow cables keep bare ends (ports draw their own
  // dots).
  if ((opts.style ?? 'flow') === 'sag') {
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
