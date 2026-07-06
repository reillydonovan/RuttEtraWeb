/**
 * Inline region picker for the inspector — a thumbnail of the current
 * input video frame with a draggable rectangle that maps directly to
 * the `rx, ry, rw, rh` params on a `video-*` node.
 *
 * The thumbnail is sourced from `VideoTap.getThumbnail()` (the shared
 * 64×64 readback). When no VideoTap has been constructed yet we render
 * a neutral placeholder so the inspector still lays out cleanly.
 */

import { GraphNode } from '../../modulation/graph/types';
import type { VideoTap } from '../../modulation/graph/VideoTap';

const THUMB_SIZE = 96;

export interface RegionPickerOptions {
  node: GraphNode;
  videoTap: VideoTap | null;
  onChange(rect: { rx: number; ry: number; rw: number; rh: number }): void;
}

export function createRegionPicker(opts: RegionPickerOptions): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'rw-graph-region-picker';

  const canvas = document.createElement('canvas');
  canvas.width = THUMB_SIZE;
  canvas.height = THUMB_SIZE;
  canvas.className = 'rw-graph-region-canvas';
  wrap.appendChild(canvas);

  const ctx = canvas.getContext('2d')!;

  let rect = {
    rx: numParam(opts.node.params.rx, 0),
    ry: numParam(opts.node.params.ry, 0),
    rw: numParam(opts.node.params.rw, 1),
    rh: numParam(opts.node.params.rh, 1),
  };

  let dragging: 'move' | 'resize' | null = null;
  let dragStart = { mx: 0, my: 0, rx: 0, ry: 0, rw: 0, rh: 0 };

  function draw(): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);
    const t = opts.videoTap?.getThumbnail();
    if (t) {
      // Scale the 64x64 readback up to the thumbnail size.
      const tmp = ctx.createImageData(t.size, t.size);
      tmp.data.set(t.data);
      const off = document.createElement('canvas');
      off.width = t.size; off.height = t.size;
      off.getContext('2d')!.putImageData(tmp, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, THUMB_SIZE, THUMB_SIZE);
    }
    ctx.strokeStyle = 'rgba(95,255,133,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      rect.rx * THUMB_SIZE + 0.5,
      rect.ry * THUMB_SIZE + 0.5,
      rect.rw * THUMB_SIZE - 1,
      rect.rh * THUMB_SIZE - 1,
    );
    // Resize handle bottom-right.
    ctx.fillStyle = 'rgba(95,255,133,0.95)';
    ctx.fillRect(
      (rect.rx + rect.rw) * THUMB_SIZE - 4,
      (rect.ry + rect.rh) * THUMB_SIZE - 4,
      4, 4,
    );
  }

  function localXY(e: MouseEvent): { x: number; y: number } {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
    };
  }

  canvas.addEventListener('mousedown', (e) => {
    const { x, y } = localXY(e);
    const onRight  = x > rect.rx + rect.rw - 0.06;
    const onBottom = y > rect.ry + rect.rh - 0.06;
    dragging = (onRight && onBottom) ? 'resize' : 'move';
    dragStart = { mx: x, my: y, ...rect };
    e.preventDefault();
    // ownerDocument: keeps drag alive inside the popout window.
    const doc = canvas.ownerDocument;
    const cleanup = (): void => {
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', endDrag);
    };
    const endDrag = (): void => { onUp(); cleanup(); };
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', endDrag);
  });

  function onMove(e: MouseEvent): void {
    if (!dragging) return;
    const { x, y } = localXY(e);
    if (dragging === 'move') {
      rect = {
        rx: clamp01(dragStart.rx + (x - dragStart.mx)),
        ry: clamp01(dragStart.ry + (y - dragStart.my)),
        rw: dragStart.rw, rh: dragStart.rh,
      };
      // Keep inside [0,1].
      rect.rx = Math.min(rect.rx, 1 - rect.rw);
      rect.ry = Math.min(rect.ry, 1 - rect.rh);
    } else {
      rect = {
        rx: dragStart.rx, ry: dragStart.ry,
        rw: clamp(0.05, 1 - dragStart.rx, dragStart.rw + (x - dragStart.mx)),
        rh: clamp(0.05, 1 - dragStart.ry, dragStart.rh + (y - dragStart.my)),
      };
    }
    draw();
    opts.onChange(rect);
  }

  function onUp(): void {
    dragging = null;
  }

  // Lightweight refresh to pick up new video frames in the thumbnail.
  let raf = 0;
  function tick(): void {
    draw();
    raf = requestAnimationFrame(tick);
  }
  tick();

  // Clean up on detach.
  const obs = new MutationObserver(() => {
    if (!document.contains(wrap)) {
      cancelAnimationFrame(raf);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  return wrap;
}

function numParam(v: unknown, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}
function clamp(lo: number, hi: number, v: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function clamp01(v: number): number { return clamp(0, 1, v); }
