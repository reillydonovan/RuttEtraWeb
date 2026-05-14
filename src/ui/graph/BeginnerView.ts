/**
 * Beginner view — flat slot-row projection of a `GraphPatch`.
 *
 * Each row reads as `[source dropdown] -> [optional inline processor] ->
 * [amount] -> [target dropdown]`. Edits write minimal patch mutations
 * back to `settings.modGraph`; the GraphEngine's `setPatch` re-compiles
 * automatically.
 *
 * If the underlying patch is too complex to represent flatly (multiple
 * fan-out from one node, cycles, more than ~6 nodes), the view shows a
 * placeholder pointing the user to the Advanced view instead of trying
 * to misrepresent the patch.
 */

import { SettingsStore } from '../../state/Settings';
import {
  GraphNode, GraphPatch, NodeType, TargetBinding,
} from '../../modulation/graph/types';
import { allDefs, getDef } from '../../modulation/graph/registry';
import '../../modulation/graph/bootstrap';
import { CLASSIC_SOURCE_NODE_TYPES } from '../../modulation/graph/convert';
import { TARGETS } from '../targets';
import type { ModTarget } from '../../state/Settings';
import { PatchSectionDeps } from '../sections/PatchSection';

const PROCESSOR_OPTS: NodeType[] = ['attenuator', 'inverter', 'mixer'];

interface SourceOption { type: NodeType; label: string; }

function sourceOptions(): SourceOption[] {
  const out: SourceOption[] = [];
  for (const def of allDefs()) {
    if (CLASSIC_SOURCE_NODE_TYPES.has(def.type) || def.category === 'Sources' || def.category === 'Audio' || def.category === 'Video' || def.category === 'Inputs') {
      out.push({ type: def.type, label: def.label });
    }
  }
  // Stable alphabetical order per category.
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

interface BeginnerRow {
  source: GraphNode;
  processors: GraphNode[];   // 0..2 chained processors between source and binding
  binding: TargetBinding;
}

const MAX_BEGINNER_NODES = 6;

/**
 * Try to deconstruct the current patch into beginner-style rows. Returns
 * `null` if the patch is too complex to represent.
 */
function rowsFromPatch(patch: GraphPatch): BeginnerRow[] | null {
  if (patch.nodes.length === 0) return [];
  if (patch.nodes.length > MAX_BEGINNER_NODES) return null;

  // Build outgoing adjacency to detect fan-out (>1 outgoing edge from a node
  // is a sign the patch isn't a clean linear chain).
  const outDeg = new Map<string, number>();
  for (const n of patch.nodes) for (const v of Object.values(n.inputs)) {
    if (v) outDeg.set(v, (outDeg.get(v) ?? 0) + 1);
  }
  for (const b of patch.bindings) outDeg.set(b.sourceNodeId, (outDeg.get(b.sourceNodeId) ?? 0) + 1);

  const rows: BeginnerRow[] = [];
  for (const binding of patch.bindings) {
    // Walk backwards from the binding through any single-input chain.
    const chain: GraphNode[] = [];
    let cursor: GraphNode | undefined = patch.nodes.find((n) => n.id === binding.sourceNodeId);
    if (!cursor) return null;
    chain.push(cursor);
    while (cursor) {
      const inputs: string[] = Object.values(cursor.inputs).filter((v): v is string => !!v);
      if (inputs.length === 0) break;
      if (inputs.length > 1) return null; // multi-input mid-chain -> too complex
      const prevId: string = inputs[0];
      const prev: GraphNode | undefined = patch.nodes.find((n) => n.id === prevId);
      if (!prev) return null;
      // If a processor in the chain has fan-out >1 the patch isn't linear.
      if ((outDeg.get(prev.id) ?? 0) > 1) return null;
      chain.push(prev);
      cursor = prev;
      if (chain.length > 4) return null; // source + up to 2 processors = chain length 3
    }
    // Chain order: [binding source, ..., real source]. Reverse so source
    // is first.
    chain.reverse();
    const source = chain[0];
    const processors = chain.slice(1, chain.length);
    if (processors.length > 2) return null;
    rows.push({ source, processors, binding });
  }

  // Make sure every node is accounted for.
  const seen = new Set<string>();
  for (const r of rows) { seen.add(r.source.id); for (const p of r.processors) seen.add(p.id); }
  for (const n of patch.nodes) if (!seen.has(n.id)) return null;
  return rows;
}

function genId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

export function renderBeginnerView(host: HTMLElement, deps: PatchSectionDeps): () => void {
  const { settings } = deps;
  const root = document.createElement('div');
  root.className = 'rw-beginner-view';
  host.appendChild(root);

  const header = document.createElement('div');
  header.className = 'rw-beginner-header';
  header.textContent = 'Quick patcher — source → optional processors → amount → target';
  root.appendChild(header);

  const rowsHost = document.createElement('div');
  rowsHost.className = 'rw-beginner-rows';
  root.appendChild(rowsHost);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'rw-btn';
  addBtn.textContent = '+ Add patch';
  addBtn.addEventListener('click', () => {
    const cur = currentPatch();
    const id = genId('n');
    const sourceNode: GraphNode = { id, type: 'lfo', inputs: {}, params: {} };
    const binding: TargetBinding = {
      id: genId('b'), paramKey: 'zPush',
      sourceNodeId: id, amount: 0.25, mode: 'additive',
    };
    cur.nodes.push(sourceNode);
    cur.bindings.push(binding);
    writePatch(cur);
  });

  const footer = document.createElement('div');
  footer.className = 'rw-beginner-footer';
  footer.appendChild(addBtn);
  root.appendChild(footer);

  function currentPatch(): GraphPatch {
    const p = settings.get('modGraph');
    if (p) return clonePatch(p);
    return { nodes: [], bindings: [] };
  }

  function writePatch(next: GraphPatch): void {
    settings.set('modGraph', next);
    void deps.getEngine().then((e) => e.setPatch(next));
    render();
  }

  function render(): void {
    rowsHost.innerHTML = '';
    const patch = settings.get('modGraph') ?? { nodes: [], bindings: [] };
    const rows = rowsFromPatch(patch);
    if (rows == null) {
      const note = document.createElement('div');
      note.className = 'rw-mod-graph-empty';
      note.textContent = 'This patch is too complex for Beginner view — open Advanced view to edit.';
      rowsHost.appendChild(note);
      return;
    }
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'rw-mod-graph-empty';
      empty.textContent = 'No patches yet. Click "+ Add patch" to start.';
      rowsHost.appendChild(empty);
      return;
    }
    for (let i = 0; i < rows.length; i++) {
      rowsHost.appendChild(renderRow(rows[i], i));
    }
  }

  function renderRow(row: BeginnerRow, _index: number): HTMLElement {
    const r = document.createElement('div');
    r.className = 'rw-beginner-row';

    // Source dropdown
    const srcSel = document.createElement('select');
    srcSel.className = 'rw-select';
    for (const opt of sourceOptions()) {
      const o = document.createElement('option');
      o.value = opt.type;
      o.textContent = opt.label;
      srcSel.appendChild(o);
    }
    srcSel.value = row.source.type;
    srcSel.addEventListener('change', () => {
      const cur = currentPatch();
      const nxt = cur.nodes.find((n) => n.id === row.source.id);
      if (!nxt) return;
      const def = getDef(srcSel.value as NodeType);
      if (!def) return;
      nxt.type = srcSel.value as NodeType;
      // Reset params to def defaults; previous params no longer apply.
      nxt.params = {};
      writePatch(cur);
    });

    // Inline processor button + chain (up to 2)
    const procWrap = document.createElement('div');
    procWrap.className = 'rw-beginner-procs';
    for (const p of row.processors) procWrap.appendChild(procChip(p, row));
    if (row.processors.length < 2) {
      const addProc = document.createElement('button');
      addProc.type = 'button';
      addProc.className = 'rw-btn rw-beginner-add-proc';
      addProc.textContent = '+';
      addProc.title = 'Add a processor (attenuator / inverter / mixer)';
      addProc.addEventListener('click', () => {
        const cur = currentPatch();
        const id = genId('p');
        const newProc: GraphNode = { id, type: 'attenuator', inputs: { in: lastChainNode(cur, row).id }, params: {} };
        cur.nodes.push(newProc);
        // Re-route the binding's source to the new processor.
        const b = cur.bindings.find((x) => x.id === row.binding.id);
        if (b) b.sourceNodeId = id;
        writePatch(cur);
      });
      procWrap.appendChild(addProc);
    }

    // Amount slider
    const amountWrap = document.createElement('div');
    amountWrap.className = 'rw-beginner-amount';
    const amountInp = document.createElement('input');
    amountInp.type = 'range';
    amountInp.min = '-2'; amountInp.max = '2'; amountInp.step = '0.001';
    amountInp.value = String(row.binding.amount);
    const amountLabel = document.createElement('span');
    amountLabel.className = 'rw-beginner-amount-label';
    amountLabel.textContent = row.binding.amount.toFixed(2);
    amountInp.addEventListener('input', () => {
      const v = +amountInp.value;
      amountLabel.textContent = v.toFixed(2);
      const cur = currentPatch();
      const b = cur.bindings.find((x) => x.id === row.binding.id);
      if (b) b.amount = v;
      writePatch(cur);
    });
    amountWrap.append(amountInp, amountLabel);

    // Target dropdown
    const tgtSel = document.createElement('select');
    tgtSel.className = 'rw-select';
    for (const t of TARGETS) {
      const o = document.createElement('option');
      o.value = t.v as string;
      o.textContent = t.l;
      tgtSel.appendChild(o);
    }
    tgtSel.value = row.binding.paramKey;
    tgtSel.addEventListener('change', () => {
      const cur = currentPatch();
      const b = cur.bindings.find((x) => x.id === row.binding.id);
      if (b) b.paramKey = tgtSel.value as ModTarget;
      writePatch(cur);
    });

    // Delete row
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'rw-btn rw-beginner-del';
    del.textContent = '×';
    del.title = 'Remove this patch row';
    del.addEventListener('click', () => {
      const cur = currentPatch();
      cur.bindings = cur.bindings.filter((x) => x.id !== row.binding.id);
      const ids = new Set([row.source.id, ...row.processors.map((p) => p.id)]);
      cur.nodes = cur.nodes.filter((n) => !ids.has(n.id));
      writePatch(cur);
    });

    r.append(
      labeled('Source', srcSel),
      procWrap,
      labeled('Amount', amountWrap),
      labeled('Target', tgtSel),
      del,
    );
    return r;
  }

  function procChip(node: GraphNode, row: BeginnerRow): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'rw-beginner-proc';
    const sel = document.createElement('select');
    sel.className = 'rw-select';
    for (const p of PROCESSOR_OPTS) {
      const o = document.createElement('option');
      o.value = p; o.textContent = labelFor(p);
      sel.appendChild(o);
    }
    sel.value = node.type;
    sel.addEventListener('change', () => {
      const cur = currentPatch();
      const target = cur.nodes.find((n) => n.id === node.id);
      if (!target) return;
      target.type = sel.value as NodeType;
      target.params = {};
      writePatch(cur);
    });
    const x = document.createElement('button');
    x.type = 'button'; x.textContent = '×';
    x.className = 'rw-btn rw-beginner-proc-x';
    x.addEventListener('click', () => {
      const cur = currentPatch();
      cur.nodes = cur.nodes.filter((n) => n.id !== node.id);
      // Re-thread: any node that had `node` as input now reads from
      // `node.inputs.in` (fall back to the row's source).
      const fallback = node.inputs.in ?? row.source.id;
      for (const n of cur.nodes) for (const k of Object.keys(n.inputs)) {
        if (n.inputs[k] === node.id) n.inputs[k] = fallback;
      }
      for (const b of cur.bindings) if (b.sourceNodeId === node.id) b.sourceNodeId = fallback;
      writePatch(cur);
    });
    wrap.append(sel, x);
    return wrap;
  }

  function lastChainNode(patch: GraphPatch, row: BeginnerRow): GraphNode {
    if (row.processors.length === 0) {
      return patch.nodes.find((n) => n.id === row.source.id)!;
    }
    return patch.nodes.find((n) => n.id === row.processors[row.processors.length - 1].id)!;
  }

  function labelFor(t: NodeType): string {
    return getDef(t)?.label ?? t;
  }

  function labeled(label: string, control: HTMLElement): HTMLElement {
    const w = document.createElement('div');
    w.className = 'rw-beginner-cell';
    const l = document.createElement('label');
    l.className = 'rw-beginner-cell-label';
    l.textContent = label;
    w.append(l, control);
    return w;
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

  // Re-render whenever `modGraph` changes (subscribe fires immediately
  // with the current value, so this also performs the initial render).
  const unsubscribe = settings.subscribe('modGraph', () => render());
  return () => {
    unsubscribe();
    root.remove();
  };
}
