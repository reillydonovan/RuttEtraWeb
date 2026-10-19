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
import { LiveValuesStore } from '../LiveValues';
import { applyOutputStage, OutputStageParams } from '../outputStage';
import './bootstrap';
import { allDefs, getDef } from './registry';
import { topoSort } from './topo';
import {
  CompiledNode, CompiledPatch, CurveType, GraphPatch,
  NodeContext, NodeDeps, TargetBinding, splitInputRef,
} from './types';

export interface GraphEngineDeps extends NodeDeps {
  /**
   * Required for the new "base + mod" architecture. The graph engine
   * pushes per-frame contributions into the 'graph' namespace of the
   * shared `LiveValuesStore`; it never writes directly to `Settings`.
   */
  liveValues: LiveValuesStore;
}

const ENGINE_ID = 'graph';

export class GraphEngine {
  private compiled: CompiledPatch | null = null;
  private patch: GraphPatch = { nodes: [], bindings: [] };
  private joystick = { x: 0, y: 0, z: 0 };
  private startTime = performance.now() / 1000;
  private frame = 0;
  private deps: NodeDeps;
  private liveValues: LiveValuesStore;
  /** Dev-mode hint: log a one-shot warning the first time we hit a cycle. */
  private warnedAboutCycle = false;

  constructor(private settings: SettingsStore, deps: GraphEngineDeps) {
    // Strip the LiveValuesStore out of `deps` before passing as NodeDeps —
    // graph nodes don't get the store itself, only the engine does. The
    // one sanctioned window into it is the read-only `paramLive` hook
    // (see NodeDeps docs): the `param-out` node reads a param's live
    // value as a signal, one frame behind, never writes.
    const { liveValues, ...nodeDeps } = deps;
    this.deps = { ...nodeDeps };
    this.liveValues = liveValues;
    this.deps.paramLive = (key) => liveValues.getLive(key);
  }

  // -------------------- public API --------------------

  /**
   * Replace the patch. Re-sorts topology. A node that is still there (same id and
   * type) keeps its running state and last outputs, so an edit — an Amount knob turn,
   * a param tweak — doesn't restart its LFO phase: re-initializing on every write
   * made the raster jump on each knob tick. State is rebuilt only for new nodes, a
   * changed type, or a node whose init reads params that changed (e.g. Delay's
   * frame count). If `patch` is null the engine clears and `tick` is a no-op.
   */
  setPatch(patch: GraphPatch | null): void {
    if (!patch || patch.nodes.length === 0) {
      this.compiled = null;
      this.patch = { nodes: [], bindings: [] };
      return;
    }
    this.patch = patch;
    this.compiled = compile(patch, this.compiled);
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

  /**
   * Legacy no-op kept so existing UI callsites compile. With the new
   * base/live architecture, `Settings` always IS the base — there is no
   * per-engine cached base anymore. Live values are recomputed each
   * frame from `Settings.get(key) + sum(offsets)`.
   */
  recaptureBase(_paramKey: string): void { /* no-op since v9 */ }

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

  /** Set of param keys this engine is currently writing. Disabled
   *  bindings are excluded so their activity LEDs go dark. */
  getActiveTargets(): Set<string> {
    return new Set(
      this.patch.bindings.filter((b) => b.enabled !== false).map((b) => b.paramKey),
    );
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
   *
   * v9 base/live split: never writes to `Settings`. Each frame we compute
   * additive offsets and multiplicative factors per param, then push them
   * into `LiveValuesStore` under namespace 'graph' via `setContributions`.
   * Keys that drop out of the binding set (or whose Amount is zero, or
   * whose source signal is zero) are CLEARED that frame — no stickiness.
   */
  tick(dt: number): void {
    const mode = this.settings.get('modMode');
    if (mode === 'classic' || mode == null) {
      // Bus stays empty so the activity LEDs go dark; clear our
      // namespace so any stale offsets snap back to base immediately.
      this.liveValues.setContributions(ENGINE_ID);
      activeTargetsBus.publish(ENGINE_ID, new Set());
      return;
    }
    if (!this.compiled) {
      this.liveValues.setContributions(ENGINE_ID);
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
      // v17: muted node — skip its tick entirely; every output reads 0 so
      // downstream nodes and bindings see silence. State is retained, so
      // re-enabling resumes (LFO phase etc. simply kept advancing from
      // wherever init left it — deterministic and cheap).
      if (cn.node.enabled === false) {
        for (const k of Object.keys(cn.outputs)) cn.outputs[k] = 0;
        continue;
      }
      // Build inputs map. v25: refs may be `nodeId#port` — split once
      // and read the named output (default 'out').
      for (const port of Object.keys(cn.node.inputs)) {
        const ref = cn.node.inputs[port];
        if (!ref) { inputBuf[port] = 0; continue; }
        const { nodeId: fromId, port: srcPort } = splitInputRef(ref);
        const isCycleEdge = this.compiled.cycleEdges.some(
          (e) => e.from === fromId && e.to === id && e.toPort === port,
        );
        const src = this.compiled.byId.get(fromId);
        if (!src) { inputBuf[port] = 0; continue; }
        const out = isCycleEdge ? src.prevOutputs : src.outputs;
        // Plain-id refs mean "the source's default (first) output" — the
        // same convention the editor uses when writing refs.
        const fallback = src.def.outputs[0]?.name ?? 'out';
        inputBuf[port] = sanitize(out[srcPort ?? fallback] ?? out[fallback] ?? 0);
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

    // 2. Apply bindings -> live offsets/factors.
    //    Note: Output node has NO state. Every binding evaluates from
    //    scratch from its current upstream signal — when amount is 0 or
    //    the upstream is silent, the contribution is exactly 0, never a
    //    cached "last value".
    const offsets = new Map<string, number>();
    const factors = new Map<string, number>();
    for (const b of this.compiled.bindings) {
      // v17: muted binding — contributes nothing; the same-frame
      // setContributions clear snaps its target back to base.
      if (b.enabled === false) continue;
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

      // CV-output target: encoded as `cv:<channelIndex>` instead of a
      // Settings key. Don't push into `LiveValuesStore` (it's not a
      // synth param) — route to the CV-output subsystem instead. The
      // standalone `cv-output` graph node provides the same path for
      // node-driven outputs; this branch handles the Beginner-view
      // case where the user picked "CV Out: Ch N" as a binding Target.
      if (b.paramKey.startsWith('cv:')) {
        const ch = Number.parseInt(b.paramKey.slice(3), 10);
        if (Number.isFinite(ch) && this.deps.cvOut) {
          this.deps.cvOut.setGraphSource(ch, shaped * b.amount);
        }
        continue;
      }

      if (b.mode === 'multiplicative') {
        const f = factors.get(b.paramKey) ?? 1;
        factors.set(b.paramKey, f * (1 + shaped * b.amount));
      } else {
        offsets.set(b.paramKey, (offsets.get(b.paramKey) ?? 0) + shaped * b.amount);
      }
    }

    // Push BOTH maps in one shot. Anything not in this set is cleared
    // for the 'graph' namespace right now — no stale values, no
    // stickiness. This is the bug fix.
    this.liveValues.setContributions(ENGINE_ID, offsets, factors);

    activeTargetsBus.publish(ENGINE_ID, this.getActiveTargets());
    this.lastTickMs = performance.now() - tickStart;
  }

  // -------------------- internals --------------------
}

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

function compile(patch: GraphPatch, prev: CompiledPatch | null = null): CompiledPatch {
  const byId = new Map<string, CompiledNode>();
  for (const n of patch.nodes) {
    const def = getDef(n.type);
    if (!def) {
      // eslint-disable-next-line no-console
      console.warn(`[graph] unknown node type "${n.type}"; skipping`);
      continue;
    }
    const params = withParamDefaults(def, n.params);
    const old = prev?.byId.get(n.id);
    if (old && canKeepState(old, n.type, def, params)) {
      byId.set(n.id, { node: { ...n, params }, def, state: old.state, outputs: old.outputs, prevOutputs: old.prevOutputs });
      continue;
    }
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

/** A node's running state survives a patch write when it is the same node: same type,
 *  and either its init ignores params (`init()` takes none) or the params are unchanged. */
function canKeepState(
  old: CompiledNode,
  type: string,
  def: { init: (...a: never[]) => unknown; outputs: { name: string }[] },
  params: Record<string, number | string | boolean>,
): boolean {
  if (old.node.type !== type || old.def !== def) return false;
  if (def.outputs.some((p) => !(p.name in old.outputs))) return false;
  if (def.init.length === 0) return true;
  const a = old.node.params, keys = new Set([...Object.keys(a), ...Object.keys(params)]);
  for (const k of keys) if (a[k] !== params[k]) return false;
  return true;
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

// Re-export for tests / engine consumers that don't want to pull from registry.
export { allDefs };
