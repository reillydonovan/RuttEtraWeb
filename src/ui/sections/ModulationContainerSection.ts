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
import { LiveValuesStore } from '../../modulation/LiveValues';
import { CVInput } from '../../audio/CVInput';
import { GamepadInput } from '../../input/GamepadInput';
import { createModulationSection } from './ModulationSection';
import { button } from '../widgets';
import { layoutManager } from '../layout/LayoutManager';
import { classicToGraph } from '../../modulation/graph/convert';

export interface ModulationContainerDeps {
  settings: SettingsStore;
  matrix: ModMatrix;
  /** Shared base/live router. Used by the global "Reset Mod" button to
   *  force liveParams back to base in one tick. */
  liveValues: LiveValuesStore;
  /** v9: external CV reader (used by Classic CV-Audio source rows). */
  cv?: CVInput;
  /** v9: gamepad / HID poller (used by Classic Gamepad source rows). */
  gamepad?: GamepadInput;
  /**
   * Lazy access to the GraphEngine (constructed only when the user
   * touches the Graph or Both mode for the first time).
   */
  getEngine: () => Promise<GraphEngine>;
  /** Lazy access to the VideoTap (resolved once the engine has been built). */
  getVideoTap?: () => VideoTap | null;
}

export function createModulationContainerSection(deps: ModulationContainerDeps): HTMLElement {
  const { settings, matrix, liveValues } = deps;
  const root = document.createElement('div');
  root.className = 'rw-mod-container';

  // ---------- Mode switch + Reset Mod ----------
  // The mode switch and the panic "Reset Mod" button share a header row
  // so the button is reachable without scrolling no matter how many
  // patches the user has expanded.
  const headerRow = document.createElement('div');
  headerRow.className = 'rw-mod-header-row';

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
  headerRow.appendChild(switchEl);

  // Panic button: mute every patch (Amount=0) and force live params
  // back to base in one tick. Doesn't delete patches — the user keeps
  // their carefully-built routing, just stops it from doing anything.
  const resetModBtn = document.createElement('button');
  resetModBtn.type = 'button';
  resetModBtn.className = 'rw-btn rw-mod-reset-mod';
  resetModBtn.textContent = 'Reset Mod';
  resetModBtn.title = 'Mute every patch (Amount=0) and snap modulated params back to base';
  resetModBtn.addEventListener('click', () => {
    // Classic: zero every slot's amount.
    const slots = settings.get('modSlots');
    settings.set('modSlots', slots.map((s) => ({ ...s, amount: 0 })));
    // Graph: zero every binding's amount (without deleting routing).
    const graph = settings.get('modGraph');
    if (graph) {
      const next = {
        ...graph,
        bindings: graph.bindings.map((b) => ({ ...b, amount: 0 })),
      };
      settings.set('modGraph', next);
      void deps.getEngine().then((e) => e.setPatch(next));
    }
    // Snap live values back to base immediately. clearAll() drops every
    // engine namespace's contributions so subscribers see live=base
    // before the next animation frame; the engines will rebuild their
    // (now-zero) contributions on the next tick.
    liveValues.clearAll();
  });
  headerRow.appendChild(resetModBtn);

  root.appendChild(headerRow);

  // ---------- Classic pane ----------
  const classicPane = document.createElement('div');
  classicPane.className = 'rw-mod-classic-pane';
  classicPane.appendChild(createModulationSection(settings, matrix, deps.cv, deps.gamepad));

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
        cv: deps.cv,
        gamepad: deps.gamepad,
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
