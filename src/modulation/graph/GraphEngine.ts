/**
 * Signal-graph modulation engine.
 *
 * Runs alongside `ModMatrix` (existing 4-slot matrix). Both engines write
 * to the same Settings params; their effects sum. The Classic engine is
 * unchanged; the Graph engine is gated by `settings.modMode` and only
 * does work when the mode is `'graph'` or `'both'`.
 *
 * Per-frame flow:
 *   1. Sort nodes topologically (cached). Cycle edges read prev-frame
 *      values, giving feedback patches a one-frame delay.
 *   2. Walk nodes in order, gather inputs, call `def.tick()`, store
 *      outputs.
 *   3. For each binding: read `node.outputs[port]`, apply curve + amount,
 *      sum into a per-target accumulator, then write final values to
 *      `Settings` in a single batch.
 *
 * The engine never mutates the graph itself — `setPatch()` is the only
 * way to change topology. Param edits in the inspector mutate the patch
 * via `setPatch(updatedClone)`.
 */

import { OutputCurve, SettingsStore } from '../../state/Settings';
import { activeTargetsBus } from '../ActiveTargetsBus';
import { applyOutputStage, OutputStageParams } from '../outputStage';
import './bootstrap';
import { allDefs, getDef } from './registry';
import { topoSort } from './topo';
import {
  CompiledNode, CompiledPatch, CurveType, GraphPatch,
  NodeContext, NodeDeps, TargetBinding,
} from './types';

export interface GraphEngineDeps extends NodeDeps {}

const ENGINE_ID = 'graph';

export class GraphEngine {
  private compiled: CompiledPatch | null = null;
  private patch: GraphPatch = { nodes: [], bindings: [] };
  private bases = new Map<string, number>();
  /** ParamKeys we've already wired a `subscribe()` listener on. */
  private baseSubscribed = new Set<string>();
  /**
   * True while `tick()` is calling `settings.batchUpdate()` to apply
   * binding outputs. Used by the base-capture subscription to ignore
   * self-writes — only external writes (slider drag, preset apply, MIDI
   * in, sequencer keyframe) should update the manual base.
   */
  private writingFromTick = false;
  private joystick = { x: 0, y: 0, z: 0 };
  private startTime = performance.now() / 1000;
  private frame = 0;
  private deps: NodeDeps;
  /** Dev-mode hint: log a one-shot warning the first time we hit a cycle. */
  private warnedAboutCycle = false;

  constructor(private settings: SettingsStore, deps: GraphEngineDeps = {}) {
    this.deps = { ...deps };
    this.installBaseCapture();
  }

  // -------------------- public API --------------------

  /**
   * Replace the patch. Re-sorts topology and re-initializes per-node
   * state. If `patch` is null the engine clears and `tick` is a no-op.
   */
  setPatch(patch: GraphPatch | null): void {
    if (!patch || patch.nodes.length === 0) {
      this.compiled = null;
      this.patch = { nodes: [], bindings: [] };
      return;
    }
    this.patch = patch;
    this.compiled = compile(patch);
    // Re-capture bases on every `setPatch`. The user may have manually
    // moved a slider since the last patch, so the previous base is
    // probably stale. Tests rely on this behavior; production callers
    // get a fresh "current value of the slider" capture too.
    this.bases.clear();
    for (const b of patch.bindings) {
      if (!this.bases.has(b.paramKey)) {
        const v = this.settings.get(b.paramKey as never) as unknown;
        if (typeof v === 'number') this.bases.set(b.paramKey, v);
      }
      this.subscribeBase(b.paramKey);
    }
    if (this.compiled.cycleEdges.length > 0 && !this.warnedAboutCycle) {
      this.warnedAboutCycle = true;
      // eslint-disable-next-line no-console
      console.info(
        `[graph] feedback loop detected (${this.compiled.cycleEdges.length} edge(s)); using one-frame delay`,
      );
    }
  }

  getPatch(): GraphPatch {
    return this.patch;
  }

  setVideoTap(tap: NodeDeps['videoTap']): void {
    this.deps.videoTap = tap ?? null;
  }

  setJoystick(x: number, y: number, z: number): void {
    this.joystick.x = x;
    this.joystick.y = y;
    this.joystick.z = z;
  }

  /** Force-refresh a target's manual base value (called from UI on user edit). */
  recaptureBase(paramKey: string): void {
    const v = this.settings.get(paramKey as never) as unknown;
    if (typeof v === 'number') this.bases.set(paramKey, v);
  }

  /**
   * Return the most-recent value of `nodeId.port`. Used by the Probe
   * tool. Returns 0 if the node or port doesn't exist.
   */
  probe(nodeId: string, port = 'out'): number {
    const c = this.compiled?.byId.get(nodeId);
    if (!c) return 0;
    const v = c.outputs[port];
    return v == null ? 0 : v;
  }

  /** Set of param keys this engine is currently writing. */
  getActiveTargets(): Set<string> {
    return new Set(this.patch.bindings.map((b) => b.paramKey));
  }

  /** Last `tick()` wall-clock duration in milliseconds. Used by the debug overlay. */
  lastTickMs = 0;

  /** Topology stats for the debug overlay. */
  stats(): { nodeCount: number; tickMs: number; cycleEdges: number } {
    return {
      nodeCount: this.patch.nodes.length,
      tickMs: this.lastTickMs,
      cycleEdges: this.compiled?.cycleEdges.length ?? 0,
    };
  }

  /**
   * Step the graph by `dt` seconds. Called once per frame from the main
   * render loop AFTER `matrix.tick()`. No-ops when mode is `'classic'`.
   */
  tick(dt: number): void {
    const mode = this.settings.get('modMode');
    if (mode === 'classic' || mode == null) {
      // Still publish (empty) targets so the bus reflects the disabled state.
      activeTargetsBus.publish(ENGINE_ID, new Set());
      return;
    }
    if (!this.compiled) {
      activeTargetsBus.publish(ENGINE_ID, new Set());
      this.lastTickMs = 0;
      return;
    }

    const tickStart = performance.now();
    const safeDt = clampDt(dt);
    // Refresh the shared BPM each frame so the Clock node sees the
    // current `Settings.internalBpm` without subscribing to it.
    this.deps.bpm = this.settings.get('internalBpm');
    const ctx: NodeContext = {
      timeSec: performance.now() / 1000 - this.startTime,
      dt: safeDt,
      frame: this.frame++,
      deps: this.deps,
      joystick: this.joystick,
    };

    // 1. Walk nodes in topological order.
    for (const id of this.compiled.order) {
      const cn = this.compiled.byId.get(id);
      if (!cn) continue;
      // Snapshot last frame's outputs so cycle peers can read them.
      cn.prevOutputs = { ...cn.outputs };
    }
    const inputBuf: Record<string, number> = {};
    for (const id of this.compiled.order) {
      const cn = this.compiled.byId.get(id);
      if (!cn) continue;
      // Build inputs map.
      for (const port of Object.keys(cn.node.inputs)) {
        const fromId = cn.node.inputs[port];
        if (!fromId) { inputBuf[port] = 0; continue; }
        const isCycleEdge = this.compiled.cycleEdges.some(
          (e) => e.from === fromId && e.to === id && e.toPort === port,
        );
        const src = this.compiled.byId.get(fromId);
        if (!src) { inputBuf[port] = 0; continue; }
        const portRef = parseSourcePort(cn.node.inputs, fromId, port) ?? 'out';
        const out = isCycleEdge ? src.prevOutputs : src.outputs;
        inputBuf[port] = sanitize(out[portRef] ?? out['out'] ?? 0);
      }
      // Reset outputs map and tick.
      for (const k of Object.keys(cn.outputs)) cn.outputs[k] = 0;
      try {
        cn.def.tick(ctx, cn.state, inputBuf, cn.node.params, cn.outputs);
      } catch (err) {
        // Defensive: a buggy node mustn't kill the engine.
        for (const k of Object.keys(cn.outputs)) cn.outputs[k] = 0;
        // eslint-disable-next-line no-console
        console.warn(`[graph] node "${cn.node.type}" (${id}) threw`, err);
      }
      // Sanitize outputs in-place.
      for (const k of Object.keys(cn.outputs)) cn.outputs[k] = sanitize(cn.outputs[k]);
      // Clear inputBuf keys so the next node starts clean.
      for (const k of Object.keys(inputBuf)) delete inputBuf[k];
    }

    // 2. Apply bindings -> Settings (batched).
    const sums = new Map<string, number>();
    const factors = new Map<string, number>();
    for (const b of this.compiled.bindings) {
      const src = this.compiled.byId.get(b.sourceNodeId);
      if (!src) continue;
      const port = b.sourcePort ?? 'out';
      const raw = sanitize(src.outputs[port] ?? src.outputs['out'] ?? 0);
      // Apply the shared output stage. Same five fields and same math
      // as Classic ModSlot output stage (curve -> invert -> range ->
      // offset). When the binding has none of these set the call is the
      // identity transform, preserving pre-Stage-3 behaviour.
      let shaped = applyOutputStage(raw, bindingOutputStage(b));
      // Legacy `curve` field still applies if present and `outputCurve`
      // wasn't set — old presets keep working.
      if (b.curve && !b.outputCurve) shaped = applyLegacyCurve(shaped, b.curve);
      if (b.mode === 'multiplicative') {
        const f = factors.get(b.paramKey) ?? 1;
        factors.set(b.paramKey, f * (1 + shaped * b.amount));
      } else {
        sums.set(b.paramKey, (sums.get(b.paramKey) ?? 0) + shaped * b.amount);
      }
    }

    const patch: Record<string, number> = {};
    const touched = new Set<string>();
    for (const [paramKey, sum] of sums) {
      const base = this.bases.get(paramKey);
      if (base == null) continue;
      patch[paramKey] = base + sum;
      touched.add(paramKey);
    }
    for (const [paramKey, factor] of factors) {
      const base = this.bases.get(paramKey);
      if (base == null) continue;
      patch[paramKey] = (touched.has(paramKey) ? patch[paramKey] : base) * factor;
      touched.add(paramKey);
    }
    if (Object.keys(patch).length > 0) {
      this.writingFromTick = true;
      try {
        this.settings.batchUpdate(patch as never);
      } finally {
        this.writingFromTick = false;
      }
    }

    activeTargetsBus.publish(ENGINE_ID, this.getActiveTargets());
    this.lastTickMs = performance.now() - tickStart;
  }

  // -------------------- internals --------------------

  /**
   * Watch for new bindings to capture the user's manual base value, and
   * detect when the user drives a slider directly so we treat that as a
   * new base (matches `ModMatrix.installBaseCapture`).
   *
   * Per-target subscriptions are wired lazily inside `setPatch()`; this
   * hook stays for symmetry with `ModMatrix` and as a future seam.
   */
  private installBaseCapture(): void {
    // Intentionally empty — per-paramKey subscriptions are added in
    // `setPatch()` via `subscribeBase()`.
  }

  /**
   * Subscribe once per paramKey so external writes (slider drag, preset
   * apply, MIDI in) refresh the manual base. Self-writes from `tick()`
   * are gated by `writingFromTick`.
   */
  private subscribeBase(paramKey: string): void {
    if (this.baseSubscribed.has(paramKey)) return;
    this.baseSubscribed.add(paramKey);
    this.settings.subscribe(paramKey as never, (v: unknown) => {
      if (this.writingFromTick) return;
      if (typeof v === 'number') this.bases.set(paramKey, v);
    });
  }
}

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

function compile(patch: GraphPatch): CompiledPatch {
  const byId = new Map<string, CompiledNode>();
  for (const n of patch.nodes) {
    const def = getDef(n.type);
    if (!def) {
      // eslint-disable-next-line no-console
      console.warn(`[graph] unknown node type "${n.type}"; skipping`);
      continue;
    }
    const params = withParamDefaults(def, n.params);
    const outputs: Record<string, number> = {};
    for (const p of def.outputs) outputs[p.name] = 0;
    byId.set(n.id, {
      node: { ...n, params },
      def,
      state: def.init(params),
      outputs,
      prevOutputs: { ...outputs },
    });
  }
  const t = topoSort(patch);
  // Filter order to only known nodes (skip unknowns we dropped above).
  const order = t.order.filter((id) => byId.has(id));
  // Bindings to unknown nodes are dropped silently.
  const bindings = patch.bindings.filter((b) => byId.has(b.sourceNodeId));
  return { byId, order, cycleEdges: t.cycleEdges, bindings };
}

function withParamDefaults(
  def: { params: Record<string, { default: number | string | boolean }> },
  given: Record<string, number | string | boolean>,
): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const [k, spec] of Object.entries(def.params)) {
    out[k] = given[k] ?? spec.default;
  }
  // Preserve any extras the patch put on the node — useful for forward-compat
  // and for region rects on video nodes.
  for (const [k, v] of Object.entries(given)) {
    if (!(k in out)) out[k] = v;
  }
  return out;
}

function sanitize(v: number): number {
  if (!Number.isFinite(v)) return 0;
  // Crush absolute denormals to 0; helps avoid very-small non-zero
  // accumulators silently growing.
  if (Math.abs(v) < 1e-30) return 0;
  return v;
}

function clampDt(dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) return 1 / 60;
  return Math.min(dt, 0.5);
}

/**
 * Legacy per-binding curve from the v1 graph patch format. Kept so old
 * saved patches still load. New code uses the shared output stage via
 * `applyOutputStage()` from `src/modulation/outputStage.ts`.
 */
function applyLegacyCurve(v: number, curve: CurveType | undefined): number {
  if (!curve || curve === 'linear') return v;
  if (curve === 'exp') return Math.sign(v) * Math.pow(Math.abs(v), 2);
  if (curve === 'log') return Math.sign(v) * Math.sqrt(Math.abs(v));
  if (curve === 'sCurve') {
    const t = clamp01(Math.abs(v));
    return Math.sign(v) * (t * t * (3 - 2 * t));
  }
  return v;
}

/**
 * Pull the output-stage-shaped subset out of a `TargetBinding`. Bindings
 * without any output-stage fields produce a `null`, which `applyOutputStage`
 * treats as identity.
 */
function bindingOutputStage(b: TargetBinding): Partial<OutputStageParams> | null {
  if (
    b.outputCurve === undefined &&
    b.outputMin === undefined &&
    b.outputMax === undefined &&
    b.outputOffset === undefined &&
    b.outputInvert === undefined
  ) return null;
  return {
    outputCurve:  b.outputCurve as OutputCurve | undefined,
    outputMin:    b.outputMin,
    outputMax:    b.outputMax,
    outputOffset: b.outputOffset,
    outputInvert: b.outputInvert,
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * The patch stores `inputs[toPort] = fromNodeId` (single string, not
 * `nodeId.port`). For multi-output sources we'll still default to `'out'`.
 * If we later allow `"nodeId#port"` syntax this is the lookup point.
 */
function parseSourcePort(
  inputs: Record<string, string | null>,
  fromId: string,
  toPort: string,
): string | null {
  const ref = inputs[toPort];
  if (!ref || ref === fromId) return null;
  // Future: allow `nodeId#portName` syntax.
  const hash = ref.indexOf('#');
  if (hash > 0 && ref.slice(0, hash) === fromId) return ref.slice(hash + 1);
  return null;
}

// Re-export for tests / engine consumers that don't want to pull from registry.
export { allDefs };
