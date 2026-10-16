/**
 * Interactive step-by-step walkthrough — opt-in only (Help ▸ Start
 * Tutorial), never shown automatically. Dims the app, cuts a spotlight
 * hole around the current step's target element, and floats an
 * interactive callout (title / body / Back / Next / Skip) near it.
 *
 * Scope: main-document only. If the control panel is popped out
 * (`PanelPopout.ts`), a step whose target lives there simply won't be
 * found — it falls back to a centered, non-highlighted callout (see
 * `resolveTarget`). Teaching a step-sequencer to hunt across windows
 * wasn't worth the complexity for an opt-in helper; CLAUDE.md notes the
 * trade-off.
 *
 * The dim layer is `pointer-events: none` everywhere, including over the
 * spotlight hole (which is purely a `box-shadow` illusion, not a real
 * cutout) — the app underneath stays fully interactive throughout, so a
 * step can say "try dragging this" and the user actually can, live,
 * without dismissing anything.
 */

import { expandGroupsAround } from '../widgets';
import './tutorial.css';

export interface TutorialStep {
  title: string;
  body: string;
  /** Resolve the element to spotlight. Re-evaluated every time this step
   *  is (re)shown. Return null for a centered card with no highlight. */
  target?: () => HTMLElement | null;
  /** Runs once, synchronously, right before this step is shown — e.g.
   *  switch panel tab, expand a collapsed section. */
  before?: () => void;
  /** Optional extra button in the callout (e.g. "Load it now"). */
  action?: { label: string; run: () => void };
}

let active: { stop(): void } | null = null;

/** Only one tutorial run at a time — starting a new one cancels any prior. */
export function startTutorial(steps: TutorialStep[]): void {
  active?.stop();
  if (steps.length === 0) return;

  const root = document.createElement('div');
  root.className = 'rw-tut-root';

  const spotlight = document.createElement('div');
  spotlight.className = 'rw-tut-spotlight';
  spotlight.hidden = true;

  const callout = document.createElement('div');
  callout.className = 'rw-tut-callout';

  const stepLabel = document.createElement('div');
  stepLabel.className = 'rw-tut-step-label';
  const title = document.createElement('div');
  title.className = 'rw-tut-title';
  const body = document.createElement('div');
  body.className = 'rw-tut-body';

  const actionRow = document.createElement('div');
  actionRow.className = 'rw-tut-action-row';
  const actionBtn = document.createElement('button');
  actionBtn.type = 'button';
  actionBtn.className = 'rw-tut-btn rw-tut-btn--action';
  actionRow.appendChild(actionBtn);

  const navRow = document.createElement('div');
  navRow.className = 'rw-tut-nav-row';
  const skipBtn = document.createElement('button');
  skipBtn.type = 'button';
  skipBtn.className = 'rw-tut-btn rw-tut-btn--ghost';
  skipBtn.textContent = 'Exit';
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'rw-tut-btn';
  backBtn.textContent = '← Back';
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'rw-tut-btn rw-tut-btn--primary';
  navRow.append(skipBtn, backBtn, nextBtn);

  callout.append(stepLabel, title, body, actionRow, navRow);
  root.append(spotlight, callout);
  document.body.appendChild(root);

  let idx = 0;
  let rafId = 0;

  function currentTarget(): HTMLElement | null {
    try { return steps[idx].target?.() ?? null; } catch { return null; }
  }

  /**
   * Position the callout near a (possibly viewport-clamped) rect, above
   * it if there's room, else below; final clamp pins it on-screen if
   * neither fits. Takes a plain rect rather than an element — unlike
   * `tooltip.ts`'s hover popover, a tutorial target can be a whole panel
   * section taller than the viewport (or scrolled half off it), and
   * measuring the target's OWN unclamped rect would push the callout
   * far off-screen (confirmed live: a tall Source section pushed it
   * ~1300px below the fold).
   */
  function positionCallout(rect: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null): void {
    const vw = window.innerWidth, vh = window.innerHeight;
    const cw = callout.offsetWidth, ch = callout.offsetHeight;
    if (!rect) {
      callout.style.left = `${vw / 2 - cw / 2}px`;
      callout.style.top = `${vh / 2 - ch / 2}px`;
      return;
    }
    let left = rect.left + rect.width / 2 - cw / 2;
    left = Math.max(4, Math.min(vw - cw - 4, left));
    let top = rect.top - ch - 8;
    if (top < 4) top = rect.bottom + 8;
    if (top + ch > vh - 4) top = Math.max(4, vh - ch - 4);
    callout.style.left = `${left}px`;
    callout.style.top = `${top}px`;
  }

  function reposition(): void {
    const t = currentTarget();
    if (t && t.isConnected) {
      const r = t.getBoundingClientRect();
      const pad = 6;
      spotlight.hidden = false;
      spotlight.style.left = `${r.left - pad}px`;
      spotlight.style.top = `${r.top - pad}px`;
      spotlight.style.width = `${r.width + pad * 2}px`;
      spotlight.style.height = `${r.height + pad * 2}px`;
      const vw = window.innerWidth, vh = window.innerHeight;
      const left = Math.max(0, r.left), top = Math.max(0, r.top);
      const right = Math.min(vw, r.right), bottom = Math.min(vh, r.bottom);
      positionCallout({ left, top, right, bottom, width: right - left, height: bottom - top });
    } else {
      spotlight.hidden = true;
      positionCallout(null);
    }
  }

  // Tracks scroll/resize/section-expand continuously rather than guessing
  // a fixed delay after `before()` runs `scrollIntoView({behavior:'smooth'})`
  // — the spotlight just follows the live rect every frame while active.
  function tick(): void {
    reposition();
    rafId = requestAnimationFrame(tick);
  }

  function show(next: number): void {
    idx = Math.max(0, Math.min(steps.length - 1, next));
    const step = steps[idx];
    try { step.before?.(); } catch { /* a bad before() shouldn't brick the tutorial */ }
    // Scroll to whatever the step actually points at (a specific param
    // row, if it has one) — not just the section before() expanded,
    // which may be taller than the viewport and center on the wrong part.
    const tgt = currentTarget();
    expandGroupsAround(tgt);
    tgt?.scrollIntoView({ behavior: 'smooth', block: 'center' });

    stepLabel.textContent = `STEP ${idx + 1} OF ${steps.length}`;
    title.textContent = step.title;
    body.textContent = step.body;

    if (step.action) {
      actionRow.hidden = false;
      actionBtn.textContent = step.action.label;
      actionBtn.onclick = () => step.action?.run();
    } else {
      actionRow.hidden = true;
    }

    backBtn.disabled = idx === 0;
    nextBtn.textContent = idx === steps.length - 1 ? 'Finish' : 'Next →';
    reposition();
  }

  function stop(): void {
    cancelAnimationFrame(rafId);
    document.removeEventListener('keydown', onKeydown, true);
    root.remove();
    if (active?.stop === stop) active = null;
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.stopPropagation(); stop(); }
  }

  backBtn.addEventListener('click', () => show(idx - 1));
  nextBtn.addEventListener('click', () => {
    if (idx === steps.length - 1) stop(); else show(idx + 1);
  });
  skipBtn.addEventListener('click', stop);
  // Capture phase: Escape-to-exit must win even when focus sits inside
  // an element with its own Escape handling (canvas fullscreen/deselect,
  // the menu bar's own close-on-Escape) — confirmed flaky (~2 of 3 runs
  // swallowed it) with a plain bubble-phase listener.
  document.addEventListener('keydown', onKeydown, true);

  active = { stop };
  show(0);
  rafId = requestAnimationFrame(tick);
}
