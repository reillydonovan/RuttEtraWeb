/**
 * Probe — small overlay oscilloscope that polls `engine.probe(nodeId,
 * port)` once per frame and draws the rolling values. Closes on click
 * outside.
 *
 * Used by both the toolbar Probe button (which then expects the user to
 * click any cable) and the inspector's per-port Probe shortcut.
 */

import type { GraphEngine } from '../../modulation/graph/GraphEngine';

export interface ProbeOptions {
  engine: GraphEngine;
  nodeId: string;
  port: string;
  windowSec?: number;
  onClose?(): void;
}

export interface ProbeHandle {
  el: HTMLElement;
  close(): void;
}

export function openProbeOverlay(host: HTMLElement, opts: ProbeOptions): ProbeHandle {
  const reduceMotion = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
  const windowSec = opts.windowSec ?? 5;

  const overlay = document.createElement('div');
  overlay.className = 'rw-graph-probe';

  const title = document.createElement('div');
  title.className = 'rw-graph-probe-title';
  title.textContent = `Probe ${opts.nodeId}.${opts.port}`;
  overlay.appendChild(title);

  const valueLabel = document.createElement('div');
  valueLabel.className = 'rw-graph-probe-value';
  overlay.appendChild(valueLabel);

  const canvas = document.createElement('canvas');
  canvas.className = 'rw-graph-probe-canvas';
  canvas.width = 240; canvas.height = 80;
  const ctx = canvas.getContext('2d')!;
  overlay.appendChild(canvas);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'rw-btn rw-graph-probe-close rw-x';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', close);
  overlay.appendChild(closeBtn);

  host.appendChild(overlay);

  const samples: { t: number; v: number }[] = [];
  let raf = 0;
  let running = true;

  const onClick = (e: MouseEvent): void => {
    if (!overlay.contains(e.target as Node)) close();
  };
  // host.ownerDocument: dismiss-on-outside-click works in the popout too.
  setTimeout(() => host.ownerDocument.addEventListener('mousedown', onClick), 0);

  function tick(): void {
    if (!running) return;
    const v = opts.engine.probe(opts.nodeId, opts.port);
    samples.push({ t: performance.now() / 1000, v });
    const cutoff = performance.now() / 1000 - windowSec;
    while (samples.length > 0 && samples[0].t < cutoff) samples.shift();
    valueLabel.textContent = v.toFixed(3);
    drawScope();
    if (!reduceMotion) raf = requestAnimationFrame(tick);
    else raf = window.setTimeout(tick, 100) as unknown as number;
  }
  tick();

  function drawScope(): void {
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, w, h);
    if (samples.length < 2) return;
    let minV = Infinity, maxV = -Infinity;
    for (const s of samples) { minV = Math.min(minV, s.v); maxV = Math.max(maxV, s.v); }
    if (minV === maxV) { minV -= 0.5; maxV += 0.5; }
    // Symmetric around 0 if the signal is bipolar.
    if (minV < 0 && maxV > 0) {
      const m = Math.max(-minV, maxV);
      minV = -m; maxV = m;
    }
    const padded = (maxV - minV) * 1.2 || 1;
    const offset = (minV + maxV) / 2;
    // Zero line.
    ctx.strokeStyle = 'rgba(95,255,133,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5 + ((0 - offset) / padded) * h);
    ctx.lineTo(w, h * 0.5 + ((0 - offset) / padded) * h);
    ctx.stroke();
    // Trace.
    ctx.strokeStyle = '#5fff85';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const t0 = samples[samples.length - 1].t - windowSec;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const x = ((s.t - t0) / windowSec) * w;
      const y = h * 0.5 - ((s.v - offset) / padded) * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function close(): void {
    if (!running) return;
    running = false;
    if (typeof raf === 'number') {
      cancelAnimationFrame(raf);
      clearTimeout(raf as unknown as number);
    }
    host.ownerDocument.removeEventListener('mousedown', onClick);
    overlay.remove();
    opts.onClose?.();
  }

  return { el: overlay, close };
}
