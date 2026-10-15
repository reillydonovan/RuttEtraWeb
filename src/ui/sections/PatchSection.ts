/**
 * Patch panel — UI for the signal-graph modulation engine.
 *
 * This module is lazy-loaded (dynamic import) so users who stay in
 * Classic mode never pay for it in the initial bundle.
 *
 * Stage 2 ships a minimal placeholder body. Stage 3 adds the beginner
 * matrix-style projection. Stage 4 adds the advanced node-graph canvas.
 *
 * The section receives a `GraphEngine` accessor (`getEngine`) instead of
 * the engine directly, so we can lazy-construct the engine the first
 * time the user actually opens the panel.
 */

import { SettingsStore } from '../../state/Settings';
import type { GraphEngine } from '../../modulation/graph/GraphEngine';
import type { VideoTap } from '../../modulation/graph/VideoTap';
import { renderBeginnerView } from '../graph/BeginnerView';

export interface PatchSectionDeps {
  settings: SettingsStore;
  getEngine: () => Promise<GraphEngine>;
  getVideoTap?: () => VideoTap | null;
  /** Hint from `LayoutManager.current()`; advanced view is hidden in compact. */
  isCompact: () => boolean;
  /** v9: external CV reader (drives live readouts on cv-input rows). */
  cv?: import('../../audio/CVInput').CVInput;
  /** v9: gamepad / HID poller (drives live readouts on gamepad rows). */
  gamepad?: import('../../input/GamepadInput').GamepadInput;
}

export function createPatchSection(deps: PatchSectionDeps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'rw-mod-graph-pane-body';

  const toolbar = document.createElement('div');
  toolbar.className = 'rw-graph-toolbar';
  const viewSwitch = document.createElement('div');
  viewSwitch.className = 'rw-graph-view-switch';
  const beginnerBtn = mkBtn('Beginner');
  const advancedBtn = mkBtn('Advanced');
  advancedBtn.dataset.view = 'advanced';
  viewSwitch.append(beginnerBtn, advancedBtn);
  toolbar.appendChild(viewSwitch);

  const libraryBtn = document.createElement('button');
  libraryBtn.type = 'button';
  libraryBtn.className = 'rw-graph-view-btn rw-graph-library-btn';
  libraryBtn.textContent = 'Library';
  libraryBtn.title = 'Load a starter patch';
  toolbar.appendChild(libraryBtn);

  const body = document.createElement('div');
  body.className = 'rw-graph-body';

  let librarySidebar: HTMLElement | null = null;
  libraryBtn.addEventListener('click', async () => {
    if (librarySidebar) {
      librarySidebar.remove();
      librarySidebar = null;
      libraryBtn.classList.remove('active');
      return;
    }
    const { renderLibrarySidebar } = await import('../graph/Library');
    librarySidebar = renderLibrarySidebar(deps);
    body.parentElement?.insertBefore(librarySidebar, body);
    libraryBtn.classList.add('active');
  });

  let activeView: 'beginner' | 'advanced' = 'beginner';
  let cleanupActive: (() => void) | null = null;

  const renderActive = (): void => {
    cleanupActive?.();
    cleanupActive = null;
    body.innerHTML = '';

    beginnerBtn.classList.toggle('active', activeView === 'beginner');
    advancedBtn.classList.toggle('active', activeView === 'advanced');

    if (activeView === 'beginner') {
      const cleanup = renderBeginnerView(body, deps);
      cleanupActive = cleanup;
      return;
    }

    if (deps.isCompact()) {
      const note = document.createElement('div');
      note.className = 'rw-mod-graph-empty';
      note.textContent = 'Open on a larger screen for the full editor.';
      body.appendChild(note);
      return;
    }

    // Stage 4 plugs the AdvancedView here.
    const placeholder = document.createElement('div');
    placeholder.className = 'rw-mod-graph-empty';
    placeholder.textContent = 'Advanced view loading...';
    body.appendChild(placeholder);

    void (async () => {
      try {
        const mod = await import('../graph/AdvancedView');
        const cleanup = mod.renderAdvancedView(body, deps);
        cleanupActive = cleanup;
      } catch (err) {
        placeholder.textContent = `Advanced view failed to load: ${(err as Error).message}`;
      }
    })();
  };

  beginnerBtn.addEventListener('click', () => { activeView = 'beginner'; renderActive(); });
  advancedBtn.addEventListener('click', () => {
    if (deps.isCompact()) {
      // Tiny inline toast; matches the spec without pulling in a real toast system.
      const t = document.createElement('div');
      t.className = 'rw-mod-graph-empty';
      t.textContent = 'Advanced view requires a larger screen.';
      body.prepend(t);
      setTimeout(() => t.remove(), 2400);
      return;
    }
    activeView = 'advanced';
    renderActive();
  });

  root.append(toolbar, body);
  renderActive();
  return root;

  function mkBtn(label: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rw-graph-view-btn';
    b.textContent = label;
    return b;
  }
}
