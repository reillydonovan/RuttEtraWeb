/**
 * Top-level Modulation panel — wraps the legacy 4-slot ModulationSection
 * (Classic) and the new PatchSection (Graph) under a single mode-switch
 * button strip.
 *
 * Mode is persisted in `settings.modMode` and defaults to `'classic'`.
 * The Graph pane is lazy-imported on demand so Classic-only users don't
 * pay the bundle cost.
 */

import { ModMode, ModSlot, SettingsStore } from '../../state/Settings';
import type { GraphEngine } from '../../modulation/graph/GraphEngine';
import type { VideoTap } from '../../modulation/graph/VideoTap';
import { ModMatrix } from '../../modulation/ModMatrix';
import { createModulationSection } from './ModulationSection';
import { button } from '../widgets';
import { layoutManager } from '../layout/LayoutManager';
import { classicToGraph } from '../../modulation/graph/convert';

export interface ModulationContainerDeps {
  settings: SettingsStore;
  matrix: ModMatrix;
  /**
   * Lazy access to the GraphEngine (constructed only when the user
   * touches the Graph or Both mode for the first time).
   */
  getEngine: () => Promise<GraphEngine>;
  /** Lazy access to the VideoTap (resolved once the engine has been built). */
  getVideoTap?: () => VideoTap | null;
}

export function createModulationContainerSection(deps: ModulationContainerDeps): HTMLElement {
  const { settings, matrix } = deps;
  const root = document.createElement('div');
  root.className = 'rw-mod-container';

  // ---------- Mode switch ----------
  const switchEl = document.createElement('div');
  switchEl.className = 'rw-mod-mode-switch';
  switchEl.setAttribute('role', 'tablist');
  switchEl.setAttribute('aria-label', 'Modulation engine mode');
  const modes: { id: ModMode; label: string }[] = [
    { id: 'classic', label: 'Classic' },
    { id: 'graph',   label: 'Graph' },
    { id: 'both',    label: 'Both' },
  ];
  const buttons = new Map<ModMode, HTMLButtonElement>();
  for (const m of modes) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = m.label;
    b.dataset.mode = m.id;
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => {
      settings.set('modMode', m.id);
    });
    buttons.set(m.id, b);
    switchEl.appendChild(b);
  }
  root.appendChild(switchEl);

  // ---------- Classic pane ----------
  const classicPane = document.createElement('div');
  classicPane.className = 'rw-mod-classic-pane';
  classicPane.appendChild(createModulationSection(settings, matrix));

  // Convert-to-Graph row at the bottom of the Classic body.
  const convertRow = document.createElement('div');
  convertRow.className = 'rw-mod-convert-row';
  convertRow.appendChild(button('Convert to Graph →', async () => {
    const slots = settings.get('modSlots') as ModSlot[];
    const patch = classicToGraph(slots);
    if (patch.nodes.length === 0) {
      alert('No enabled Classic slots to convert.');
      return;
    }
    settings.set('modGraph', patch);
    settings.set('modMode', 'graph');
    // Eagerly poke the engine so it picks up the new patch.
    const engine = await deps.getEngine();
    engine.setPatch(patch);
  }));
  classicPane.appendChild(convertRow);
  root.appendChild(classicPane);

  // ---------- Graph pane (lazy) ----------
  const graphPane = document.createElement('div');
  graphPane.className = 'rw-mod-graph-pane';
  // Filled in only when first opened; clears when mode goes back to classic.
  let graphMounted = false;
  const ensureGraphPane = async (): Promise<void> => {
    if (graphMounted) return;
    graphMounted = true;
    const placeholder = document.createElement('div');
    placeholder.className = 'rw-mod-graph-empty';
    placeholder.textContent = 'Loading Graph editor...';
    graphPane.appendChild(placeholder);
    try {
      const [{ createPatchSection }] = await Promise.all([
        import('./PatchSection'),
        import('../graph/graph.css'),
      ]);
      placeholder.remove();
      graphPane.appendChild(createPatchSection({
        settings,
        getEngine: deps.getEngine,
        getVideoTap: deps.getVideoTap,
        isCompact: () => layoutManager().current() === 'compact',
      }));
    } catch (err) {
      placeholder.textContent = `Graph editor failed to load: ${(err as Error).message}`;
    }
  };
  root.appendChild(graphPane);

  const applyMode = (mode: ModMode): void => {
    for (const [id, b] of buttons) b.classList.toggle('active', id === mode);
    classicPane.classList.toggle('hidden', mode === 'graph');
    graphPane.classList.toggle('hidden', mode === 'classic');
    if (mode !== 'classic') void ensureGraphPane();
  };

  settings.subscribe('modMode', (m) => applyMode(m));
  applyMode(settings.get('modMode'));

  return root;
}
