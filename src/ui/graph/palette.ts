/**
 * Node palette — left-side categorized list of every node type, generated
 * from the registry so adding a new node type to the engine automatically
 * lands in the palette without touching this file.
 *
 * Click adds the node to the canvas at a sensible default position;
 * drag-to-position is a Stage 4 follow-up.
 */

import { allDefs } from '../../modulation/graph/registry';
import { NodeDef, NodeType } from '../../modulation/graph/types';

export interface PaletteOptions {
  onAdd(type: NodeType): void;
}

const CATEGORY_ORDER: NodeDef<unknown>['category'][] = [
  'Sources', 'Audio', 'Video', 'Inputs', 'Processors', 'Logic',
];

export function createPalette(opts: PaletteOptions): HTMLElement {
  const root = document.createElement('div');
  root.className = 'rw-graph-palette';

  const heading = document.createElement('div');
  heading.className = 'rw-graph-palette-title';
  heading.textContent = 'NODES';
  root.appendChild(heading);

  const groups = new Map<string, NodeDef<unknown>[]>();
  for (const def of allDefs()) {
    const list = groups.get(def.category) ?? [];
    list.push(def);
    groups.set(def.category, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.label.localeCompare(b.label));
  }

  for (const cat of CATEGORY_ORDER) {
    const list = groups.get(cat);
    if (!list?.length) continue;
    const header = document.createElement('div');
    header.className = 'rw-graph-palette-cat';
    header.textContent = cat;
    root.appendChild(header);
    for (const def of list) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `rw-graph-palette-item rw-graph-palette-item--${cat.toLowerCase()}`;
      item.textContent = def.label;
      item.title = def.description;
      item.addEventListener('click', () => opts.onAdd(def.type));
      root.appendChild(item);
    }
  }

  return root;
}
