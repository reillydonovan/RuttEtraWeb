/**
 * Starter-patch sidebar.
 *
 * Renders the bundled `STARTER_PATCHES` as a vertical list with hover
 * descriptions; clicking a card writes the patch into `settings.modGraph`
 * and tells the engine to recompile.
 */

import { STARTER_PATCHES } from '../../modulation/graph/library';
import { GraphPatch } from '../../modulation/graph/types';
import { PatchSectionDeps } from '../sections/PatchSection';

export function renderLibrarySidebar(deps: PatchSectionDeps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'rw-graph-library';

  const header = document.createElement('div');
  header.className = 'rw-graph-library-header';
  header.textContent = 'STARTER PATCHES';
  root.appendChild(header);

  for (const sp of STARTER_PATCHES) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'rw-graph-library-card';
    const title = document.createElement('div');
    title.className = 'rw-graph-library-title';
    title.textContent = sp.name;
    const desc = document.createElement('div');
    desc.className = 'rw-graph-library-desc';
    desc.textContent = sp.description;
    card.append(title, desc);
    card.addEventListener('click', async () => {
      const patch: GraphPatch = clonePatch(sp.patch);
      deps.settings.set('modGraph', patch);
      const e = await deps.getEngine();
      e.setPatch(patch);
    });
    root.appendChild(card);
  }

  return root;
}

function clonePatch(p: GraphPatch): GraphPatch {
  return {
    nodes: p.nodes.map((n) => ({
      id: n.id, type: n.type,
      params: { ...n.params },
      inputs: { ...n.inputs },
      position: n.position ? { ...n.position } : undefined,
    })),
    bindings: p.bindings.map((b) => ({ ...b })),
  };
}
