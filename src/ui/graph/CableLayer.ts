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
import { drawPatchCable, fitCableCanvas, distanceToCable } from '../cableDraw';

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
  setPending(p: { from: { x: number; y: number }; to: { x: number; y: number }; color?: string; accept?: boolean | null } | null): void;
  /** Id (`<toNodeId>#<toPort>`) of the cable under (x, y) (canvas-relative), or null. */
  hitTest(p: { x: number; y: number }, tolerance?: number): string | null;
  /** The cable's last-drawn endpoints and colour, for unplug ghosts. */
  edge(id: string): { a: { x: number; y: number }; b: { x: number; y: number }; color: string } | null;
  setSelected(id: string | null): void;
  setHovered(id: string | null): void;
  /** Hide one cable while its input end is being re-grabbed (the rubber-band replaces it). */
  setHidden(id: string | null): void;
  /** Leave a fading, falling cable where one was just unplugged. */
  addGhost(g: { a: { x: number; y: number }; b: { x: number; y: number }; color: string }): void;
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
  let pending: { from: { x: number; y: number }; to: { x: number; y: number }; color?: string; accept?: boolean | null } | null = null;
  let selectedEdge: string | null = null;
  let hoveredEdge: string | null = null;
  let hiddenEdge: string | null = null;
  let edges: Array<{ id: string; a: { x: number; y: number }; b: { x: number; y: number }; color: string }> = [];
  const ghosts: Array<{ a: { x: number; y: number }; b: { x: number; y: number }; color: string; t0: number }> = [];
  const GHOST_MS = 520;

  const reduceMotion = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  function resize(w: number, h: number): void {
    // Zoom-aware sizing (Global Text Size): w/h arrive as VISUAL pixels
    // (the host's getBoundingClientRect), and anchors from the resolver
    // are visual too — fitCableCanvas keeps the canvas's on-screen size
    // equal to the host so the two spaces coincide. See its docs.
    const size = fitCableCanvas(el, ctx, { width: w, height: h });
    widthCss = size.w; heightCss = size.h;
    if (lastPatch && lastResolver) draw(lastPatch, lastResolver);
  }

  function draw(patch: GraphPatch, resolver: CableAnchorResolver, opts?: { highlightCable?: typeof highlight }): void {
    lastPatch = patch;
    lastResolver = resolver;
    if (opts && opts.highlightCable !== undefined) highlight = opts.highlightCable ?? null;
    ctx.clearRect(0, 0, widthCss, heightCss);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    edges = [];

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
        const id = `${node.id}#${toPort}`;
        if (id === hiddenEdge) continue;     // being re-grabbed: the rubber-band stands in for it
        edges.push({ id, a, b, color });
        drawCable(a, b, color, !!isHi, id === selectedEdge, id === hoveredEdge);
      }
    }

    // v25: rubber-band cable for the in-progress connection.
    if (pending) {
      // The end fades toward white while it is over something that will take the cable, red while
      // it is over empty space or a jack that won't (the Patch Bay's accept/reject language).
      drawPatchCable(ctx, pending.from, pending.to, pending.color ?? PORT_COLORS.control, {
        style: 'flow', highlight: true, dashed: !reduceMotion, dashOffset,
        ...(pending.accept === undefined ? {} : { gradientEnd: pending.accept ? '#ffffff' : '#ff5566' }),
      });
    }

    // Unplug ghosts: a cable you just let go of stays attached to its source, falls and fades.
    if (ghosts.length) {
      const now = performance.now();
      for (let i = ghosts.length - 1; i >= 0; i--) {
        const g = ghosts[i];
        const age = now - g.t0;
        if (age >= GHOST_MS) { ghosts.splice(i, 1); continue; }
        const k = age / GHOST_MS;
        const fall = reduceMotion ? 0 : 38 * k * k;
        ctx.save();
        ctx.globalAlpha = 1 - k;
        drawPatchCable(ctx, g.a, { x: g.b.x, y: g.b.y + fall }, g.color, { style: 'flow', dashed: false });
        if (!reduceMotion) {
          ctx.globalAlpha = (1 - k) * 0.8;
          ctx.strokeStyle = g.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(g.b.x, g.b.y, 6 + 22 * k, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  function drawCable(a: {x:number;y:number}, b: {x:number;y:number}, color: string, highlight: boolean, selected = false, hovered = false): void {
    // Shared recipe with the rack skin's cable layer (ui/cableDraw.ts).
    drawPatchCable(ctx, a, b, color, {
      style: 'flow',
      highlight,
      selected,
      hovered,
      dashed: !reduceMotion,
      dashOffset,
    });
  }

  function start(): void {
    if (running) return;
    running = true;
    lastTime = performance.now();
    const tick = (t: number): void => {
      if (!running) return;
      const dt = (t - lastTime) / 1000;
      lastTime = t;
      if (!reduceMotion) dashOffset += dt * 24;
      if ((!reduceMotion || ghosts.length) && lastPatch && lastResolver) draw(lastPatch, lastResolver);
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

  function redraw(): void { if (lastPatch && lastResolver) draw(lastPatch, lastResolver); }
  function hitTest(p: { x: number; y: number }, tolerance = 9): string | null {
    let best: string | null = null;
    let bestD = tolerance;
    for (const e of edges) {
      const d = distanceToCable(p, e.a, e.b, 'flow');
      if (d < bestD) { bestD = d; best = e.id; }
    }
    return best;
  }
  function edge(id: string): { a: { x: number; y: number }; b: { x: number; y: number }; color: string } | null {
    const e = edges.find((x) => x.id === id);
    return e ? { a: e.a, b: e.b, color: e.color } : null;
  }
  return {
    el, resize, draw, start, stop, requestRedraw, setPending, hitTest, edge,
    setSelected(id) { if (id !== selectedEdge) { selectedEdge = id; redraw(); } },
    setHovered(id) { if (id !== hoveredEdge) { hoveredEdge = id; redraw(); } },
    setHidden(id) { if (id !== hiddenEdge) { hiddenEdge = id; redraw(); } },
    addGhost(g) { ghosts.push({ ...g, t0: performance.now() }); redraw(); },
  };
}
