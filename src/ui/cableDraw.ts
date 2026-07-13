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
  const dist = Math.hypot(dx, b.y - a.y);
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
  return [{ x: a.x + bow, y: a.y + sag }, { x: b.x + bow, y: b.y + sag }];
}

export interface CableDrawOpts {
  highlight?: boolean;
  style?: CableStyle;
  /** Animated dash phase; pass undefined (or reduceMotion) for solid/static. */
  dashOffset?: number;
  /** Draw dashed even when static (CableLayer's reduced-motion look is solid). */
  dashed?: boolean;
  /** Extra alpha dim for disabled routings (rack: muted slot). */
  dim?: boolean;
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
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = opts.highlight ? 14 : 6;
  ctx.lineWidth = opts.highlight ? 3 : 2;
  ctx.lineCap = 'round';
  if (opts.dashed) {
    ctx.setLineDash([10, 6]);
    ctx.lineDashOffset = -(opts.dashOffset ?? 0);
  } else {
    ctx.setLineDash([]);
  }
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
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
