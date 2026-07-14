/**
 * Generic view popout — open any workspace view as a standalone OS
 * window for multi-display rigs (owner: "drag something like the
 * timeline or patch bay to a separate window").
 *
 * Strategy: build a FRESH live instance of the view from its workspace
 * factory directly into the popup document — NOT DOM adoption. Every
 * view is multi-instance by design (Workspace.ts: duplicates sync via
 * the shared Settings/Sequencer stores), so a popout is just one more
 * instance that happens to live in another window. That sidesteps the
 * adoption hazards the dedicated popouts had to engineer around
 * (PanelPopout's placeholder dance, RenderPopout's never-move-live-GL
 * rule) and means closing the popup needs no restore step at all — the
 * in-app window never lost anything.
 *
 * CONTROLS and RENDERER don't come through here: they keep their
 * existing, more specialized popouts (PanelPopout adopts the one live
 * panel; RenderPopout captureStreams the one real canvas) — the window
 * bar's ⧉ dispatches to those actions instead (Workspace.ts).
 */

import { applySkinToDocument, releaseDocument } from '../skin';
import { applyTextScaleToDocument } from '../textScale';

const openPopups = new Map<string, Window>();

export function popoutView(opts: {
  /** Stable window-name key so re-clicking focuses instead of stacking. */
  view: string;
  /** Popup title, e.g. 'RUTT/ETRA — Patch Bay'. */
  label: string;
  /** Fresh-instance factory (the workspace view factory). */
  build: () => HTMLElement;
}): boolean {
  const existing = openPopups.get(opts.view);
  if (existing && !existing.closed) { existing.focus(); return true; }

  const w = window.open('', `ruttetra-view-${opts.view}`, 'popup=yes,width=900,height=700');
  if (!w) return false; // popup blocked
  openPopups.set(opts.view, w);
  w.document.title = `RUTT/ETRA — ${opts.label}`;

  // Same stylesheet/skin/text-scale propagation as PanelPopout.
  const nodes = document.head.querySelectorAll('style, link[rel="stylesheet"], link[rel="preconnect"], link[rel="preload"]');
  for (const n of Array.from(nodes)) w.document.head.appendChild(n.cloneNode(true));
  w.document.body.className = document.body.className;
  w.document.body.classList.add('rw-popout-body', 'rw-view-popout-body');
  applySkinToDocument(w.document);
  const unsubTextScale = applyTextScaleToDocument(w.document);

  // Fresh instance, adopted into the popup document as it's appended
  // (same JS context — all store subscriptions keep working).
  const el = opts.build();
  w.document.body.appendChild(w.document.adoptNode(el));

  const cleanup = (): void => {
    try { releaseDocument(w.document); } catch { /* closed */ }
    unsubTextScale();
    openPopups.delete(opts.view);
    if (!w.closed) w.close();
  };
  w.addEventListener('pagehide', cleanup);
  window.addEventListener('pagehide', cleanup);
  return true;
}
