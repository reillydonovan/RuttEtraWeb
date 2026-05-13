/**
 * Gesture-driven bottom sheet primitive.
 *
 * Uses native CSS scroll-snap (NOT a JS gesture lib): the scroll container
 * has three snap stops (30%, 60%, 90% of viewport height) plus a "below
 * viewport" anchor that triggers dismiss. Browsers handle inertia and
 * snap-back natively.
 *
 * Layout sketch:
 *
 *   #sheet-host (fixed, full-screen, scroll-y, scroll-snap-type: y mandatory)
 *     .sheet-spacer-30  (30vh tall — first snap, dismiss target)
 *     .sheet-spacer-60  (30vh tall — second snap)
 *     .sheet-body       (90dvh tall — pinned content panel)
 *
 * Initial scrollTop lands on .sheet-body (snap 90%); user pulls down to expose
 * the spacers and snap to 60% / 30%. Pulling past 30% with momentum lands on
 * the dismiss area and `dismiss()` fires.
 *
 * Honors `prefers-reduced-motion` by setting `scroll-behavior: auto`.
 */

import { layoutManager } from './LayoutManager';

export type SnapPoint = '30' | '60' | '90';

export interface BottomSheetOptions {
  /** Sheet title (rendered in the drag-handle bar). */
  title?: string;
  /** Snap point to open at. Defaults to '60'. */
  initialSnap?: SnapPoint;
  /** Called when user dismisses (pull-down past 30% threshold or tap backdrop). */
  onDismiss?: () => void;
  /** Called every time the sheet snaps to a new point (debounced). */
  onSnapChange?: (snap: SnapPoint) => void;
}

export class BottomSheet {
  private host: HTMLDivElement;
  private backdrop: HTMLDivElement;
  private scroller: HTMLDivElement;
  private body: HTMLDivElement;
  private bodyContent: HTMLDivElement;
  private spacers: { '30': HTMLDivElement; '60': HTMLDivElement };
  private opts: BottomSheetOptions;
  private dismissed = false;
  private snapDebounce: number | null = null;
  private currentSnap: SnapPoint;

  constructor(opts: BottomSheetOptions = {}) {
    this.opts = opts;
    this.currentSnap = opts.initialSnap ?? '60';

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'rw-sheet-backdrop';
    this.backdrop.addEventListener('click', () => this.dismiss());

    this.host = document.createElement('div');
    this.host.className = 'rw-sheet-host';
    this.host.setAttribute('role', 'dialog');
    this.host.setAttribute('aria-modal', 'true');

    this.scroller = document.createElement('div');
    this.scroller.className = 'rw-sheet-scroller';
    if (layoutManager().prefersReducedMotion) {
      this.scroller.style.scrollBehavior = 'auto';
    }

    // Spacers — pulled down past these snaps the sheet smaller.
    this.spacers = {
      '30': makeSpacer('rw-sheet-spacer rw-sheet-spacer-30'),
      '60': makeSpacer('rw-sheet-spacer rw-sheet-spacer-60'),
    };

    // Body panel — actual content lives here.
    this.body = document.createElement('div');
    this.body.className = 'rw-sheet-body';

    const handle = document.createElement('div');
    handle.className = 'rw-sheet-handle';
    const grip = document.createElement('div'); grip.className = 'rw-sheet-grip'; handle.appendChild(grip);
    if (opts.title) {
      const title = document.createElement('div');
      title.className = 'rw-sheet-title';
      title.textContent = opts.title;
      handle.appendChild(title);
    }
    const closeBtn = document.createElement('button');
    closeBtn.className = 'rw-sheet-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => this.dismiss());
    handle.appendChild(closeBtn);

    this.bodyContent = document.createElement('div');
    this.bodyContent.className = 'rw-sheet-body-content';

    this.body.append(handle, this.bodyContent);

    this.scroller.append(this.spacers['30'], this.spacers['60'], this.body);
    this.host.append(this.scroller);

    this.scroller.addEventListener('scroll', this.onScroll);

    // Keyboard close (Escape).
    this.host.tabIndex = -1;
    this.host.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') this.dismiss();
    });
  }

  /** Mount sheet at end of <body> and animate to initial snap. */
  open(content: HTMLElement): void {
    if (this.dismissed) return;
    this.bodyContent.innerHTML = '';
    this.bodyContent.appendChild(content);
    document.body.appendChild(this.backdrop);
    document.body.appendChild(this.host);
    // Trigger reflow so the snap-scroll lands correctly.
    requestAnimationFrame(() => {
      this.snapTo(this.currentSnap);
      this.host.focus();
      this.backdrop.classList.add('open');
      this.host.classList.add('open');
    });
  }

  setContent(content: HTMLElement): void {
    this.bodyContent.innerHTML = '';
    this.bodyContent.appendChild(content);
  }

  /** Programmatically snap to a height. */
  snapTo(point: SnapPoint): void {
    const target = this.scrollTopForSnap(point);
    this.scroller.scrollTo({ top: target, behavior: layoutManager().prefersReducedMotion ? 'auto' : 'smooth' });
    this.currentSnap = point;
  }

  /** Close + remove from DOM. */
  dismiss(): void {
    if (this.dismissed) return;
    this.dismissed = true;
    this.backdrop.classList.remove('open');
    this.host.classList.remove('open');
    const cleanup = () => {
      this.backdrop.remove();
      this.host.remove();
    };
    if (layoutManager().prefersReducedMotion) cleanup();
    else setTimeout(cleanup, 220);
    this.opts.onDismiss?.();
  }

  // --------------------------------------------------------- internals

  /** scrollTop value such that .sheet-body's top edge aligns to the chosen snap. */
  private scrollTopForSnap(point: SnapPoint): number {
    // Spacers occupy 70vh in total (40vh + 30vh in CSS). Body is pinned below
    // the spacers. Scrolling to top exposes both spacers (30% snap), to mid
    // exposes only the second (60% snap), to bottom hides them (90% snap).
    const vp = window.innerHeight;
    if (point === '30') return 0;
    if (point === '60') return Math.round(0.40 * vp);   // hides first spacer
    return Math.round(0.70 * vp);                        // hides both spacers (90%)
  }

  private onScroll = (): void => {
    if (this.snapDebounce != null) clearTimeout(this.snapDebounce);
    this.snapDebounce = window.setTimeout(() => {
      this.snapDebounce = null;
      const t = this.scroller.scrollTop;
      const vp = window.innerHeight;
      // Pulled below the 30% snap → dismiss.
      if (t < -8) {
        this.dismiss();
        return;
      }
      const next: SnapPoint =
        t >= 0.55 * vp ? '90'
        : t >= 0.20 * vp ? '60'
        : '30';
      if (next !== this.currentSnap) {
        this.currentSnap = next;
        this.opts.onSnapChange?.(next);
      }
    }, 80);
  };
}

function makeSpacer(className: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  d.setAttribute('aria-hidden', 'true');
  return d;
}
