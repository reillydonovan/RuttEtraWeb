/**
 * Two-screen support: pop the control panel out into its own browser
 * window (AUDIT item 27).
 *
 * The classic performance setup — output fullscreen on the projector,
 * controls on the laptop screen. Implementation: `window.open('')` a
 * same-origin child window and **adopt the live panel DOM into it**.
 * Because the popup shares the JS context, every existing listener,
 * Settings subscription, and store reference keeps working — there is
 * no state synchronization layer at all. Closing the popup (or the main
 * window) adopts the panel back to its original spot.
 *
 * Additive by design: nothing about the in-window panel changes when
 * the feature is unused. Known limitations (accepted for v1, see
 * AUDIT item 27): global keyboard shortcuts (Ctrl+S etc.) only fire in
 * the main window; the compact/touch bottom-sheet layout is not
 * supported inside the popup (this is a desktop feature); dev-mode HMR
 * style updates don't propagate to an open popup.
 */

export interface PanelPopoutController {
  /** True while the panel lives in the popup window. */
  isOpen(): boolean;
  /** Open the popup and move the panel into it. No-op if already open. */
  popOut(): void;
  /** Move the panel home and close the popup. No-op if not open. */
  popIn(): void;
  toggle(): void;
}

export function createPanelPopout(
  panelRoot: HTMLElement,
  onChange?: (open: boolean) => void,
): PanelPopoutController {
  let popup: Window | null = null;
  /** Marks where the panel came from so popIn restores the exact spot. */
  const placeholder = document.createComment('rw-panel-popout-placeholder');

  function copyStyles(target: Document): void {
    // Copy every stylesheet the app has loaded — Vite injects <style>
    // tags in dev and <link rel="stylesheet"> in production builds;
    // font <link>s ride along too.
    const nodes = document.head.querySelectorAll('style, link[rel="stylesheet"], link[rel="preconnect"], link[rel="preload"]');
    for (const n of Array.from(nodes)) {
      target.head.appendChild(n.cloneNode(true));
    }
  }

  function popOut(): void {
    if (popup && !popup.closed) { popup.focus(); return; }
    const w = window.open('', 'ruttetra-controls', 'popup=yes,width=460,height=920');
    if (!w) return; // popup blocked — nothing to do, button stays inert
    popup = w;
    w.document.title = 'RUTT/ETRA — Controls';
    copyStyles(w.document);
    w.document.body.className = document.body.className;
    w.document.body.classList.add('rw-popout-body');

    // Adopt the live panel. The placeholder keeps our seat in the main DOM.
    panelRoot.parentNode?.insertBefore(placeholder, panelRoot);
    w.document.body.appendChild(w.document.adoptNode(panelRoot));
    panelRoot.classList.add('rw-panel--popout');

    // Either side closing puts the panel back.
    w.addEventListener('pagehide', popIn);
    window.addEventListener('pagehide', closePopup);
    onChange?.(true);
  }

  function closePopup(): void {
    if (popup && !popup.closed) popup.close();
    popup = null;
  }

  function popIn(): void {
    if (!placeholder.parentNode) { closePopup(); return; }
    panelRoot.classList.remove('rw-panel--popout');
    placeholder.parentNode.insertBefore(document.adoptNode(panelRoot), placeholder);
    placeholder.parentNode.removeChild(placeholder);
    window.removeEventListener('pagehide', closePopup);
    closePopup();
    onChange?.(false);
  }

  return {
    isOpen: () => popup != null && !popup.closed,
    popOut,
    popIn,
    toggle(): void {
      if (popup && !popup.closed) popIn(); else popOut();
    },
  };
}
