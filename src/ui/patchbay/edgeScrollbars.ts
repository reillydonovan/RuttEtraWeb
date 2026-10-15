/**
 * Hover-revealed scroll rails for the Patch Bay (owner ask, 2026-09-30:
 * "when hovering over the right edge of the patch view window the
 * scrollview controller should appear and the cursor should change").
 *
 * The bay's native scrollbars are hidden (macOS overlay scrollbars only
 * appear WHILE scrolling, can't be styled, and showed the board's pan
 * hand). These rails sit on the right and bottom edges of the scroller,
 * fade in when the pointer comes within `REVEAL_PX` of that edge, while
 * scrolling, or while dragging, and fade out after `HIDE_MS` idle.
 * The thumb drags (grab/grabbing cursor); clicking the track pages.
 *
 * The rails are children of the scroller, repositioned by its scroll
 * offset so they stay pinned to the visible edge.
 */

import '../edgeScrollRails.css';

export const REVEAL_PX = 22;
const HIDE_MS = 900;
const RAIL = 10;
/** Gap between rail and window edge — keeps the window's own resize
 *  handle (which overlaps the edge by ~4 px) grabbable (owner report). */
const EDGE_GAP = 6;
const MIN_THUMB = 28;

/** Thumb size + offset for one axis, or null when nothing scrolls. Pure. */
export function thumbGeometry(
  client: number, scroll: number, pos: number, track: number, minThumb = MIN_THUMB,
): { size: number; offset: number } | null {
  if (!(scroll > client + 1) || track <= 0) return null;
  const size = Math.min(track, Math.max(minThumb, (client / scroll) * track));
  const maxPos = scroll - client;
  const offset = maxPos > 0 ? (Math.min(Math.max(pos, 0), maxPos) / maxPos) * (track - size) : 0;
  return { size, offset };
}

/** Scroll position for a thumb dragged to `offset` along the track. Pure. */
export function scrollForThumb(offset: number, size: number, track: number, client: number, scroll: number): number {
  const room = track - size;
  if (room <= 0) return 0;
  return (Math.min(Math.max(offset, 0), room) / room) * (scroll - client);
}

export interface EdgeScrollbars {
  /** Re-sync rail position/visibility (call on scroll/resize/zoom; cheap). */
  update(): void;
}

export function attachEdgeScrollbars(scroller: HTMLElement): EdgeScrollbars {
  const doc = scroller.ownerDocument;
  scroller.classList.add('rw-edge-scroller');
  const mk = (axis: 'v' | 'h'): { rail: HTMLElement; thumb: HTMLElement } => {
    const rail = doc.createElement('div');
    rail.className = `rw-pb-scrollbar rw-pb-scrollbar--${axis}`;
    const thumb = doc.createElement('div');
    thumb.className = 'rw-pb-scrollbar-thumb';
    rail.appendChild(thumb);
    scroller.appendChild(rail);
    return { rail, thumb };
  };
  const v = mk('v');
  const h = mk('h');

  let near = { v: false, h: false };
  let dragging: 'v' | 'h' | null = null;
  let hideTimer = 0;

  const show = (axis: 'v' | 'h', on: boolean): void => {
    (axis === 'v' ? v : h).rail.classList.toggle('rw-pb-scrollbar--on', on);
  };
  const refreshVisibility = (): void => {
    show('v', near.v || dragging === 'v');
    show('h', near.h || dragging === 'h');
  };
  const flash = (): void => {
    show('v', true); show('h', true);
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(refreshVisibility, HIDE_MS);
  };

  const update = (): void => {
    const cw = scroller.clientWidth, ch = scroller.clientHeight;
    const sl = scroller.scrollLeft, st = scroller.scrollTop;
    const OFF = RAIL + EDGE_GAP;
    const gv = thumbGeometry(ch, scroller.scrollHeight, st, ch - OFF);
    const gh = thumbGeometry(cw, scroller.scrollWidth, sl, cw - OFF);
    v.rail.style.display = gv ? '' : 'none';
    h.rail.style.display = gh ? '' : 'none';
    if (gv) {
      v.rail.style.transform = `translate(${sl + cw - OFF}px, ${st}px)`;
      v.rail.style.height = `${ch - OFF}px`;
      v.thumb.style.height = `${gv.size}px`;
      v.thumb.style.transform = `translateY(${gv.offset}px)`;
    }
    if (gh) {
      h.rail.style.transform = `translate(${sl}px, ${st + ch - OFF}px)`;
      h.rail.style.width = `${cw - OFF}px`;
      h.thumb.style.width = `${gh.size}px`;
      h.thumb.style.transform = `translateX(${gh.offset}px)`;
    }
  };

  // Reveal when the pointer nears the right / bottom edge.
  scroller.addEventListener('pointermove', (e) => {
    if (dragging) return;
    const r = scroller.getBoundingClientRect();
    const k = r.width / (scroller.offsetWidth || r.width); // text-scale zoom
    near = {
      v: r.right - e.clientX <= REVEAL_PX * k && e.clientY >= r.top,
      h: r.bottom - e.clientY <= REVEAL_PX * k && e.clientX >= r.left,
    };
    refreshVisibility();
  });
  scroller.addEventListener('pointerleave', () => { if (!dragging) { near = { v: false, h: false }; refreshVisibility(); } });
  scroller.addEventListener('scroll', () => { update(); flash(); }, { passive: true });

  const bindAxis = (axis: 'v' | 'h', parts: { rail: HTMLElement; thumb: HTMLElement }): void => {
    const isV = axis === 'v';
    // Drag the thumb.
    parts.thumb.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      dragging = axis;
      parts.rail.classList.add('rw-pb-scrollbar--drag');
      const r = parts.rail.getBoundingClientRect();
      const k = (isV ? r.height / (parts.rail.offsetHeight || r.height) : r.width / (parts.rail.offsetWidth || r.width)) || 1;
      const start = isV ? e.clientY : e.clientX;
      const client = isV ? scroller.clientHeight : scroller.clientWidth;
      const total = isV ? scroller.scrollHeight : scroller.scrollWidth;
      const track = client - RAIL - EDGE_GAP;
      const g = thumbGeometry(client, total, isV ? scroller.scrollTop : scroller.scrollLeft, track);
      if (!g) { dragging = null; return; }
      const startOffset = g.offset;
      const move = (ev: PointerEvent): void => {
        const d = ((isV ? ev.clientY : ev.clientX) - start) / k;
        const next = scrollForThumb(startOffset + d, g.size, track, client, total);
        if (isV) scroller.scrollTop = next; else scroller.scrollLeft = next;
      };
      const up = (): void => {
        dragging = null;
        parts.rail.classList.remove('rw-pb-scrollbar--drag');
        doc.removeEventListener('pointermove', move);
        doc.removeEventListener('pointerup', up);
        doc.removeEventListener('pointercancel', up);
        refreshVisibility();
      };
      doc.addEventListener('pointermove', move);
      doc.addEventListener('pointerup', up);
      doc.addEventListener('pointercancel', up);
    });
    // Click the track: page toward the click.
    parts.rail.addEventListener('pointerdown', (e) => {
      if (e.target !== parts.rail || e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const tr = parts.thumb.getBoundingClientRect();
      const before = isV ? e.clientY < tr.top : e.clientX < tr.left;
      const page = (isV ? scroller.clientHeight : scroller.clientWidth) * 0.9;
      scroller.scrollBy({ [isV ? 'top' : 'left']: before ? -page : page, behavior: 'smooth' });
    });
  };
  bindAxis('v', v);
  bindAxis('h', h);

  update();
  return { update };
}
