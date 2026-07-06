/**
 * Advanced node-graph editor.
 *
 * Layout: [palette | canvas (cables + nodes) | inspector].
 *
 * Nodes are absolute-positioned DOM elements; cables are drawn on a
 * single `<canvas>` (`CableLayer`) overlapping the canvas region. Pan /
 * zoom are not (yet) implemented at the canvas level — nodes are
 * draggable, the canvas auto-sizes to its host. A future pass can add
 * pan/zoom by translating the canvas-coordinate space.
 *
 * Patching:
 *   - Click an output port to start a cable; click an input port to drop.
 *   - Click an existing input port circle to disconnect.
 *   - Right-click a node to delete (also Backspace when focused).
 *   - Drag a node by its header.
 *
 * All drag/drop behaviors have keyboard equivalents (focus + arrows +
 * Enter / Backspace) for accessibility and touch parity.
 */

import { GraphNode, GraphPatch, NodeType } from '../../modulation/graph/types';
import { getDef } from '../../modulation/graph/registry';
import { createPalette } from './palette';
import { createInspector } from './inspector';
import { createCableLayer, CableAnchorResolver } from './CableLayer';
import { openProbeOverlay } from './Probe';
import { PatchSectionDeps } from '../sections/PatchSection';
import type { GraphEngine } from '../../modulation/graph/GraphEngine';

interface InProgressConnection {
  fromNodeId: string;
  fromPort: string;
}

const DEFAULT_NODE_X = 220;
const DEFAULT_NODE_Y = 60;

export function renderAdvancedView(host: HTMLElement, deps: PatchSectionDeps): () => void {
  const root = document.createElement('div');
  root.className = 'rw-graph-advanced';
  host.appendChild(root);

  // ---------- Layout ----------

  const palette = createPalette({ onAdd: addNodeOfType });
  const center = document.createElement('div');
  center.className = 'rw-graph-canvas';
  const cable = createCableLayer();
  center.appendChild(cable.el);
  const nodesLayer = document.createElement('div');
  nodesLayer.className = 'rw-graph-nodes-layer';
  center.appendChild(nodesLayer);
  const inspector = createInspector({
    getPatch: () => clone(currentPatch()),
    setPatch: (p, setOpts) => writePatch(p, setOpts),
    onProbe: (id, port) => openProbe(id, port),
    isProbing: () => probing,
    getVideoTap: () => deps.getVideoTap?.() ?? null,
  });
  root.append(palette, center, inspector.el);

  // Toolbar overlay (delete / clear / probe-toggle / patch-empty).
  const toolbar = document.createElement('div');
  toolbar.className = 'rw-graph-canvas-toolbar';
  const probeBtn = document.createElement('button');
  probeBtn.type = 'button';
  probeBtn.className = 'rw-btn';
  probeBtn.textContent = 'Probe';
  probeBtn.title = 'Click then pick a cable to scope it';
  let probing = false;
  probeBtn.addEventListener('click', () => {
    probing = !probing;
    probeBtn.classList.toggle('active', probing);
    center.classList.toggle('probing', probing);
  });
  toolbar.appendChild(probeBtn);

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'rw-btn';
  clearBtn.textContent = 'Clear';
  clearBtn.title = 'Delete all nodes and bindings';
  clearBtn.addEventListener('click', () => {
    if (!confirm('Clear the entire patch?')) return;
    writePatch({ nodes: [], bindings: [] });
  });
  toolbar.appendChild(clearBtn);
  center.appendChild(toolbar);

  // ---------- State ----------

  let pending: InProgressConnection | null = null;
  let selectedId: string | null = null;
  let dragging: { id: string; offsetX: number; offsetY: number } | null = null;
  let engine: GraphEngine | null = null;
  void deps.getEngine().then((e) => { engine = e; });

  function currentPatch(): GraphPatch {
    return deps.settings.get('modGraph') ?? { nodes: [], bindings: [] };
  }

  /**
   * Set to `true` for the synchronous duration of a continuous-input write
   * (slider drag, numeric typing) so the `modGraph` subscription below
   * doesn't tear down and rebuild the inspector mid-gesture — which would
   * kill the slider's pointer capture and make it un-draggable.
   */
  let suppressRender = false;

  function writePatch(next: GraphPatch, opts: { skipRerender?: boolean } = {}): void {
    if (opts.skipRerender) suppressRender = true;
    try {
      deps.settings.set('modGraph', next);
      void deps.getEngine().then((e) => e.setPatch(next));
    } finally {
      if (opts.skipRerender) suppressRender = false;
    }
  }

  // ---------- Anchors / cable resolver ----------

  const resolver: CableAnchorResolver = {
    inputAnchor(nodeId, port) { return getPortAnchor(nodeId, port, 'in'); },
    outputAnchor(nodeId, port) { return getPortAnchor(nodeId, port, 'out'); },
  };

  function getPortAnchor(nodeId: string, port: string, side: 'in' | 'out'): { x: number; y: number } | null {
    const el = nodesLayer.querySelector<HTMLElement>(`[data-node-id="${nodeId}"] [data-port="${port}"][data-side="${side}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cr = center.getBoundingClientRect();
    return { x: r.left + r.width / 2 - cr.left, y: r.top + r.height / 2 - cr.top };
  }

  // ---------- Render ----------

  function render(): void {
    const patch = currentPatch();
    nodesLayer.innerHTML = '';
    for (const node of patch.nodes) nodesLayer.appendChild(renderNode(node));
    sizeCanvas();
    cable.requestRedraw(patch, resolver);
    const sel = patch.nodes.find((n) => n.id === selectedId) ?? null;
    inspector.setSelected(sel);
    if (patch.nodes.length === 0) showEmptyHint(); else hideEmptyHint();
  }

  function showEmptyHint(): void {
    if (center.querySelector('.rw-graph-empty-hint')) return;
    const hint = document.createElement('div');
    hint.className = 'rw-graph-empty-hint rw-mod-graph-empty';
    hint.textContent = 'Click a node in the palette to start patching.';
    center.appendChild(hint);
  }

  function hideEmptyHint(): void {
    center.querySelector('.rw-graph-empty-hint')?.remove();
  }

  function renderNode(node: GraphNode): HTMLElement {
    const def = getDef(node.type);
    if (!def) {
      const el = document.createElement('div');
      el.className = 'rw-graph-node rw-graph-node--unknown';
      el.textContent = `Unknown: ${node.type}`;
      return el;
    }
    const el = document.createElement('div');
    el.className = `rw-graph-node rw-graph-node--${def.category.toLowerCase()}`;
    el.dataset.nodeId = node.id;
    el.tabIndex = 0;
    const pos = node.position ?? { x: DEFAULT_NODE_X, y: DEFAULT_NODE_Y };
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    if (node.id === selectedId) el.classList.add('selected');
    if (node.enabled === false) el.classList.add('rw-graph-node--muted');

    const head = document.createElement('div');
    head.className = 'rw-graph-node-head';
    head.textContent = def.label;
    head.title = def.description;
    el.appendChild(head);

    const body = document.createElement('div');
    body.className = 'rw-graph-node-body';
    const ins = document.createElement('div');
    ins.className = 'rw-graph-node-ports rw-graph-node-ins';
    for (const p of def.inputs) ins.appendChild(portDot(node.id, p.name, 'in', p.kind));
    const outs = document.createElement('div');
    outs.className = 'rw-graph-node-ports rw-graph-node-outs';
    for (const p of def.outputs) outs.appendChild(portDot(node.id, p.name, 'out', p.kind));
    body.append(ins, outs);
    el.appendChild(body);

    // Selection / focus
    el.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('.rw-graph-port-dot')) return;
      selectedId = node.id;
      render();
      // Header-only drag.
      if ((e.target as HTMLElement).closest('.rw-graph-node-head')) {
        const r = el.getBoundingClientRect();
        dragging = {
          id: node.id,
          offsetX: e.clientX - r.left,
          offsetY: e.clientY - r.top,
        };
        e.preventDefault();
      }
    });
    el.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 20 : 6;
      const cur = currentPatch();
      const target = cur.nodes.find((n) => n.id === node.id);
      if (!target) return;
      if (e.key === 'ArrowLeft')  { (target.position ??= { x: 0, y: 0 }).x -= step; e.preventDefault(); writePatch(cur); }
      if (e.key === 'ArrowRight') { (target.position ??= { x: 0, y: 0 }).x += step; e.preventDefault(); writePatch(cur); }
      if (e.key === 'ArrowUp')    { (target.position ??= { x: 0, y: 0 }).y -= step; e.preventDefault(); writePatch(cur); }
      if (e.key === 'ArrowDown')  { (target.position ??= { x: 0, y: 0 }).y += step; e.preventDefault(); writePatch(cur); }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        deleteNode(node.id);
      }
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (confirm(`Delete node "${def.label}"?`)) deleteNode(node.id);
    });

    return el;
  }

  function portDot(nodeId: string, port: string, side: 'in' | 'out', kind: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = `rw-graph-port rw-graph-port--${side}`;
    const dot = document.createElement('span');
    dot.className = `rw-graph-port-dot rw-graph-port-dot--${kind}`;
    dot.dataset.port = port;
    dot.dataset.side = side;
    const label = document.createElement('span');
    label.className = 'rw-graph-port-label';
    label.textContent = port;
    if (side === 'in') wrap.append(dot, label);
    else                wrap.append(label, dot);

    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      handlePortClick(nodeId, port, side);
    });
    return wrap;
  }

  // ---------- Interaction ----------

  function handlePortClick(nodeId: string, port: string, side: 'in' | 'out'): void {
    if (probing && side === 'out') {
      openProbe(nodeId, port);
      return;
    }
    if (side === 'out') {
      pending = { fromNodeId: nodeId, fromPort: port };
      center.classList.add('connecting');
      return;
    }
    // Input clicked.
    if (!pending) {
      // Disconnect existing edge by setting input to null.
      const cur = currentPatch();
      const node = cur.nodes.find((n) => n.id === nodeId);
      if (node && node.inputs[port]) { node.inputs[port] = null; writePatch(cur); }
      return;
    }
    const cur = currentPatch();
    const node = cur.nodes.find((n) => n.id === nodeId);
    if (node) node.inputs[port] = pending.fromNodeId;
    writePatch(cur);
    pending = null;
    center.classList.remove('connecting');
  }

  function deleteNode(id: string): void {
    const cur = currentPatch();
    cur.nodes = cur.nodes.filter((n) => n.id !== id);
    for (const n of cur.nodes) for (const k of Object.keys(n.inputs)) {
      if (n.inputs[k] === id) n.inputs[k] = null;
    }
    cur.bindings = cur.bindings.filter((b) => b.sourceNodeId !== id);
    if (selectedId === id) selectedId = null;
    writePatch(cur);
  }

  function addNodeOfType(type: NodeType): void {
    const def = getDef(type);
    if (!def) return;
    const cur = currentPatch();
    const id = `n${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    const inputs: Record<string, string | null> = {};
    for (const p of def.inputs) inputs[p.name] = null;
    cur.nodes.push({
      id, type, params: {},
      inputs,
      position: { x: DEFAULT_NODE_X + cur.nodes.length * 12, y: DEFAULT_NODE_Y + cur.nodes.length * 12 },
    });
    selectedId = id;
    writePatch(cur);
  }

  function openProbe(nodeId: string, port: string): void {
    if (!engine) return;
    openProbeOverlay(center, {
      engine, nodeId, port,
      onClose: () => {
        probing = false;
        probeBtn.classList.remove('active');
        center.classList.remove('probing');
      },
    });
  }

  // ---------- Drag / resize wiring ----------

  function onMouseMove(e: MouseEvent): void {
    if (!dragging) return;
    const cur = currentPatch();
    const node = cur.nodes.find((n) => n.id === dragging!.id);
    if (!node) return;
    const cr = nodesLayer.getBoundingClientRect();
    node.position = {
      x: Math.max(0, e.clientX - cr.left - dragging.offsetX),
      y: Math.max(0, e.clientY - cr.top - dragging.offsetY),
    };
    writePatch(cur);
  }
  function onMouseUp(): void { dragging = null; }
  // Attach to the view's own document at wire-up time AND re-attach if
  // the panel is adopted into the popout window (PanelPopout) — module-
  // scope `document` would stop receiving events there. The `attachDocs`
  // set tracks which documents already have the listeners.
  const attachedDocs = new WeakSet<Document>();
  function attachDocListeners(doc: Document): void {
    if (attachedDocs.has(doc)) return;
    attachedDocs.add(doc);
    doc.addEventListener('mousemove', onMouseMove);
    doc.addEventListener('mouseup', onMouseUp);
    doc.addEventListener('keydown', onKey);
  }

  // Cancel pending connection on Esc.
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && pending) {
      pending = null;
      center.classList.remove('connecting');
    }
  }
  attachDocListeners(document);
  // Lazily cover the popout case: any mousedown inside the view ensures
  // its CURRENT owner document has the listeners.
  root.addEventListener('mousedown', () => attachDocListeners(root.ownerDocument));

  function sizeCanvas(): void {
    const r = center.getBoundingClientRect();
    cable.resize(r.width, r.height);
  }
  const ro = new ResizeObserver(() => sizeCanvas());
  ro.observe(center);

  cable.start();
  const unsubscribe = deps.settings.subscribe('modGraph', () => {
    if (suppressRender) return;
    render();
  });

  return () => {
    cable.stop();
    ro.disconnect();
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('keydown', onKey);
    unsubscribe();
    root.remove();
  };
}

function clone(p: GraphPatch): GraphPatch {
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
