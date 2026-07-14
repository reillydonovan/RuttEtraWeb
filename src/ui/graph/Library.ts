/**
 * Patch-library sidebar.
 *
 * Two sections (coexistence, not replacement):
 *   - STARTER PATCHES — the bundled read-only `STARTER_PATCHES` templates.
 *   - MY PATCHES (v17) — user-saved named patches persisted in
 *     localStorage via `userLibrary.ts`. Save Current snapshots the active
 *     graph under a typed name (same name = overwrite); each card loads
 *     on click and has a × delete button.
 *
 * Clicking any card writes the patch into `settings.modGraph` and tells
 * the engine to recompile.
 */

import { STARTER_PATCHES } from '../../modulation/graph/library';
import {
  loadUserLibrary, storeUserLibrary, savePatch, deletePatch, UserLibrary,
} from '../../modulation/graph/userLibrary';
import { GraphPatch } from '../../modulation/graph/types';
import { PatchSectionDeps } from '../sections/PatchSection';

export function renderLibrarySidebar(deps: PatchSectionDeps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'rw-graph-library';

  const header = document.createElement('div');
  header.className = 'rw-graph-library-header';
  header.textContent = 'STARTER PATCHES';
  root.appendChild(header);

  async function loadPatch(name: string, patch: GraphPatch): Promise<void> {
    // Loading REPLACES the whole graph patch — warn when one exists
    // (owner: prompt to keep or erase; same guard as File → Load
    // Sample Patch in main.ts). OK = replace, Cancel = keep.
    const cur = deps.settings.get('modGraph');
    if (cur && cur.nodes.length > 0 && !confirm(
      `Load “${name}”?\n\nThis replaces your current graph patch `
      + `(${cur.nodes.length} node${cur.nodes.length === 1 ? '' : 's'}). `
      + 'OK to replace it — Cancel to keep what you have.\n\n'
      + 'Tip: Save Current below keeps a copy first.',
    )) return;
    const clone = clonePatch(patch);
    deps.settings.set('modGraph', clone);
    const e = await deps.getEngine();
    e.setPatch(clone);
  }

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
    card.addEventListener('click', () => void loadPatch(sp.name, sp.patch));
    root.appendChild(card);
  }

  // ---------------- MY PATCHES (v17) ----------------

  const mineHeader = document.createElement('div');
  mineHeader.className = 'rw-graph-library-header';
  mineHeader.style.marginTop = '8px';
  mineHeader.textContent = 'MY PATCHES';
  root.appendChild(mineHeader);

  const mineList = document.createElement('div');
  mineList.className = 'rw-graph-library';
  mineList.style.padding = '0';
  mineList.style.border = 'none';
  mineList.style.marginBottom = '0';
  root.appendChild(mineList);

  function renderMine(lib: UserLibrary): void {
    mineList.innerHTML = '';
    if (lib.patches.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'rw-graph-library-desc';
      emptyMsg.textContent = 'No saved patches yet — name the current graph below and Save.';
      mineList.appendChild(emptyMsg);
      return;
    }
    for (const up of lib.patches) {
      const rowEl = document.createElement('div');
      rowEl.className = 'rw-graph-library-row';
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'rw-graph-library-card';
      const title = document.createElement('div');
      title.className = 'rw-graph-library-title';
      title.textContent = up.name;
      const desc = document.createElement('div');
      desc.className = 'rw-graph-library-desc';
      desc.textContent = `${up.patch.nodes.length} nodes · ${up.patch.bindings.length} bindings`;
      card.append(title, desc);
      card.addEventListener('click', () => void loadPatch(up.name, up.patch));
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'rw-graph-library-del';
      del.textContent = '×';
      del.title = `Delete "${up.name}"`;
      del.addEventListener('click', () => {
        const next = deletePatch(loadUserLibrary(), up.id);
        storeUserLibrary(next);
        renderMine(next);
      });
      rowEl.append(card, del);
      mineList.appendChild(rowEl);
    }
  }

  const saveRow = document.createElement('div');
  saveRow.className = 'rw-graph-library-save';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Patch name…';
  nameInput.maxLength = 48;
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'rw-btn';
  saveBtn.textContent = 'Save';
  saveBtn.title = 'Save the current graph under this name (same name overwrites)';
  function doSave(): void {
    const current = deps.settings.get('modGraph');
    if (!current || current.nodes.length === 0 || !nameInput.value.trim()) return;
    const next = savePatch(loadUserLibrary(), nameInput.value, current, Date.now());
    storeUserLibrary(next);
    nameInput.value = '';
    renderMine(next);
  }
  saveBtn.addEventListener('click', doSave);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); });
  saveRow.append(nameInput, saveBtn);
  root.appendChild(saveRow);

  renderMine(loadUserLibrary());

  return root;
}

function clonePatch(p: GraphPatch): GraphPatch {
  return {
    nodes: p.nodes.map((n) => ({
      id: n.id, type: n.type,
      params: { ...n.params },
      inputs: { ...n.inputs },
      position: n.position ? { ...n.position } : undefined,
      enabled: n.enabled,
    })),
    bindings: p.bindings.map((b) => ({ ...b })),
  };
}
