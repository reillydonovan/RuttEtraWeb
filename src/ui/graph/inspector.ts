/**
 * Right-side inspector — edits the params of the currently selected
 * node. UI is generated from the node's `params` schema in the registry,
 * so adding a new param type only requires extending this switch.
 *
 * For Video nodes the inspector also gets a thumbnail region picker
 * (filled in during Stage 5b alongside `VideoTap`).
 */

import { GraphNode, GraphPatch, ParamSpec, TargetBinding } from '../../modulation/graph/types';
import { getDef } from '../../modulation/graph/registry';
import { TARGETS } from '../targets';
import { createRegionPicker } from './RegionPicker';
import type { VideoTap } from '../../modulation/graph/VideoTap';

export interface InspectorOptions {
  getPatch(): GraphPatch;
  setPatch(p: GraphPatch): void;
  onProbe?(nodeId: string, port: string): void;
  isProbing(): boolean;
  /** Resolves to the live VideoTap once it's been constructed. Optional. */
  getVideoTap?(): VideoTap | null;
}

/** Node types that take a region rectangle (rx, ry, rw, rh). */
const REGION_NODE_TYPES = new Set<string>([
  'video-luma', 'video-motion', 'video-color', 'video-edge',
]);

export function createInspector(opts: InspectorOptions): {
  el: HTMLElement;
  setSelected(node: GraphNode | null): void;
} {
  const root = document.createElement('div');
  root.className = 'rw-graph-inspector';
  let currentId: string | null = null;
  const empty = document.createElement('div');
  empty.className = 'rw-mod-graph-empty';
  empty.textContent = 'Select a node to edit its params.';
  root.appendChild(empty);

  function setSelected(node: GraphNode | null): void {
    currentId = node?.id ?? null;
    root.innerHTML = '';
    if (!node) { root.appendChild(empty); return; }
    const def = getDef(node.type);
    if (!def) {
      empty.textContent = `Unknown node type "${node.type}".`;
      root.appendChild(empty);
      return;
    }

    const head = document.createElement('div');
    head.className = 'rw-graph-inspector-title';
    head.textContent = def.label;
    root.appendChild(head);

    const desc = document.createElement('div');
    desc.className = 'rw-graph-inspector-desc';
    desc.textContent = def.description;
    root.appendChild(desc);

    if (REGION_NODE_TYPES.has(node.type)) {
      root.appendChild(createRegionPicker({
        node,
        videoTap: opts.getVideoTap?.() ?? null,
        onChange: (rect) => {
          const p = opts.getPatch();
          const n = p.nodes.find((x) => x.id === node.id);
          if (n) Object.assign(n.params, rect);
          opts.setPatch(p);
        },
      }));
    }

    for (const [paramName, spec] of Object.entries(def.params)) {
      // Region params are exposed via the picker above; hide them here
      // to avoid double-controls competing for the same value.
      if (REGION_NODE_TYPES.has(node.type) && (paramName === 'rx' || paramName === 'ry' || paramName === 'rw' || paramName === 'rh')) continue;
      root.appendChild(createParamRow(node, paramName, spec));
    }

    // Bindings affecting this node's outputs.
    const bindings = bindingsForNode(node.id);
    const bindingsTitle = document.createElement('div');
    bindingsTitle.className = 'rw-graph-inspector-subtitle';
    bindingsTitle.textContent = 'BINDINGS';
    root.appendChild(bindingsTitle);

    for (const b of bindings) root.appendChild(createBindingRow(node, b));

    const addBindBtn = document.createElement('button');
    addBindBtn.type = 'button';
    addBindBtn.className = 'rw-btn rw-graph-add-binding';
    addBindBtn.textContent = '+ Add target binding';
    addBindBtn.addEventListener('click', () => {
      const p = opts.getPatch();
      p.bindings.push({
        id: 'b' + Date.now().toString(36) + Math.floor(Math.random() * 1000),
        paramKey: 'zPush',
        sourceNodeId: node.id,
        sourcePort: def.outputs[0]?.name ?? 'out',
        amount: 0.25,
        mode: 'additive',
      });
      opts.setPatch(p);
      setSelected(node);
    });
    root.appendChild(addBindBtn);

    // Probe quick-buttons (one per output port).
    const probeRow = document.createElement('div');
    probeRow.className = 'rw-graph-inspector-probes';
    for (const out of def.outputs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rw-btn';
      b.textContent = `Probe .${out.name}`;
      b.addEventListener('click', () => opts.onProbe?.(node.id, out.name));
      probeRow.appendChild(b);
    }
    if (def.outputs.length > 0) root.appendChild(probeRow);
  }

  function bindingsForNode(id: string): TargetBinding[] {
    return opts.getPatch().bindings.filter((b) => b.sourceNodeId === id);
  }

  function createParamRow(node: GraphNode, paramName: string, spec: ParamSpec): HTMLElement {
    const row = document.createElement('label');
    row.className = 'rw-graph-inspector-row';
    const label = document.createElement('span');
    label.className = 'rw-graph-inspector-label';
    label.textContent = paramName;
    row.appendChild(label);

    if (spec.kind === 'number') {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(spec.min);
      input.max = String(spec.max);
      input.step = String(spec.step);
      input.value = String(getParam(node, paramName, spec.default));
      const num = document.createElement('span');
      num.className = 'rw-graph-inspector-val';
      num.textContent = (+input.value).toFixed(spec.step < 0.05 ? 3 : 2);
      input.addEventListener('input', () => {
        num.textContent = (+input.value).toFixed(spec.step < 0.05 ? 3 : 2);
        const p = opts.getPatch();
        const n = p.nodes.find((x) => x.id === node.id);
        if (n) n.params[paramName] = +input.value;
        opts.setPatch(p);
      });
      const ctl = document.createElement('span');
      ctl.className = 'rw-graph-inspector-ctl';
      ctl.append(input, num);
      row.appendChild(ctl);
    } else if (spec.kind === 'enum') {
      const sel = document.createElement('select');
      sel.className = 'rw-select';
      for (const opt of spec.options) {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        sel.appendChild(o);
      }
      sel.value = String(getParam(node, paramName, spec.default));
      sel.addEventListener('change', () => {
        const p = opts.getPatch();
        const n = p.nodes.find((x) => x.id === node.id);
        if (n) n.params[paramName] = sel.value;
        opts.setPatch(p);
      });
      row.appendChild(sel);
    } else {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!getParam(node, paramName, spec.default);
      cb.addEventListener('change', () => {
        const p = opts.getPatch();
        const n = p.nodes.find((x) => x.id === node.id);
        if (n) n.params[paramName] = cb.checked;
        opts.setPatch(p);
      });
      row.appendChild(cb);
    }
    return row;
  }

  function createBindingRow(node: GraphNode, binding: TargetBinding): HTMLElement {
    const def = getDef(node.type);
    const row = document.createElement('div');
    row.className = 'rw-graph-binding';

    const tgtSel = document.createElement('select');
    tgtSel.className = 'rw-select';
    for (const t of TARGETS) {
      const o = document.createElement('option');
      o.value = t.v as string; o.textContent = t.l;
      tgtSel.appendChild(o);
    }
    tgtSel.value = binding.paramKey;
    tgtSel.addEventListener('change', () => mutateBinding(binding.id, (b) => { b.paramKey = tgtSel.value; }));

    const portSel = document.createElement('select');
    portSel.className = 'rw-select';
    for (const out of def?.outputs ?? [{ name: 'out' }]) {
      const o = document.createElement('option');
      o.value = out.name; o.textContent = out.name;
      portSel.appendChild(o);
    }
    portSel.value = binding.sourcePort ?? def?.outputs[0]?.name ?? 'out';
    portSel.addEventListener('change', () => mutateBinding(binding.id, (b) => { b.sourcePort = portSel.value; }));

    const amount = document.createElement('input');
    amount.type = 'number';
    amount.step = '0.01'; amount.min = '-4'; amount.max = '4';
    amount.value = String(binding.amount);
    amount.className = 'rw-num';
    amount.addEventListener('input', () => mutateBinding(binding.id, (b) => { b.amount = +amount.value || 0; }));

    const modeSel = document.createElement('select');
    modeSel.className = 'rw-select';
    for (const m of ['additive', 'multiplicative']) {
      const o = document.createElement('option');
      o.value = m; o.textContent = m;
      modeSel.appendChild(o);
    }
    modeSel.value = binding.mode;
    modeSel.addEventListener('change', () => mutateBinding(binding.id, (b) => { b.mode = modeSel.value as 'additive' | 'multiplicative'; }));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'rw-btn';
    del.textContent = '×';
    del.title = 'Remove binding';
    del.addEventListener('click', () => {
      const p = opts.getPatch();
      p.bindings = p.bindings.filter((b) => b.id !== binding.id);
      opts.setPatch(p);
      setSelected(node);
    });

    row.append(portSel, tgtSel, amount, modeSel, del);
    return row;
  }

  function mutateBinding(id: string, fn: (b: TargetBinding) => void): void {
    const p = opts.getPatch();
    const b = p.bindings.find((x) => x.id === id);
    if (!b) return;
    fn(b);
    opts.setPatch(p);
  }

  return {
    el: root,
    setSelected: (node) => {
      // Avoid pointless rebuild if same node and only param updates landed.
      if (node?.id === currentId) return;
      setSelected(node);
    },
  };
}

function getParam(
  node: GraphNode,
  name: string,
  fallback: number | string | boolean,
): number | string | boolean {
  return node.params[name] ?? fallback;
}
