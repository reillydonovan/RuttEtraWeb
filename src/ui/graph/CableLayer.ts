/**
 * CableLayer — single canvas-2d layer that renders all cables in the
 * graph editor as bezier curves between port anchors. Re-drawn whenever
 * the graph changes or the host element is resized; nodes drag is
 * separate (DOM-positioned) and triggers a re-draw via `requestRedraw`.
 *
 * Color coding by port kind:
 *   audio / envelope   amber  #ffb347
 *   video              cyan   #5fffd0
 *   gate / trigger     green  #5fff85
 *   control (default)  white
 *
 * Animated dash flow on signal-carrying cables is gated on
 * `prefers-reduced-motion`.
 */

import { GraphPatch, splitInputRef } from '../../modulation/graph/types';
import { getDef } from '../../modulation/graph/registry';

export interface CableAnchorResolver {
  /** Returns canvas-relative {x,y} for a node's input port, or null if unknown. */
  inputAnchor(nodeId: string, port: string): { x: number; y: number } | null;
  /** Returns canvas-relative {x,y} for a node's output port, or null. */
  outputAnchor(nodeId: string, port: string): { x: number; y: number } | null;
}

export interface CableLayer {
  el: HTMLCanvasElement;
  resize(width: number, height: number): void;
  draw(patch: GraphPatch, resolver: CableAnchorResolver, opts?: { highlightCable?: { from: string; fromPort: string; to: string; toPort: string } | null }): void;
  start(): void;
  stop(): void;
  /** Schedule a redraw on the next frame using the latest patch + resolver. */
  requestRedraw(patch: GraphPatch, resolver: CableAnchorResolver): void;
  /**
   * v25: rubber-band cable while a connection is in progress. `from` is
   * the source port anchor; `to` follows the cursor (both canvas-relative).
   * Pass null to clear.
   */
  setPending(p: { from: { x: number; y: number }; to: { x: number; y: number }; color?: string } | null): void;
}

const PORT_COLORS: Record<string, string> = {
  audio:   '#ffb347',
  video:   '#5fffd0',
  gate:    '#5fff85',
  trigger: '#5fff85',
  control: '#ffffff',
};

export function createCableLayer(): CableLayer {
  const el = document.createElement('canvas');
  el.className = 'rw-graph-cable-layer';
  const ctx = el.getContext('2d')!;
  let raf = 0;
  let lastPatch: GraphPatch | null = null;
  let lastResolver: CableAnchorResolver | null = null;
  let highlight: { from: string; fromPort: string; to: string; toPort: string } | null = null;

  let dpr = 1;
  let widthCss = 0, heightCss = 0;
  let dashOffset = 0;
  let lastTime = 0;
  let running = false;
  let pending: { from: { x: number; y: number }; to: { x: number; y: number }; color?: string } | null = null;

  const reduceMotion = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  function resize(w: number, h: number): void {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    widthCss = w; heightCss = h;
    el.width  = Math.max(1, Math.floor(w * dpr));
    el.height = Math.max(1, Math.floor(h * dpr));
    el.style.width  = w + 'px';
    el.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (lastPatch && lastResolver) draw(lastPatch, lastResolver);
  }

  function draw(patch: GraphPatch, resolver: CableAnchorResolver, opts?: { highlightCable?: typeof highlight }): void {
    lastPatch = patch;
    lastResolver = resolver;
    if (opts && opts.highlightCable !== undefined) highlight = opts.highlightCable ?? null;
    ctx.clearRect(0, 0, widthCss, heightCss);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    for (const node of patch.nodes) {
      const def = getDef(node.type);
      if (!def) continue;
      for (const [toPort, ref] of Object.entries(node.inputs)) {
        if (!ref) continue;
        // v25: refs may name a specific output port (`nodeId#port`).
        const { nodeId: fromId, port: refPort } = splitInputRef(ref);
        const fromNode = patch.nodes.find((n) => n.id === fromId);
        if (!fromNode) continue;
        const fromDef = getDef(fromNode.type);
        if (!fromDef) continue;
        const fromPortSpec = refPort
          ? fromDef.outputs.find((o) => o.name === refPort) ?? fromDef.outputs[0]
          : fromDef.outputs[0];
        const fromPort = fromPortSpec?.name ?? 'out';
        const a = resolver.outputAnchor(fromId, fromPort);
        const b = resolver.inputAnchor(node.id, toPort);
        if (!a || !b) continue;
        const portKind = fromPortSpec?.kind ?? 'control';
        const color = PORT_COLORS[portKind] ?? PORT_COLORS.control;
        const isHi = highlight
          && highlight.from === fromId && highlight.fromPort === fromPort
          && highlight.to === node.id && highlight.toPort === toPort;
        drawCable(a, b, color, !!isHi);
      }
    }

    // v25: rubber-band cable for the in-progress connection.
    if (pending) {
      drawCable(pending.from, pending.to, pending.color ?? PORT_COLORS.control, true);
    }
  }

  function drawCable(a: {x:number;y:number}, b: {x:number;y:number}, color: string, highlight: boolean): void {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = highlight ? 14 : 6;
    ctx.lineWidth = highlight ? 3 : 2;
    if (!reduceMotion) {
      ctx.setLineDash([10, 6]);
      ctx.lineDashOffset = -dashOffset;
    } else {
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.bezierCurveTo(a.x + dx, a.y, b.x - dx, b.y, b.x, b.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);
  }

  function start(): void {
    if (running) return;
    running = true;
    lastTime = performance.now();
    const tick = (t: number): void => {
      if (!running) return;
      const dt = (t - lastTime) / 1000;
      lastTime = t;
      if (!reduceMotion) {
        dashOffset += dt * 24;
        if (lastPatch && lastResolver) draw(lastPatch, lastResolver);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function stop(): void {
    running = false;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  function requestRedraw(patch: GraphPatch, resolver: CableAnchorResolver): void {
    lastPatch = patch;
    lastResolver = resolver;
    if (!running) draw(patch, resolver);
  }

  function setPending(p: typeof pending): void {
    pending = p;
    // Redraw immediately so the rubber-band tracks the cursor even when
    // the animation loop is idle (prefers-reduced-motion).
    if (lastPatch && lastResolver) draw(lastPatch, lastResolver);
  }

  return { el, resize, draw, start, stop, requestRedraw, setPending };
}
