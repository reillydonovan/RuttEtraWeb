/**
 * Small corner status badge for things the performer needs to know about
 * without a dialog: a render-loop error, a lost GPU context, a state reset.
 * One badge, reused; it fades out `holdMs` after its last update. Never
 * intercepts the pointer, so it can't get in the way of the instrument.
 */

export type BadgeTone = 'error' | 'info';

let el: HTMLDivElement | null = null;
let hideTimer: number | null = null;

export function showStatusBadge(text: string, tone: BadgeTone = 'error', holdMs = 8000): void {
  if (typeof document === 'undefined') return;
  if (!el || !el.isConnected) {
    el = document.createElement('div');
    el.className = 'rw-status-badge';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.dataset.tone = tone;
  el.classList.add('rw-status-badge--show');
  if (hideTimer != null) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    el?.classList.remove('rw-status-badge--show');
    hideTimer = null;
  }, holdMs);
}
