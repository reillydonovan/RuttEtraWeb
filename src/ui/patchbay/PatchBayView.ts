/**
 * PATCH BAY — a dedicated spatial view styled as the front panel of the
 * original console ("inspired, not replica"): engraved module fields,
 * every jack always visible at a fixed position, gravity-sagged cables.
 * Hosts in any workspace region (Phase 2's view registry).
 *
 * Layout (patchbayLayout.ts, pure/tested):
 *   left rail    4 × FUNCTION GENERATOR modules (the Classic slots) +
 *                the SOURCES signal field + CV OUT + GRAPH ENGINE chip
 *   column 1     DCU fields, the manual's brochure sub-groups
 *   column 2     Colorizer/Post-FX, Camera, Pattern, Geometry, Audio
 *
 * Interactions (all writes are ordinary patch-data writes):
 *   slot OUT  → param jack   sets modSlots[i].target  (applyCableTarget)
 *   param jack (plugged)     grab to move; drop in space to unplug
 *   param jack (empty)       reverse-drag to a slot OUT
 *   SOURCES jack → SRC IN    sets modSlots[i].source  (applyCableSource)
 *   graph binding cables     drag the param end to re-target, or drop in
 *                            space to unplug — sets bindings[i].paramKey
 *                            (applyGraphBindingTarget) and pushes the
 *                            result live via getEngine().setPatch().
 *   graph node OUT → IN      drag a node's OUT jack onto another active
 *                            node's IN jack to wire it (or the IN jack
 *                            onto an OUT — reverse-drag works either
 *                            way), drop a plugged IN jack in space to
 *                            unplug — sets node.inputs[port]
 *                            (applyNodeInputRef), same live-push via
 *                            setPatch(). A node's OUT jack itself stays
 *                            un-retargetable by dragging (it can feed
 *                            several bindings/inputs at once — grabbing
 *                            it only ever ADDS a new connection, never
 *                            moves/removes an existing one); add new
 *                            bindings, or nodes with no active
 *                            connection yet, from the Graph editor.
 *
 * Unlike the rack skin's overlay there is NO DOM scanning and NO anchor
 * fallback chain — the bay owns its layout, so the jack registry is
 * static and every anchor is a live rect of a known element.
 */

import './patchbay.css';
import '../graph/graph.css';
import type {
  Settings, SettingsStore, ModSlot, ModTarget, ModSource, PatternBlendMode,
  PatternKind, PatternAxis, PatternGradientShape, PatternScopeSourceKind,
} from '../../state/Settings';
import { drawPatchCable, fitCableCanvas } from '../cableDraw';
import { attachTooltip } from '../tooltip';
import { getDef } from '../../modulation/graph/registry';
import { splitInputRef, type GraphPatch, type NodeType } from '../../modulation/graph/types';
import { createPalette } from '../graph/palette';
import { PARAM_DOCS } from '../help/paramDocs';
import { whenLiveValues } from '../liveValueBus';
import type { LiveValuesStore } from '../../modulation/LiveValues';
import { createMiniKnob, type MiniKnob } from './miniKnob';
import {
  classicCables, graphCables, applyCableTarget, applyCableSource,
  slotForParam, nearestJack, rectCenter, Pt,
  graphBindingForParam, applyGraphBindingTarget,
  nodeWires, applyNodeInputRef,
} from '../rack/rackGeometry';
import { buildFaceplate, SOURCE_JACKS } from './patchbayLayout';
import { cvOutputTargets } from '../targets';
import type { VideoSourceManager } from '../../input/sources';
import type { GraphEngine } from '../../modulation/graph/GraphEngine';
import {
  PATTERN_REGISTRY, PATTERN_ORDER, PATTERN_CATEGORY_LABEL, type PatternParamKey,
  AXIS_OPTIONS, GRAD_SHAPE_OPTIONS, SCOPE_SOURCE_OPTIONS, prettyParamLabel,
} from '../../renderer/patterns/PatternRegistry';

const CLASSIC_COLOR   = '#5fff85';
const SOURCE_COLOR    = '#b9ffd0';
const GRAPH_COLOR     = '#5fffd0';
const NODE_WIRE_COLOR = '#ffb347';
const VIDEO_COLOR     = '#c85fff';
const SNAP_PX = 26;

/** Fixed set of video-routing endpoints — Source A/B OUT, Composite's
 *  two INs and one OUT, and the Renderer's one IN. Unlike the
 *  modulation graph's per-node jacks this set never grows, so it's a
 *  literal union rather than a dynamic key scheme. */
type VideoOutKey = 'sourceA-out' | 'sourceB-out' | 'composite-out' | 'dualraster-out';
type VideoInKey = 'composite-inA' | 'composite-inB' | 'dualraster-inA' | 'dualraster-inB' | 'renderer-in';
type VideoJackKey = VideoOutKey | VideoInKey;
type VideoSourceId = 'sourceA' | 'sourceB' | 'composite' | 'dualRaster';

/** Classic waveform sources ↔ graph enum options (LFO `shape`). Lets
 *  the SOURCES bus jacks plug into a node's shape param — drag TRI onto
 *  an LFO's shape jack to get a triangle wave (owner ask). The Classic
 *  source names and LFO shape option names already coincide (`sine`,
 *  `triangle`, `square`, `saw`, `pulse`); `ramp` additionally maps to
 *  `saw` (a ramp IS a rising saw). */
const WAVE_SOURCE_TO_OPTION: Partial<Record<ModSource, string>> = {
  sine: 'sine', triangle: 'triangle', square: 'square', saw: 'saw', ramp: 'saw', pulse: 'pulse',
};
const OPTION_TO_WAVE_SOURCE: Partial<Record<string, ModSource>> = {
  sine: 'sine', triangle: 'triangle', square: 'square', saw: 'saw', pulse: 'pulse',
};
/** An enum param earns a shape jack only when it's genuinely a waveform
 *  picker (≥2 of its options are mappable) — keeps e.g. Ramp's
 *  up/down/triangle/one-shot `mode` from sprouting a misleading jack
 *  just because 'triangle' happens to appear in it. */
function waveShapeMatches(options: readonly string[]): number {
  const mapped = new Set(Object.values(WAVE_SOURCE_TO_OPTION));
  return options.filter((o) => mapped.has(o)).length;
}

/** Parse a `${nodeId}#${port}` jack-registry key (`port` is always a
 *  real declared port name in this registry — see `defaultOutputPort`
 *  for resolving an unset `sourcePort` before building/looking up one).
 *  Node ids never contain '#' (see genId() below), so splitting on the
 *  first occurrence is safe. */
function splitJackKey(key: string): { nodeId: string; port: string } {
  const i = key.indexOf('#');
  return i < 0 ? { nodeId: key, port: '' } : { nodeId: key.slice(0, i), port: key.slice(i + 1) };
}

/** Matches the id format every other graph-editing surface uses
 *  (BeginnerView.ts, AdvancedView.ts) — not shared/exported anywhere,
 *  same small local-helper duplication those files already have. */
function genId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

type JackId =
  | { kind: 'param'; key: string }
  | { kind: 'slotout'; index: number }
  | { kind: 'slotsrc'; index: number }
  | { kind: 'src'; source: ModSource };

export function createPatchBayView(
  settings: SettingsStore,
  source: VideoSourceManager,
  getEngine: () => Promise<GraphEngine>,
  sourceB: VideoSourceManager,
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'rw-patchbay';

  const surface = document.createElement('div');
  surface.className = 'rw-pb-surface';
  root.appendChild(surface);

  // Narrow mode: below ~900px the three deck columns stack vertically
  // so the whole patch stays visible (vertical scroll, no horizontal
  // truncation) — the bay must work in a 400px side window as well as
  // the full center (workspace design system: any view, any window).
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      root.classList.toggle('rw-pb--narrow', w > 0 && w < 900);
    }).observe(root);
  }

  let canvas = document.createElement('canvas');
  canvas.className = 'rw-pb-cables';
  surface.appendChild(canvas);
  let ctx = canvas.getContext('2d');

  // ---------------- jack registry (static — the whole point) ---------
  const paramJacks = new Map<string, HTMLElement>();
  const slotOutJacks = new Map<number, HTMLElement>();
  const slotSrcJacks = new Map<number, HTMLElement>();
  const srcJacks = new Map<ModSource, HTMLElement>();
  /** Direct base-value edit control per faceplate param (owner: "a user
   *  can run the entire synth in the patch bay if they don't want to
   *  use the controls tab") — every faceplate param is numeric by
   *  construction (ModTarget excludes booleans/enums), so this is
   *  always a plain number input. `cv:N` virtual CV-out targets aren't
   *  real Settings keys and don't get one (see addParamCell). */
  const paramValueInputs = new Map<string, HTMLInputElement>();
  /** Rotary knob + amber live readout per faceplate param — the same
   *  base value as the input, RE-4-style (owner reference photo). */
  const paramKnobs = new Map<string, MiniKnob>();
  const paramLiveSpans = new Map<string, HTMLElement>();
  /** Per-param OUT jack (hardware reference: every param row has an
   *  input AND an output) — dragging one onto another param or a node
   *  IN port creates/reuses a `param-out` graph node reading this
   *  param's live value as a signal. */
  const paramOutJacks = new Map<string, HTMLElement>();
  /** Waveform-shape jacks on graph node enum params (`${nodeId}#${param}`). */
  const shapeJacks = new Map<string, HTMLElement>();
  /** Lazily-wired LiveValuesStore handle (display only — never written). */
  let live: LiveValuesStore | null = null;
  whenLiveValues((lv) => { live = lv; });
  /** Graph node IN jacks, keyed `${nodeId}#${port}` (`port` a real
   *  declared input port name) — populated in rebuildGraphModules
   *  alongside the OUT-jack `graphNodeJacks` (declared closer to it). */
  const graphInputJacks = new Map<string, HTMLElement>();
  /** Video routing jacks (owner: "video source should have an output
   *  node and the renderer an input node and there should be a
   *  composite node"). Keyed by fixed endpoint id — only 6 exist, so
   *  (unlike the modulation graph's dynamic node jacks) this is a
   *  small closed set, wired through `videoRendererIn`/
   *  `videoCompositeInA`/`videoCompositeInB` (see applyVideoWire). */
  const videoJacks = new Map<VideoJackKey, HTMLElement>();

  function makeJack(cls: string): HTMLElement {
    const j = document.createElement('span');
    j.className = `rw-rack-jack rw-pb-jack ${cls}`;
    return j;
  }

  // ---------------- drag machinery -----------------------------------
  type Pending =
    | { kind: 'to-param'; slotIndex: number; pos: Pt; hover: string | null }
    | { kind: 'to-slotout'; paramKey: string; pos: Pt; hover: number | null }
    | { kind: 'to-slotsrc'; source: ModSource; pos: Pt; hover: SlotSrcHover }
    | { kind: 'to-param-graph'; bindingId: string; pos: Pt; hover: string | null }
    | { kind: 'to-graphin'; nodeId: string; port: string; pos: Pt; hover: string | null }
    | { kind: 'to-graphout'; sourceKey: string; pos: Pt; hover: GraphOutHover }
    | { kind: 'to-paramout'; paramKey: string; pos: Pt; hover: GraphOutHover }
    | { kind: 'to-shapesrc'; nodeId: string; param: string; pos: Pt; hover: ModSource | null }
    | { kind: 'to-videoin'; outKey: VideoOutKey; pos: Pt; hover: VideoInKey | null }
    | { kind: 'to-videoout'; inKey: VideoInKey; pos: Pt; hover: VideoOutKey | null };
  /** An OUT jack can land on another node's IN jack (wire) OR a faceplate
   *  param jack (binding) — see dragGraphOut / dragParamOut. */
  type GraphOutHover = { kind: 'in'; key: string } | { kind: 'param'; key: string } | null;
  /** A SOURCES bus jack can land on a Classic slot's SRC IN OR a graph
   *  node's waveform-shape jack — see dragSource. */
  type SlotSrcHover = { kind: 'slot'; index: number } | { kind: 'shape'; key: string } | null;
  let pending: Pending | null = null;

  function centersOf<K>(m: Map<K, HTMLElement>): Array<Pt & { id: K }> {
    const out: Array<Pt & { id: K }> = [];
    for (const [id, el] of m) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) out.push({ id, ...rectCenter(r) });
    }
    return out;
  }

  function runGesture(
    ev: PointerEvent,
    grabbed: HTMLElement,
    onMove: (pos: Pt) => void,
    onDrop: () => void,
  ): void {
    ev.preventDefault();
    ev.stopPropagation();
    const doc = root.ownerDocument;
    const id = ev.pointerId;
    grabbed.classList.add('rw-rack-jack--grab');
    root.classList.add('rw-rack-dragging');
    const move = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      e.preventDefault();
      onMove({ x: e.clientX, y: e.clientY });
    };
    const up = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', up);
      doc.removeEventListener('pointercancel', up);
      grabbed.classList.remove('rw-rack-jack--grab');
      root.classList.remove('rw-rack-dragging');
      onDrop();
    };
    doc.addEventListener('pointermove', move, { passive: false });
    doc.addEventListener('pointerup', up);
    doc.addEventListener('pointercancel', up);
  }

  function setHover<K>(m: Map<K, HTMLElement>, prev: K | null, next: K | null): void {
    if (prev !== null && prev !== undefined) m.get(prev)?.classList.remove('rw-rack-jack--hover');
    if (next !== null && next !== undefined) m.get(next)?.classList.add('rw-rack-jack--hover');
  }

  // ---------------- video routing (Source A/B → Composite/Dual Raster
  // → Renderer) — a small closed patch, not the dynamic modulation
  // graph: 4 OUT endpoints (Source A, Source B, Composite, Dual
  // Raster) and 5 IN endpoints (Composite's two inputs, Dual Raster's
  // two inputs, Renderer). `videoOutSourceFor`/`validInTargetsFor`
  // encode the structural rules: a raw source (A/B) can feed anything;
  // Composite's output can feed Renderer OR either side of Dual
  // Raster (blend one raster, leave the other a raw feed); Dual
  // Raster's own output can ONLY reach Renderer (no self-loop, and a
  // raster split isn't itself a blendable single image).
  function videoOutSourceFor(key: VideoOutKey): VideoSourceId {
    if (key === 'sourceA-out') return 'sourceA';
    if (key === 'sourceB-out') return 'sourceB';
    if (key === 'composite-out') return 'composite';
    return 'dualRaster';
  }
  function validInTargetsFor(outKey: VideoOutKey): VideoInKey[] {
    if (outKey === 'dualraster-out') return ['renderer-in'];
    if (outKey === 'composite-out') return ['renderer-in', 'dualraster-inA', 'dualraster-inB'];
    return ['composite-inA', 'composite-inB', 'dualraster-inA', 'dualraster-inB', 'renderer-in'];
  }
  function validOutSourcesFor(inKey: VideoInKey): VideoOutKey[] {
    return (['sourceA-out', 'sourceB-out', 'composite-out', 'dualraster-out'] as VideoOutKey[])
      .filter((ok) => validInTargetsFor(ok).includes(inKey));
  }
  /** Current source feeding an IN endpoint, read from Settings.
   *  `renderer-in` normals to 'sourceA' (never 'none' — the DCU always
   *  needs SOME video input, same as an unplugged real Eurorack jack
   *  falling back to its normal connection). */
  function currentVideoSourceFor(inKey: VideoInKey): VideoSourceId | 'none' {
    if (inKey === 'renderer-in') return settings.get('videoRendererIn');
    if (inKey === 'composite-inA') return settings.get('videoCompositeInA');
    if (inKey === 'composite-inB') return settings.get('videoCompositeInB');
    if (inKey === 'dualraster-inA') return settings.get('videoDualRasterInA');
    return settings.get('videoDualRasterInB');
  }
  /** Write an IN endpoint's source. `null` = unplug: Composite/Dual
   *  Raster inputs go to 'none' (silent/black or "mirror the other
   *  raster", each node's own documented no-signal convention);
   *  Renderer IN normals back to 'sourceA' (the pre-existing default —
   *  never a silent NEW behavior). Wiring Renderer IN to Dual Raster
   *  wakes `dualRasterEnabled` — same "a patching gesture activates
   *  the mode" precedent as `ensureGraphLive()` for the graph engine;
   *  never forced back off by unwiring, since it's also a real,
   *  independently user-toggleable Controls-tab preference. */
  function applyVideoWire(inKey: VideoInKey, source: VideoSourceId | null): void {
    if (inKey === 'renderer-in') {
      settings.set('videoRendererIn', source ?? 'sourceA');
      if (source === 'dualRaster') settings.set('dualRasterEnabled', true);
      return;
    }
    // A dual-raster split isn't itself a source another routing input
    // can consume (its OUT can only ever target renderer-in, enforced
    // above by validInTargetsFor/validOutSourcesFor) — the 'dualRaster'
    // fallback below is pure type-safety, never actually reachable at
    // runtime. Composite's own inputs additionally can't reference
    // 'composite' itself (no self-loop, enforced by Settings' own
    // narrower type for those two keys); Dual Raster's inputs CAN.
    if (inKey === 'composite-inA' || inKey === 'composite-inB') {
      const norm: 'sourceA' | 'sourceB' | 'none' =
        (source === 'sourceA' || source === 'sourceB') ? source : 'none';
      settings.set(inKey === 'composite-inA' ? 'videoCompositeInA' : 'videoCompositeInB', norm);
    } else {
      const norm: 'sourceA' | 'sourceB' | 'composite' | 'none' =
        (source && source !== 'dualRaster') ? source : 'none';
      settings.set(inKey === 'dualraster-inA' ? 'videoDualRasterInA' : 'videoDualRasterInB', norm);
    }
  }

  /** Drag a video OUT jack (Source A/B, Composite) toward a compatible
   *  IN jack. Reverse of dragVideoIn; either end works, same
   *  bidirectional convention as every other cable in this app. */
  function dragVideoOut(ev: PointerEvent, outKey: VideoOutKey, jack: HTMLElement): void {
    const p: Pending = { kind: 'to-videoin', outKey, pos: { x: ev.clientX, y: ev.clientY }, hover: null };
    pending = p;
    const candidates = validInTargetsFor(outKey);
    runGesture(ev, jack,
      (pos) => {
        p.pos = pos;
        const cand = new Map(candidates.map((k) => [k, videoJacks.get(k)!] as const));
        const hit = nearestJack(centersOf(cand), pos, SNAP_PX);
        if ((hit?.id ?? null) !== p.hover) { setHover(videoJacks, p.hover, hit?.id ?? null); p.hover = hit?.id ?? null; }
      },
      () => {
        setHover(videoJacks, p.hover, null);
        pending = null;
        if (p.hover) applyVideoWire(p.hover, videoOutSourceFor(outKey));
      });
  }

  /** Drag a video IN jack (Composite's two inputs, Renderer) toward a
   *  compatible OUT jack — or drop in space to unplug (Composite input
   *  → 'none'; Renderer IN normals back to Source A). */
  function dragVideoIn(ev: PointerEvent, inKey: VideoInKey, jack: HTMLElement): void {
    const p: Pending = { kind: 'to-videoout', inKey, pos: { x: ev.clientX, y: ev.clientY }, hover: null };
    pending = p;
    const candidates = validOutSourcesFor(inKey);
    runGesture(ev, jack,
      (pos) => {
        p.pos = pos;
        const cand = new Map(candidates.map((k) => [k, videoJacks.get(k)!] as const));
        const hit = nearestJack(centersOf(cand), pos, SNAP_PX);
        if ((hit?.id ?? null) !== p.hover) { setHover(videoJacks, p.hover, hit?.id ?? null); p.hover = hit?.id ?? null; }
      },
      () => {
        setHover(videoJacks, p.hover, null);
        pending = null;
        applyVideoWire(inKey, p.hover ? videoOutSourceFor(p.hover) : null);
      });
  }

  function dragSlotOut(ev: PointerEvent, slotIndex: number, jack: HTMLElement): void {
    const p: Pending = { kind: 'to-param', slotIndex, pos: { x: ev.clientX, y: ev.clientY }, hover: null };
    pending = p;
    runGesture(ev, jack,
      (pos) => {
        p.pos = pos;
        const hit = nearestJack(centersOf(paramJacks), pos, SNAP_PX);
        if ((hit?.id ?? null) !== p.hover) { setHover(paramJacks, p.hover, hit?.id ?? null); p.hover = hit?.id ?? null; }
      },
      () => {
        setHover(paramJacks, p.hover, null);
        pending = null;
        const slots = settings.get('modSlots');
        const next = p.hover ?? 'none';
        if (slots[slotIndex] && slots[slotIndex].target !== next) {
          settings.set('modSlots', applyCableTarget(slots, slotIndex, next as ModTarget | 'none'));
        }
      });
  }

  function dragGraphParam(ev: PointerEvent, bindingId: string, jack: HTMLElement): void {
    const p: Pending = { kind: 'to-param-graph', bindingId, pos: { x: ev.clientX, y: ev.clientY }, hover: null };
    pending = p;
    runGesture(ev, jack,
      (pos) => {
        p.pos = pos;
        const hit = nearestJack(centersOf(paramJacks), pos, SNAP_PX);
        if ((hit?.id ?? null) !== p.hover) { setHover(paramJacks, p.hover, hit?.id ?? null); p.hover = hit?.id ?? null; }
      },
      () => {
        setHover(paramJacks, p.hover, null);
        pending = null;
        const patch = settings.get('modGraph');
        if (!patch) return;
        const binding = patch.bindings.find((b) => b.id === bindingId);
        const next = p.hover ?? 'none';
        if (binding && binding.paramKey !== next) {
          const updated = applyGraphBindingTarget(patch, bindingId, next);
          settings.set('modGraph', updated);
          void getEngine().then((e) => e.setPatch(updated));
        }
      });
  }

  /** Drag an existing (or empty) graph node IN jack: snaps to any graph
   *  OUT jack, on drop wires that OUT into this IN (or unplugs if
   *  dropped in space) — mirrors dragSlotOut/dragGraphParam's "grab the
   *  target end" pattern. */
  function dragGraphIn(ev: PointerEvent, nodeId: string, port: string, jack: HTMLElement): void {
    const p: Pending = { kind: 'to-graphin', nodeId, port, pos: { x: ev.clientX, y: ev.clientY }, hover: null };
    pending = p;
    runGesture(ev, jack,
      (pos) => {
        p.pos = pos;
        const hit = nearestJack(centersOf(graphNodeJacks), pos, SNAP_PX);
        if ((hit?.id ?? null) !== p.hover) { setHover(graphNodeJacks, p.hover, hit?.id ?? null); p.hover = hit?.id ?? null; }
      },
      () => {
        setHover(graphNodeJacks, p.hover, null);
        pending = null;
        const patch = settings.get('modGraph');
        if (!patch) return;
        const ref = p.hover ? refFromJackKey(p.hover) : null;
        const node = patch.nodes.find((n) => n.id === nodeId);
        if (node && (node.inputs[port] ?? null) !== ref) {
          const updated = applyNodeInputRef(patch, nodeId, port, ref);
          ensureGraphLive();
          settings.set('modGraph', updated);
          void getEngine().then((e) => e.setPatch(updated));
        }
      });
  }

  /** Every bay gesture that creates/edits a graph connection calls this
   *  so the patch is actually LIVE: `GraphEngine.tick()` no-ops entirely
   *  while modMode is 'classic', so a wire made in classic mode would
   *  read as dead — every node output stuck at 0 (owner bug report: the
   *  Scope drew a flat line after wiring an LFO in). Same guard
   *  `loadSamplePatch()` and `addGraphNode()` already applied; this
   *  closes the remaining gestures (node wires, binding creation). */
  function ensureGraphLive(): void {
    if (settings.get('modMode') === 'classic') settings.set('modMode', 'both');
  }

  /** Shared hover machinery for gestures whose drop target can be a
   *  graph node IN jack OR a faceplate param jack (dragGraphOut,
   *  dragParamOut): transitions highlight state between the two jack
   *  maps, and picks whichever candidate is genuinely closer. */
  function graphOutHoverSetter(p: { hover: GraphOutHover }): (next: GraphOutHover) => void {
    return (next) => {
      const prev = p.hover;
      if (prev?.kind === next?.kind && prev?.key === next?.key) return;
      if (prev?.kind === 'in') setHover(graphInputJacks, prev.key, null);
      if (prev?.kind === 'param') setHover(paramJacks, prev.key, null);
      if (next?.kind === 'in') setHover(graphInputJacks, null, next.key);
      if (next?.kind === 'param') setHover(paramJacks, null, next.key);
      p.hover = next;
    };
  }
  function nearestGraphOutTarget(pos: Pt, excludeParam?: string): GraphOutHover {
    const inHit = nearestJack(centersOf(graphInputJacks), pos, SNAP_PX);
    const paramCandidates = excludeParam
      ? centersOf(paramJacks).filter((c) => c.id !== excludeParam)
      : centersOf(paramJacks);
    const paramHit = nearestJack(paramCandidates, pos, SNAP_PX);
    if (inHit && paramHit) {
      const dIn = Math.hypot(inHit.x - pos.x, inHit.y - pos.y);
      const dParam = Math.hypot(paramHit.x - pos.x, paramHit.y - pos.y);
      return dIn <= dParam ? { kind: 'in', key: inHit.id } : { kind: 'param', key: paramHit.id };
    }
    if (inHit) return { kind: 'in', key: inHit.id };
    if (paramHit) return { kind: 'param', key: paramHit.id };
    return null;
  }

  /** Drag a graph node's OUT jack toward either another node's IN jack
   *  (wires them — see applyNodeInputRef) or a faceplate param jack
   *  (creates/retargets a TargetBinding, reusing the node's own 'none'
   *  placeholder if it has one). Whichever jack is CLOSER wins when
   *  both are in snap range; dropping in empty space does nothing —
   *  an OUT can fan out to several connections, so there's no single
   *  "the" connection a drop-in-space could unambiguously remove. */
  function dragGraphOut(ev: PointerEvent, sourceKey: string, jack: HTMLElement): void {
    const p: Pending = { kind: 'to-graphout', sourceKey, pos: { x: ev.clientX, y: ev.clientY }, hover: null };
    pending = p;
    const setGraphOutHover = graphOutHoverSetter(p);
    runGesture(ev, jack,
      (pos) => {
        p.pos = pos;
        setGraphOutHover(nearestGraphOutTarget(pos));
      },
      () => {
        const hover = p.hover;
        setGraphOutHover(null);
        pending = null;
        if (!hover) return;
        const patch = settings.get('modGraph');
        if (!patch) return;
        if (hover.kind === 'in') {
          const { nodeId: targetId, port: targetPort } = splitJackKey(hover.key);
          const ref = refFromJackKey(sourceKey);
          const updated = applyNodeInputRef(patch, targetId, targetPort, ref);
          ensureGraphLive();
          settings.set('modGraph', updated);
          void getEngine().then((e) => e.setPatch(updated));
          return;
        }
        // hover.kind === 'param': create a binding, or retarget this
        // node's own placeholder ('none') binding if it still has one —
        // the exact companion binding addGraphNode() creates, so a
        // fresh node's first drag-to-param consumes it instead of
        // piling up an orphaned extra binding.
        const { nodeId: srcId, port: srcPort } = splitJackKey(sourceKey);
        const placeholder = patch.bindings.find((b) => (
          b.paramKey === 'none' && b.sourceNodeId === srcId
          && (b.sourcePort || defaultOutputPort(srcId)) === srcPort
        ));
        const updated: GraphPatch = placeholder
          ? { ...patch, bindings: patch.bindings.map((b) => (b.id === placeholder.id ? { ...b, paramKey: hover.key } : b)) }
          : {
            ...patch,
            bindings: [...patch.bindings, {
              id: genId('b'), paramKey: hover.key, sourceNodeId: srcId,
              sourcePort: srcPort === defaultOutputPort(srcId) ? undefined : srcPort,
              amount: 0.25, mode: 'additive',
            }],
          };
        ensureGraphLive();
        settings.set('modGraph', updated);
        void getEngine().then((e) => e.setPatch(updated));
      });
  }

  /** `${nodeId}#${port}` jack key -> a `GraphNode.inputs` ref string,
   *  following the engine's own convention (splitInputRef): a plain node
   *  id means "that node's default output" (our '' port sentinel),
   *  `nodeId#port` names a specific one. */
  function refFromJackKey(key: string): string {
    const { nodeId, port } = splitJackKey(key);
    return port === defaultOutputPort(nodeId) ? nodeId : `${nodeId}#${port}`;
  }

  /** Drag a faceplate param's OUT jack (hardware reference: every param
   *  row has an input AND an output) onto another param jack or a node
   *  IN port. Creates — or reuses, so repeated drags from the same
   *  param don't pile up duplicates — a `param-out` graph node reading
   *  this param's live value, then binds/wires it to the drop target. */
  function dragParamOut(ev: PointerEvent, paramKey: string, jack: HTMLElement): void {
    const p: Pending = { kind: 'to-paramout', paramKey, pos: { x: ev.clientX, y: ev.clientY }, hover: null };
    pending = p;
    const setPOHover = graphOutHoverSetter(p);
    runGesture(ev, jack,
      (pos) => {
        p.pos = pos;
        // A param feeding itself is a degenerate loop — exclude self.
        setPOHover(nearestGraphOutTarget(pos, paramKey));
      },
      () => {
        const hover = p.hover;
        setPOHover(null);
        pending = null;
        if (!hover) return;
        let patch: GraphPatch = settings.get('modGraph') ?? { nodes: [], bindings: [] };
        let node = patch.nodes.find((n) => n.type === 'param-out' && String(n.params.key) === paramKey);
        if (!node) {
          node = { id: genId('n'), type: 'param-out', params: { key: paramKey }, inputs: {} };
          patch = { ...patch, nodes: [...patch.nodes, node] };
        }
        const updated: GraphPatch = hover.kind === 'in'
          ? applyNodeInputRef(patch, splitJackKey(hover.key).nodeId, splitJackKey(hover.key).port, node.id)
          : {
            ...patch,
            bindings: [...patch.bindings, {
              id: genId('b'), paramKey: hover.key, sourceNodeId: node.id,
              amount: 0.25, mode: 'additive',
            }],
          };
        ensureGraphLive();
        settings.set('modGraph', updated);
        void getEngine().then((e) => e.setPatch(updated));
      });
  }

  function dragParam(ev: PointerEvent, key: string, jack: HTMLElement): void {
    const i = slotForParam(settings.get('modSlots'), key);
    if (i >= 0) { dragSlotOut(ev, i, jack); return; }
    const bindingId = graphBindingForParam(settings.get('modGraph'), key);
    if (bindingId) { dragGraphParam(ev, bindingId, jack); return; }
    const p: Pending = { kind: 'to-slotout', paramKey: key, pos: { x: ev.clientX, y: ev.clientY }, hover: null };
    pending = p;
    runGesture(ev, jack,
      (pos) => {
        p.pos = pos;
        const hit = nearestJack(centersOf(slotOutJacks), pos, SNAP_PX);
        if ((hit?.id ?? null) !== p.hover) { setHover(slotOutJacks, p.hover, hit?.id ?? null); p.hover = hit?.id ?? null; }
      },
      () => {
        setHover(slotOutJacks, p.hover, null);
        pending = null;
        if (p.hover == null) return;
        const slots = settings.get('modSlots');
        if (slots[p.hover] && slots[p.hover].target !== key) {
          settings.set('modSlots', applyCableTarget(slots, p.hover, key as ModTarget));
        }
      });
  }

  /** Drag a SOURCES bus jack toward a Classic slot's SRC IN (sets that
   *  slot's source, as before) OR a graph node's waveform-shape jack
   *  (sets that node's shape param — drag TRI onto an LFO's shape jack
   *  to get a triangle wave). Closest candidate wins. */
  function dragSource(ev: PointerEvent, source: ModSource, jack: HTMLElement): void {
    const p: Pending = { kind: 'to-slotsrc', source, pos: { x: ev.clientX, y: ev.clientY }, hover: null };
    pending = p;
    const mappedOption = WAVE_SOURCE_TO_OPTION[source];
    const setSrcHover = (next: SlotSrcHover): void => {
      const prev = p.hover;
      if (prev?.kind === next?.kind
        && (prev?.kind === 'slot' ? prev.index === (next as { index: number }).index : prev?.key === (next as { key: string })?.key)) return;
      if (prev?.kind === 'slot') setHover(slotSrcJacks, prev.index, null);
      if (prev?.kind === 'shape') setHover(shapeJacks, prev.key, null);
      if (next?.kind === 'slot') setHover(slotSrcJacks, null, next.index);
      if (next?.kind === 'shape') setHover(shapeJacks, null, next.key);
      p.hover = next;
    };
    runGesture(ev, jack,
      (pos) => {
        p.pos = pos;
        const slotHit = nearestJack(centersOf(slotSrcJacks), pos, SNAP_PX);
        // Only waveform sources can land on a shape jack — AUDIO ENV
        // dropped on an LFO's shape has no meaning.
        const shapeHit = mappedOption ? nearestJack(centersOf(shapeJacks), pos, SNAP_PX) : null;
        if (slotHit && shapeHit) {
          const dSlot = Math.hypot(slotHit.x - pos.x, slotHit.y - pos.y);
          const dShape = Math.hypot(shapeHit.x - pos.x, shapeHit.y - pos.y);
          setSrcHover(dSlot <= dShape ? { kind: 'slot', index: slotHit.id } : { kind: 'shape', key: shapeHit.id });
        } else if (slotHit) {
          setSrcHover({ kind: 'slot', index: slotHit.id });
        } else if (shapeHit) {
          setSrcHover({ kind: 'shape', key: shapeHit.id });
        } else {
          setSrcHover(null);
        }
      },
      () => {
        const hover = p.hover;
        setSrcHover(null);
        pending = null;
        if (!hover) return;
        if (hover.kind === 'slot') {
          const slots = settings.get('modSlots');
          if (slots[hover.index] && slots[hover.index].source !== source) {
            settings.set('modSlots', applyCableSource(slots, hover.index, source));
          }
          return;
        }
        applyShapeFromSource(hover.key, source);
      });
  }

  /** Set a node's waveform-shape enum param from a Classic waveform
   *  source, if the mapping lands on one of the param's real options. */
  function applyShapeFromSource(shapeKey: string, source: ModSource): void {
    const option = WAVE_SOURCE_TO_OPTION[source];
    if (!option) return;
    const { nodeId, port: param } = splitJackKey(shapeKey);
    const patch = settings.get('modGraph');
    const node = patch?.nodes.find((n) => n.id === nodeId);
    const spec = node ? getDef(node.type)?.params[param] : undefined;
    if (!spec || spec.kind !== 'enum' || !spec.options.includes(option)) return;
    if (node!.params[param] === option) return;
    writeGraphNodeParam(nodeId, param, option);
  }

  /** Reverse gesture: drag a node's shape jack toward a SOURCES bus
   *  waveform jack to pick that waveform. */
  function dragShapeJack(ev: PointerEvent, nodeId: string, param: string, jack: HTMLElement): void {
    const p: Pending = { kind: 'to-shapesrc', nodeId, param, pos: { x: ev.clientX, y: ev.clientY }, hover: null };
    pending = p;
    runGesture(ev, jack,
      (pos) => {
        p.pos = pos;
        const hit = nearestJack(
          centersOf(srcJacks).filter((c) => WAVE_SOURCE_TO_OPTION[c.id] !== undefined),
          pos, SNAP_PX,
        );
        if ((hit?.id ?? null) !== p.hover) { setHover(srcJacks, p.hover, hit?.id ?? null); p.hover = hit?.id ?? null; }
      },
      () => {
        setHover(srcJacks, p.hover, null);
        pending = null;
        if (p.hover) applyShapeFromSource(`${nodeId}#${param}`, p.hover);
      });
  }

  // ---------------- left rail: function generators --------------------
  const rail = document.createElement('div');
  rail.className = 'rw-pb-rail';

  // Expandable preview monitors (TouchDesigner-style): a collapsed
  // PREVIEW row on a module that, when expanded, drawImage()s a live
  // source (the shared video element / the render canvas) into a small
  // canvas each frame from the existing rAF loop. Collapsed previews
  // cost nothing — frame() skips them entirely.
  interface BayPreview { canvas: HTMLCanvasElement; expanded: () => boolean; src: () => CanvasImageSource | null }
  const bayPreviews: BayPreview[] = [];
  function addPreviewRow(mod: HTMLElement, tooltip: string, src: () => CanvasImageSource | null): void {
    let open = false;
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'rw-pb-tidy rw-pb-preview-toggle';
    toggleBtn.textContent = '▸ PREVIEW';
    attachTooltip(toggleBtn, tooltip);
    const row = document.createElement('div');
    row.className = 'rw-pb-row rw-pb-previewrow';
    row.hidden = true;
    const cv = document.createElement('canvas');
    cv.className = 'rw-pb-preview-canvas';
    cv.width = 180;
    cv.height = 101; // 16:9-ish inside the rail column
    row.appendChild(cv);
    toggleBtn.addEventListener('click', () => {
      open = !open;
      row.hidden = !open;
      toggleBtn.textContent = open ? '▾ PREVIEW' : '▸ PREVIEW';
    });
    const btnRow = document.createElement('div');
    btnRow.className = 'rw-pb-row';
    btnRow.appendChild(toggleBtn);
    mod.append(btnRow, row);
    bayPreviews.push({ canvas: cv, expanded: () => open, src });
  }

  // VIDEO SOURCE A/B modules — the same `VideoSourceManager` instances
  // Controls (A) / the bay alone (B) use, so switching here is the SAME
  // state, not a mirror. Each gets an OUT jack (owner: "the video
  // source should have an output node") — drag it onto the Composite
  // node's IN A/B or straight onto RENDERER IN to bypass compositing.
  function mkVideoSourceModule(title: string, mgr: VideoSourceManager, outKey: VideoOutKey, kindKey: 'sourceKind' | 'sourceBKind'): void {
    const mod = document.createElement('div');
    mod.className = 'rw-pb-module';
    const head = document.createElement('div');
    head.className = 'rw-pb-module-head';
    const titleEl = document.createElement('span');
    titleEl.textContent = title;
    head.append(titleEl);
    const lcdRow = document.createElement('div');
    lcdRow.className = 'rw-pb-row';
    const lcd = document.createElement('span');
    lcd.className = 'rw-pb-lcd';
    lcdRow.append(lcd);
    const btnRow = document.createElement('div');
    btnRow.className = 'rw-pb-row';
    const mkBtn = (label: string, tooltip: string, run: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rw-pb-tidy';
      b.textContent = label;
      attachTooltip(b, tooltip);
      b.addEventListener('click', run);
      btnRow.appendChild(b);
      return b;
    };
    // Mirrors the boot overlay's own WEBCAM/SCREEN/FILE handlers
    // (main.ts) — `VideoSourceManager` itself has no Settings
    // connection (it's a plain instance, no `settings` in its
    // constructor), so every call site that switches a source is
    // responsible for also recording the choice. This was a real gap
    // for Source A specifically: the bay's buttons switched the feed
    // but never wrote `sourceKind`, so anything gating on it (the
    // welcome-overlay dismissal, this feature's own composite "active"
    // check before it was changed to read `video.readyState` instead)
    // silently disagreed with what the LCD showed.
    const setKind = (v: 'webcam' | 'screen' | 'file'): void => {
      if (kindKey === 'sourceKind') settings.set('sourceKind', v);
      else settings.set('sourceBKind', v);
    };
    // Await before recording the kind, same order as the boot overlay's
    // own WEBCAM/SCREEN handlers — a denied permission or cancelled
    // picker must NOT leave Settings claiming a source that isn't
    // actually live (principle 3: no state claimed that isn't real).
    // .catch swallows a denied/cancelled permission prompt — the LCD
    // and Settings simply stay at whatever they were (no error banner
    // here; the boot overlay's bootErr() is that surface, not this).
    mkBtn('WEBCAM', 'Switch to the default webcam.', () => { void mgr.useWebcam().then(() => setKind('webcam')).catch(() => {}); });
    mkBtn('SCREEN', 'Switch to a screen/window/tab share.', () => { void mgr.useScreen().then(() => setKind('screen')).catch(() => {}); });
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'video/*';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) { mgr.useFile(f); setKind('file'); }
      fileInput.value = '';
    });
    mkBtn('FILE', 'Load a local video file.', () => fileInput.click());
    const outRow = document.createElement('div');
    outRow.className = 'rw-pb-row rw-pb-row--out';
    const outLabel = document.createElement('label');
    outLabel.textContent = 'OUT';
    const outJack = makeJack('rw-rack-jack--out');
    outJack.addEventListener('pointerdown', (ev) => dragVideoOut(ev, outKey, outJack));
    attachTooltip(outJack, `${title} OUT — this feed as a video signal. Drag onto COMPOSITE's A/B input, or straight onto RENDERER IN to bypass compositing.`);
    outRow.append(outLabel, outJack);
    videoJacks.set(outKey, outJack);
    mod.append(head, lcdRow, btnRow, fileInput, outRow);
    // Live monitor of the actual source feed — the SAME shared video
    // element the renderer's texture reads, drawn (not re-streamed), so
    // it works identically for webcam/screen/file/HLS.
    addPreviewRow(mod, 'Expand a live monitor of the incoming video signal.',
      () => (mgr.video.readyState >= 2 ? mgr.video : null));
    rail.appendChild(mod);
    mgr.subscribe((state) => {
      lcd.textContent = state.kind === 'none' ? 'NONE' : `${state.kind.toUpperCase()}: ${state.label || '—'}`;
    });
  }
  mkVideoSourceModule('VIDEO SOURCE A', source, 'sourceA-out', 'sourceKind');
  mkVideoSourceModule('VIDEO SOURCE B', sourceB, 'sourceB-out', 'sourceBKind');

  // COMPOSITE module — owner: "there should be a composite node with
  // screen, add, mix, etc so I can composite two video sources." Two
  // video INs (order matters for asymmetric modes — subtract, mask),
  // the same 8 blend modes the Pattern Generator already offers (reused
  // shader, see VideoCompositor.ts), a mix control, one video OUT.
  {
    const mod = document.createElement('div');
    mod.className = 'rw-pb-module';
    const head = document.createElement('div');
    head.className = 'rw-pb-module-head';
    const title = document.createElement('span');
    title.textContent = 'COMPOSITE';
    head.append(title);
    mod.appendChild(head);

    const mkInRow = (label: string, inKey: VideoInKey): void => {
      const row = document.createElement('div');
      row.className = 'rw-pb-row';
      const jack = makeJack('rw-rack-jack--in');
      jack.addEventListener('pointerdown', (ev) => dragVideoIn(ev, inKey, jack));
      attachTooltip(jack, () => {
        const cur = currentVideoSourceFor(inKey);
        const name = cur === 'sourceA' ? 'Video Source A' : cur === 'sourceB' ? 'Video Source B' : null;
        return name
          ? `Composite ${label} — patched from ${name}. Drag to move, drop in space to unplug.`
          : `Composite ${label} — drag a Source A/B OUT here to patch it.`;
      });
      const l = document.createElement('label');
      l.textContent = label;
      row.append(jack, l);
      mod.appendChild(row);
      videoJacks.set(inKey, jack);
    };
    mkInRow('A', 'composite-inA');
    mkInRow('B', 'composite-inB');

    const modeRow = document.createElement('div');
    modeRow.className = 'rw-pb-row';
    const modeLabel = document.createElement('label');
    modeLabel.textContent = 'blend';
    const modeSel = document.createElement('select');
    modeSel.className = 'rw-select';
    const BLEND_LABELS: Record<PatternBlendMode, string> = {
      replace: 'B only', add: 'Add', subtract: 'Subtract', multiply: 'Multiply',
      screen: 'Screen', difference: 'Difference', mask: 'Mask (B luma keys A)', crossfade: 'Crossfade',
    };
    for (const [val, lbl] of Object.entries(BLEND_LABELS)) {
      const o = document.createElement('option');
      o.value = val; o.textContent = lbl;
      modeSel.appendChild(o);
    }
    modeSel.value = settings.get('videoCompositeBlendMode');
    modeSel.addEventListener('change', () => settings.set('videoCompositeBlendMode', modeSel.value as PatternBlendMode));
    attachTooltip(modeSel, 'How A and B combine — the same 8 modes the Pattern Generator uses, applied to two video signals.');
    modeRow.append(modeLabel, modeSel);
    mod.appendChild(modeRow);
    settings.subscribe('videoCompositeBlendMode', (v) => { if (document.activeElement !== modeSel) modeSel.value = v; });

    const mixRow = document.createElement('div');
    mixRow.className = 'rw-pb-row';
    const mixLabel = document.createElement('label');
    mixLabel.textContent = 'mix';
    const mixInput = document.createElement('input');
    mixInput.type = 'number';
    mixInput.min = '0'; mixInput.max = '1'; mixInput.step = '0.01';
    mixInput.value = String(settings.get('videoCompositeMix'));
    mixInput.addEventListener('input', () => {
      const v = parseFloat(mixInput.value);
      if (Number.isFinite(v)) writeParamValue('videoCompositeMix', v);
    });
    attachTooltip(mixInput, 'Wet/dry: 0 = A alone, 1 = the full blend. Also on the general faceplate (Pattern Generator group) with a live-value knob.');
    mixRow.append(mixLabel, mixInput);
    mod.appendChild(mixRow);
    settings.subscribe('videoCompositeMix', (v) => { if (document.activeElement !== mixInput) mixInput.value = String(v); });

    const outRow = document.createElement('div');
    outRow.className = 'rw-pb-row rw-pb-row--out';
    const outLabel = document.createElement('label');
    outLabel.textContent = 'OUT';
    const outJack = makeJack('rw-rack-jack--out');
    outJack.addEventListener('pointerdown', (ev) => dragVideoOut(ev, 'composite-out', outJack));
    attachTooltip(outJack, 'Composite OUT — the blended signal. Drag onto RENDERER IN to see it.');
    outRow.append(outLabel, outJack);
    videoJacks.set('composite-out', outJack);
    mod.appendChild(outRow);

    rail.appendChild(mod);
  }

  // DUAL RASTER module (owner: "there should also be a dual raster node
  // ... where you can input two video sources ... wire up two videos to
  // a dual raster then wire the dual raster into the render node").
  // Unlike Composite, this doesn't blend into one image — it hands
  // BOTH scan rasters over to two INDEPENDENT sources (closing the
  // "per-raster video sources" gap docs/design/dual-raster.md flagged
  // as explicitly out of v1). Two video INs (order isn't asymmetric
  // here — A always means raster A, B always raster B — labeled to
  // match), one video OUT that can only ever reach RENDERER IN.
  {
    const mod = document.createElement('div');
    mod.className = 'rw-pb-module';
    const head = document.createElement('div');
    head.className = 'rw-pb-module-head';
    const title = document.createElement('span');
    title.textContent = 'DUAL RASTER';
    head.append(title);
    mod.appendChild(head);

    const mkInRow = (label: string, inKey: VideoInKey): void => {
      const row = document.createElement('div');
      row.className = 'rw-pb-row';
      const jack = makeJack('rw-rack-jack--in');
      jack.addEventListener('pointerdown', (ev) => dragVideoIn(ev, inKey, jack));
      attachTooltip(jack, () => {
        const cur = currentVideoSourceFor(inKey);
        const name = cur === 'sourceA' ? 'Video Source A' : cur === 'sourceB' ? 'Video Source B' : cur === 'composite' ? 'the Composite node' : null;
        return name
          ? `Raster ${label} — patched from ${name}. Drag to move, drop in space to unplug (unplugged mirrors raster A, same as before this node existed).`
          : `Raster ${label} — drag a Source A/B or Composite OUT here to patch it.`;
      });
      const l = document.createElement('label');
      l.textContent = label;
      row.append(jack, l);
      mod.appendChild(row);
      videoJacks.set(inKey, jack);
    };
    mkInRow('A', 'dualraster-inA');
    mkInRow('B', 'dualraster-inB');

    const outRow = document.createElement('div');
    outRow.className = 'rw-pb-row rw-pb-row--out';
    const outLabel = document.createElement('label');
    outLabel.textContent = 'OUT';
    const outJack = makeJack('rw-rack-jack--out');
    outJack.addEventListener('pointerdown', (ev) => dragVideoOut(ev, 'dualraster-out', outJack));
    attachTooltip(outJack, 'Dual Raster OUT — drag onto RENDERER IN to activate dual-raster mode with these two feeds.');
    outRow.append(outLabel, outJack);
    videoJacks.set('dualraster-out', outJack);
    mod.appendChild(outRow);

    rail.appendChild(mod);
  }

  // RENDERER module — the sink (owner: "the renderer [should have] an
  // input node"). Unplugged normals to Video Source A: the pre-existing
  // single-source behavior, exactly, until this jack is actually
  // patched (principle 5, coexistence — see VideoCompositor.ts).
  {
    const mod = document.createElement('div');
    mod.className = 'rw-pb-module';
    const head = document.createElement('div');
    head.className = 'rw-pb-module-head';
    const title = document.createElement('span');
    title.textContent = 'RENDERER';
    head.append(title);
    mod.appendChild(head);
    const row = document.createElement('div');
    row.className = 'rw-pb-row';
    const jack = makeJack('rw-rack-jack--in');
    jack.addEventListener('pointerdown', (ev) => dragVideoIn(ev, 'renderer-in', jack));
    attachTooltip(jack, () => {
      const cur = settings.get('videoRendererIn');
      const name = cur === 'sourceA' ? 'Video Source A (default)' : cur === 'sourceB' ? 'Video Source B'
        : cur === 'composite' ? 'the Composite node' : 'the Dual Raster node';
      return `RENDERER IN — feeding from ${name}. Drag a Source/Composite/Dual Raster OUT here to change it; drop in space to normal back to Source A.`;
    });
    const l = document.createElement('label');
    l.textContent = 'IN';
    row.append(jack, l);
    mod.appendChild(row);
    videoJacks.set('renderer-in', jack);
    rail.appendChild(mod);
  }

  // RENDER PREVIEW module — output monitor for the bay (owner: "think
  // TouchDesigner"). Draws the one real render canvas (#stage) into a
  // small preview each frame while expanded; a picture of the output,
  // never a second renderer (same one-real-canvas rule as the
  // workspace's OUTPUT mirror views, just drawImage instead of
  // captureStream since we already have a rAF loop here).
  {
    const mod = document.createElement('div');
    mod.className = 'rw-pb-module';
    const head = document.createElement('div');
    head.className = 'rw-pb-module-head';
    const title = document.createElement('span');
    title.textContent = 'RENDER PREVIEW';
    head.append(title);
    mod.appendChild(head);
    addPreviewRow(mod, 'Expand a live monitor of the final rendered output.',
      () => {
        const stage = document.getElementById('stage') as HTMLCanvasElement | null;
        return stage && stage.width > 0 ? stage : null;
      });
    rail.appendChild(mod);
  }

  // PATTERN GENERATOR module (owner: "I should be able to enable the
  // pattern generator, adjust its kind, and blend mode in the patch bay
  // as well as supporting properties for the kind of pattern generator
  // selected") — mirrors Controls' own SourceSection.ts Pattern
  // Generator group exactly (same defaults-before-kind-switch order,
  // same enum option lists, imported from the shared PatternRegistry.ts
  // home rather than duplicated). No jack: it always operates on
  // whatever signal is already feeding the DCU (VIDEO SOURCE
  // A/B/COMPOSITE, per RENDERER's own wiring above) — there's no
  // separate "pattern's video input" to route.
  //
  // The dynamic "supporting properties" section is the actual reason
  // this needs its OWN module rather than just relying on the general
  // faceplate's static PATTERN GENERATOR field group: that group (like
  // every faceplate field) shows all 17 modulatable pattern params
  // unconditionally, active kind or not — this module instead shows
  // ONLY the params `PATTERN_REGISTRY[kind].paramKeys` actually declares
  // for the CURRENT kind, same as Controls' dynamic `rebuildParams`.
  // Base-value knobs only (no jacks/live-badges, matching the Composite
  // module's own Mix field) — full patchability for these same keys
  // already lives on the general faceplate; duplicating jacks here
  // would just be two competing patch points for one signal.
  {
    const mod = document.createElement('div');
    mod.className = 'rw-pb-module';
    const head = document.createElement('div');
    head.className = 'rw-pb-module-head';
    const en = document.createElement('input');
    en.type = 'checkbox';
    en.className = 'rw-pb-led-toggle';
    en.checked = settings.get('patternEnabled');
    en.addEventListener('change', () => settings.set('patternEnabled', en.checked));
    settings.subscribe('patternEnabled', (v) => { if (document.activeElement !== en) en.checked = v; });
    attachTooltip(en, 'Enable the Pattern Generator layer. When off, the live video texture feeds the DCU directly (no extra GPU cost).');
    const title = document.createElement('span');
    title.textContent = 'PATTERN GENERATOR';
    head.append(en, title);
    mod.appendChild(head);

    const kindRow = document.createElement('div');
    kindRow.className = 'rw-pb-row';
    const kindLabel = document.createElement('label');
    kindLabel.textContent = 'kind';
    const kindSel = document.createElement('select');
    kindSel.className = 'rw-select';
    let lastCategory = '';
    let currentGroup: HTMLOptGroupElement | null = null;
    for (const k of PATTERN_ORDER) {
      const def = PATTERN_REGISTRY[k];
      if (def.category !== lastCategory) {
        currentGroup = document.createElement('optgroup');
        currentGroup.label = PATTERN_CATEGORY_LABEL[def.category];
        kindSel.appendChild(currentGroup);
        lastCategory = def.category;
      }
      const o = document.createElement('option');
      o.value = k; o.textContent = def.label;
      currentGroup!.appendChild(o);
    }
    kindSel.value = settings.get('patternKind');
    kindSel.addEventListener('change', () => {
      const next = kindSel.value as PatternKind;
      // Apply per-pattern defaults FIRST, same order as Controls'
      // SourceSection — the dynamic params section below reads fresh
      // values when it rebuilds off the patternKind subscriber.
      const def = PATTERN_REGISTRY[next];
      if (def) settings.patch(def.defaults);
      settings.set('patternKind', next);
    });
    attachTooltip(kindSel, 'Which pattern generator to render — calibration, waveform, noise, or oscilloscope.');
    kindRow.append(kindLabel, kindSel);
    mod.appendChild(kindRow);
    settings.subscribe('patternKind', (v) => { if (document.activeElement !== kindSel) kindSel.value = v; });

    const modeRow = document.createElement('div');
    modeRow.className = 'rw-pb-row';
    const modeLabel = document.createElement('label');
    modeLabel.textContent = 'blend';
    const modeSel = document.createElement('select');
    modeSel.className = 'rw-select';
    const PATTERN_BLEND_LABELS: Record<PatternBlendMode, string> = {
      replace: 'Replace', add: 'Add', subtract: 'Subtract', multiply: 'Multiply',
      screen: 'Screen', difference: 'Difference', mask: 'Mask', crossfade: 'Crossfade',
    };
    for (const [val, lbl] of Object.entries(PATTERN_BLEND_LABELS)) {
      const o = document.createElement('option');
      o.value = val; o.textContent = lbl;
      modeSel.appendChild(o);
    }
    modeSel.value = settings.get('patternBlendMode');
    modeSel.addEventListener('change', () => settings.set('patternBlendMode', modeSel.value as PatternBlendMode));
    attachTooltip(modeSel, 'How the pattern composites with the video source: Replace (pattern only), Add, Subtract, Multiply, Screen, Difference, Mask, Crossfade.');
    modeRow.append(modeLabel, modeSel);
    mod.appendChild(modeRow);
    settings.subscribe('patternBlendMode', (v) => { if (document.activeElement !== modeSel) modeSel.value = v; });

    const mixRow = document.createElement('div');
    mixRow.className = 'rw-pb-row';
    const mixLabel = document.createElement('label');
    mixLabel.textContent = 'mix';
    const mixInput = document.createElement('input');
    mixInput.type = 'number';
    mixInput.min = '0'; mixInput.max = '1'; mixInput.step = '0.01';
    mixInput.value = String(settings.get('patternMix'));
    mixInput.addEventListener('input', () => {
      const v = parseFloat(mixInput.value);
      if (Number.isFinite(v)) writeParamValue('patternMix', v);
    });
    attachTooltip(mixInput, 'Wet/dry between the unmodified video and the blended result. Also on the general faceplate (Pattern Generator group) with a live-value knob.');
    mixRow.append(mixLabel, mixInput);
    mod.appendChild(mixRow);
    settings.subscribe('patternMix', (v) => { if (document.activeElement !== mixInput) mixInput.value = String(v); });

    // Dynamic per-kind supporting properties — rebuilt whenever
    // patternKind changes, same trigger Controls' own rebuildParams uses.
    const paramsHost = document.createElement('div');
    mod.appendChild(paramsHost);

    function rebuildPatternParams(kind: PatternKind): void {
      paramsHost.innerHTML = '';
      const def = PATTERN_REGISTRY[kind];
      if (!def) return;
      for (const key of def.paramKeys) {
        const row = document.createElement('div');
        row.className = 'rw-pb-row';
        const label = document.createElement('label');
        label.textContent = prettyParamLabel(key);
        let ctl: HTMLElement;
        if (key === 'patternAxis') {
          ctl = enumSelect(key, AXIS_OPTIONS, () => settings.get('patternAxis'), (v) => settings.set('patternAxis', v as PatternAxis));
        } else if (key === 'patternGradientShape') {
          ctl = enumSelect(key, GRAD_SHAPE_OPTIONS, () => settings.get('patternGradientShape'), (v) => settings.set('patternGradientShape', v as PatternGradientShape));
        } else if (key === 'patternScopeSourceKind') {
          ctl = enumSelect(key, SCOPE_SOURCE_OPTIONS, () => settings.get('patternScopeSourceKind'), (v) => settings.set('patternScopeSourceKind', v as PatternScopeSourceKind));
        } else if (key === 'patternScopeSourceRef') {
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.placeholder = 'e.g. 1, lfo-1:out, zPush';
          inp.value = settings.get('patternScopeSourceRef');
          inp.addEventListener('change', () => settings.set('patternScopeSourceRef', inp.value));
          settings.subscribe('patternScopeSourceRef', (v) => { if (document.activeElement !== inp) inp.value = v; });
          ctl = inp;
        } else {
          // Every remaining paramKey is a numeric ModTarget — same
          // knob+field recipe as every other base-value convenience
          // control in the bay (paramRangeFor reads the SAME PARAM_DOCS
          // ranges the general faceplate's full jack cells use).
          const numKey = key as PatternParamKey & keyof Settings;
          const range = paramRangeFor(numKey);
          const wrap = document.createElement('div');
          wrap.className = 'rw-pb-cell-ctl';
          const knob = createMiniKnob({
            min: range.min, max: range.max, step: range.step,
            label: prettyParamLabel(key),
            get: () => { const v = settings.get(numKey); return typeof v === 'number' ? v : 0; },
            set: (v) => writeParamValue(numKey, v),
          });
          const inp = document.createElement('input');
          inp.type = 'number';
          inp.step = String(range.step); inp.min = String(range.min); inp.max = String(range.max);
          inp.addEventListener('input', () => {
            const v = parseFloat(inp.value);
            if (Number.isFinite(v)) writeParamValue(numKey, v);
          });
          settings.subscribe(numKey, (v) => {
            if (document.activeElement === inp || typeof v !== 'number') return;
            inp.value = String(v);
            knob.refresh();
          });
          wrap.append(knob.el, inp);
          ctl = wrap;
        }
        attachTooltip(row, `${label.textContent} (${key})`);
        row.append(label, ctl);
        paramsHost.appendChild(row);
      }
    }

    function enumSelect<T extends string>(
      key: string, options: { value: T; label: string }[], get: () => T, set: (v: T) => void,
    ): HTMLSelectElement {
      const sel = document.createElement('select');
      sel.className = 'rw-select';
      for (const o of options) {
        const opt = document.createElement('option');
        opt.value = o.value; opt.textContent = o.label;
        sel.appendChild(opt);
      }
      sel.value = get();
      sel.addEventListener('change', () => set(sel.value as T));
      settings.subscribe(key as keyof Settings, () => { if (document.activeElement !== sel) sel.value = get(); });
      return sel;
    }

    rebuildPatternParams(settings.get('patternKind'));
    settings.subscribe('patternKind', rebuildPatternParams);

    rail.appendChild(mod);
  }

  const writeSlot = (index: number, patch: Partial<ModSlot>): void => {
    const slots = settings.get('modSlots').slice();
    if (!slots[index]) return;
    slots[index] = { ...slots[index], ...patch };
    settings.set('modSlots', slots);
  };

  interface SlotRefs { en: HTMLInputElement; rate: HTMLInputElement; amount: HTMLInputElement; srcLcd: HTMLElement }
  const slotRefs: SlotRefs[] = [];

  for (let i = 0; i < settings.get('modSlots').length; i++) {
    const mod = document.createElement('div');
    mod.className = 'rw-pb-module';

    const head = document.createElement('div');
    head.className = 'rw-pb-module-head';
    const en = document.createElement('input');
    en.type = 'checkbox';
    en.className = 'rw-pb-led-toggle';
    en.addEventListener('change', () => writeSlot(i, { enabled: en.checked }));
    attachTooltip(en, 'Enable this function generator (plugging a cable also enables it).');
    const title = document.createElement('span');
    title.textContent = `FUNCTION GEN ${i + 1}`;
    head.append(en, title);

    const srcRow = document.createElement('div');
    srcRow.className = 'rw-pb-row';
    const srcIn = makeJack('rw-pb-jack--srcin');
    srcIn.addEventListener('pointerdown', (ev) => {
      // Re-drag the current source if it's one of the jackable signals.
      const s = settings.get('modSlots')[i]?.source;
      const jackable = SOURCE_JACKS.find((j) => j.source === s);
      if (jackable) dragSource(ev, jackable.source, srcIn);
    });
    attachTooltip(srcIn, 'SRC IN — drag a signal from the SOURCES field here to set this generator’s source.');
    const srcLcd = document.createElement('span');
    srcLcd.className = 'rw-pb-lcd';
    srcRow.append(srcIn, srcLcd);

    const mkNum = (label: string, step: string, tooltip: string, onInput: (v: number) => void): HTMLInputElement => {
      const row = document.createElement('div');
      row.className = 'rw-pb-row';
      const l = document.createElement('label');
      l.textContent = label;
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = step;
      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        if (Number.isFinite(v)) onInput(v);
      });
      attachTooltip(row, tooltip);
      row.append(l, inp);
      mod.appendChild(row);
      return inp;
    };

    mod.append(head, srcRow);
    const rate = mkNum('RATE', '0.01', 'LFO frequency in Hz (Free sync).', (v) => writeSlot(i, { frequency: v }));
    const amount = mkNum('AMT', '0.01', 'Modulation amount (depth).', (v) => writeSlot(i, { amount: v }));

    const outRow = document.createElement('div');
    outRow.className = 'rw-pb-row rw-pb-row--out';
    const outLabel = document.createElement('label');
    outLabel.textContent = 'OUT';
    const out = makeJack('rw-rack-jack--out');
    out.addEventListener('pointerdown', (ev) => dragSlotOut(ev, i, out));
    attachTooltip(out, 'Output — drag to any param jack to patch it; drop in space to unplug.');
    outRow.append(outLabel, out);
    mod.appendChild(outRow);

    slotOutJacks.set(i, out);
    slotSrcJacks.set(i, srcIn);
    slotRefs.push({ en, rate, amount, srcLcd });
    rail.appendChild(mod);
  }

  // SOURCES bus — a horizontal strip across the TOP of the bay, like a
  // hardware bus bar. Owner feedback drove this: with sources stacked
  // in the rail, four default-sine cables collapsed into one unreadable
  // vertical line. Spread across the top, every cable has a distinct
  // start point and drops visibly down to its module's SRC IN.
  const bus = document.createElement('div');
  bus.className = 'rw-pb-bus';
  {
    const t = document.createElement('div');
    t.className = 'rw-pb-field-title';
    t.textContent = 'SOURCES';
    bus.appendChild(t);
    const strip = document.createElement('div');
    strip.className = 'rw-pb-bus-strip';
    for (const s of SOURCE_JACKS) {
      const cell = document.createElement('div');
      cell.className = 'rw-pb-bus-cell';
      const jack = makeJack('rw-pb-jack--src');
      jack.addEventListener('pointerdown', (ev) => dragSource(ev, s.source, jack));
      attachTooltip(jack, `${s.label} — drag to a generator’s SRC IN.`);
      const l = document.createElement('span');
      l.textContent = s.label;
      cell.append(jack, l);
      strip.appendChild(cell);
      srcJacks.set(s.source, jack);
    }
    bus.appendChild(strip);
  }

  // GRAPH ENGINE section (per-node modules + rebuildGraphModules) is set
  // up further below, after the free-layout machinery (`unitHomes`,
  // `makeUnitDraggable`) it depends on is declared.

  // ---------------- faceplate columns ---------------------------------
  const col1 = document.createElement('div');
  col1.className = 'rw-pb-col';
  const col2 = document.createElement('div');
  col2.className = 'rw-pb-col';

  /** Best-effort numeric range for a modulatable Settings key, sourced
   *  from `PARAM_DOCS`'s human-readable `range` field — the SAME data
   *  that already drives in-app Help and the About page's Param
   *  Reference (one source, not a second hand-authored table). Handles
   *  the handful of radian ranges written as e.g. '0..2π'. A key
   *  `PARAM_DOCS` doesn't cover falls back to a generous, unclamped
   *  default — still a fully usable number input, just without a tight
   *  min/max hint. */
  function paramRangeFor(key: string): { min: number; max: number; step: number } {
    const text = PARAM_DOCS[key]?.range;
    const m = text?.match(/^(-?[\d.]+)(\s*π)?\s*\.\.\s*(-?[\d.]+)(\s*π)?/);
    const min = m ? parseFloat(m[1]) * (m[2] ? Math.PI : 1) : -10;
    const max = m ? parseFloat(m[3]) * (m[4] ? Math.PI : 1) : 10;
    const span = Math.abs(max - min);
    const step = span <= 2 ? 0.01 : span <= 20 ? 0.1 : 1;
    return { min, max, step };
  }

  /** Write a faceplate param's BASE value directly (never the live
   *  value — this is a UI write, same base/live split every other
   *  control in the app respects; modulation still layers on top via
   *  LiveValuesStore, untouched by this). Same runtime-key cast
   *  MidiMapping.ts already uses for "an arbitrary Settings key by
   *  string" — there's no narrower generic TS can offer here since the
   *  key only exists as a string at this point. */
  function writeParamValue(key: string, value: number): void {
    const k = key as keyof Settings;
    if (typeof settings.get(k) !== 'number') return;
    settings.set(k, value as never);
  }

  function addParamCell(grid: HTMLElement, key: string, label: string): void {
    const cell = document.createElement('div');
    cell.className = 'rw-pb-cell';
    const topRow = document.createElement('div');
    topRow.className = 'rw-pb-cell-top';
    const jack = makeJack('rw-rack-jack--in');
    jack.addEventListener('pointerdown', (ev) => dragParam(ev, key, jack));
    attachTooltip(jack, () => {
      const i = slotForParam(settings.get('modSlots'), key);
      if (i >= 0) return `${label} IN — patched from Function Gen ${i + 1}. Drag to move, drop in space to unplug.`;
      const patch = settings.get('modGraph');
      const bindingId = graphBindingForParam(patch, key);
      if (bindingId) {
        const b = patch?.bindings.find((x) => x.id === bindingId);
        const node = b ? patch?.nodes.find((n) => n.id === b.sourceNodeId) : null;
        const nodeLabel = node ? getDef(node.type)?.label ?? node.type : 'a graph node';
        return `${label} IN — patched from ${nodeLabel} (graph). Drag to move, drop in space to unplug.`;
      }
      return `${label} IN — drag to a generator OUT (or from one to here) to patch.`;
    });
    const l = document.createElement('span');
    l.textContent = label;
    topRow.append(jack, l);
    cell.appendChild(topRow);
    paramJacks.set(key, jack);

    // `cv:N` virtual CV-out targets aren't real Settings keys — they
    // get the IN jack only (no OUT jack, knob, or value field).
    if (key.startsWith('cv:')) {
      grid.appendChild(cell);
      return;
    }

    // OUT jack — the param's live value as a patchable signal
    // (hardware reference: every RE-4 param row has an input AND an
    // output jack). Dragging it creates/reuses a `param-out` node.
    const outJack = makeJack('rw-rack-jack--out rw-pb-jack--paramout');
    outJack.addEventListener('pointerdown', (ev) => dragParamOut(ev, key, outJack));
    attachTooltip(outJack, `${label} OUT — this param's live value as a signal. Drag onto another param (or a node's IN jack) to patch it there.`);
    topRow.appendChild(outJack);
    paramOutJacks.set(key, outJack);

    // Rotary knob + backlit value field (base value; the amber needle /
    // ▸ readout show the live value when modulation rides on top).
    const range = paramRangeFor(key);
    const ctl = document.createElement('div');
    ctl.className = 'rw-pb-cell-ctl';
    const knob = createMiniKnob({
      min: range.min, max: range.max, step: range.step,
      label,
      get: () => {
        const v = settings.get(key as keyof Settings);
        return typeof v === 'number' ? v : 0;
      },
      set: (v) => writeParamValue(key, v),
    });
    attachTooltip(knob.el, `${label} — drag vertically to adjust (Shift = fine). Amber needle = live value with modulation.`);
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'rw-pb-cell-value';
    input.step = String(range.step);
    input.min = String(range.min);
    input.max = String(range.max);
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      if (Number.isFinite(v)) writeParamValue(key, v);
    });
    attachTooltip(input, `${label} — base value (${range.min}..${range.max}). Any modulation on this param adds/multiplies on top, live.`);
    ctl.append(knob.el, input);
    cell.appendChild(ctl);
    const liveSpan = document.createElement('span');
    liveSpan.className = 'rw-pb-cell-live';
    liveSpan.hidden = true;
    cell.appendChild(liveSpan);
    paramValueInputs.set(key, input);
    paramKnobs.set(key, knob);
    paramLiveSpans.set(key, liveSpan);

    grid.appendChild(cell);
  }

  for (const field of buildFaceplate()) {
    const el = document.createElement('div');
    el.className = 'rw-pb-field';
    const t = document.createElement('div');
    t.className = 'rw-pb-field-title';
    t.textContent = field.title;
    const grid = document.createElement('div');
    grid.className = 'rw-pb-grid';
    for (const p of field.params) addParamCell(grid, p.key, p.label);
    el.append(t, grid);
    (field.column === 1 ? col1 : col2).appendChild(el);
  }

  // CV OUT module — real jacks for the cv:N virtual targets (the rack
  // skin skips these; here they have a home). Rebuilt when channels
  // change in I/O → CV Out.
  const cvField = document.createElement('div');
  cvField.className = 'rw-pb-field';
  col2.appendChild(cvField);
  function rebuildCvField(): void {
    for (const [key] of paramJacks) {
      if (key.startsWith('cv:')) paramJacks.delete(key);
    }
    cvField.replaceChildren();
    const t = document.createElement('div');
    t.className = 'rw-pb-field-title';
    t.textContent = 'CV OUT';
    const grid = document.createElement('div');
    grid.className = 'rw-pb-grid';
    cvField.append(t, grid);
    const cvOpts = cvOutputTargets(settings);
    if (!cvOpts.length) {
      const hint = document.createElement('div');
      hint.className = 'rw-pb-hint';
      hint.textContent = 'No CV output channels yet — add them in I/O → CV Out and jacks appear here.';
      grid.appendChild(hint);
    }
    for (const opt of cvOpts) {
      addParamCell(grid, String(opt.v), opt.l.replace(/^CV Out:\s*/, ''));
    }
  }
  rebuildCvField();
  settings.subscribe('cvOutputChannels', rebuildCvField);

  const deck = document.createElement('div');
  deck.className = 'rw-pb-deck';
  deck.append(rail, col1, col2);

  // The BOARD is the zoomable layer (CSS transform scale) - the cable
  // canvas stays UNscaled in screen space and measures live jack rects,
  // so cables stay crisp at any zoom (the graph editor's proven trick).
  const board = document.createElement('div');
  board.className = 'rw-pb-board';
  board.append(bus, deck);
  surface.appendChild(board);

  let zoom = 1;
  // Always re-derives from ground truth (the real, JS-untouched
  // container size + free mode's real absolute content extent) rather
  // than reading board.scrollWidth — board's CSS width is a percentage
  // of `surface`, so reading its rendered size back would just echo
  // whatever surface was last set to and never shrink again on a later
  // plain window resize (the bug behind nodes not resizing going from
  // a maximized window back down to a smaller one).
  function syncSurfaceSize(): void {
    const baseW = root.clientWidth || board.scrollWidth;
    const baseH = root.clientHeight || board.scrollHeight;
    const contentW = freeMode ? Math.max(baseW, parseFloat(board.style.minWidth) || 0) : baseW;
    const contentH = freeMode ? Math.max(baseH, parseFloat(board.style.minHeight) || 0) : baseH;
    surface.style.width = `${contentW * zoom}px`;
    surface.style.height = `${contentH * zoom}px`;
  }
  function applyZoom(next: number, anchorX?: number, anchorY?: number): void {
    next = Math.max(0.4, Math.min(2, next));
    if (next === zoom) return;
    const prev = zoom;
    // Keep the point under the anchor (cursor or viewport center)
    // stationary by compensating the scroll position.
    const rr = root.getBoundingClientRect();
    const ax = anchorX !== undefined ? anchorX - rr.left : rr.width / 2;
    const ay = anchorY !== undefined ? anchorY - rr.top : rr.height / 2;
    const cx = root.scrollLeft + ax;
    const cy = root.scrollTop + ay;
    zoom = next;
    board.style.transform = `scale(${zoom})`;
    syncSurfaceSize();
    root.scrollLeft = cx * (zoom / prev) - ax;
    root.scrollTop = cy * (zoom / prev) - ay;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  // Wheel zoom (cursor-anchored) + traditional -/100%/+ buttons for
  // pointing devices without a wheel.
  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    applyZoom(zoom * Math.exp(-e.deltaY * 0.0012), e.clientX, e.clientY);
  }, { passive: false });

  // Click-drag-to-pan on empty background, the standard node-editor
  // canvas gesture (Blender/Unity/Figma): grab anywhere that ISN'T a
  // module, jack, or control and drag to scroll the board around.
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    const t = e.target as HTMLElement;
    if (t.closest('.rw-pb-module, .rw-pb-field, .rw-pb-graphnode, .rw-rack-jack, .rw-pb-bus-cell, input, select, button')) return;
    e.preventDefault();
    const pid = e.pointerId;
    const startX = e.clientX, startY = e.clientY;
    const startLeft = root.scrollLeft, startTop = root.scrollTop;
    let started = false;
    root.setPointerCapture(pid);
    const onMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== pid) return;
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!started) {
        if (Math.hypot(dx, dy) < 4) return;
        started = true;
        root.classList.add('rw-pb-panning');
      }
      root.scrollLeft = startLeft - dx;
      root.scrollTop = startTop - dy;
    };
    const onUp = (ev: PointerEvent): void => {
      if (ev.pointerId !== pid) return;
      root.releasePointerCapture(pid);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onUp);
      root.removeEventListener('pointercancel', onUp);
      root.classList.remove('rw-pb-panning');
    };
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onUp);
  });

  const zoomBar = document.createElement('span');
  zoomBar.className = 'rw-pb-zoombar';
  const zoomOut = document.createElement('button');
  zoomOut.type = 'button';
  zoomOut.className = 'rw-pb-tidy';
  zoomOut.textContent = '-';
  attachTooltip(zoomOut, 'Zoom out (scroll wheel works anywhere on the board too).');
  zoomOut.addEventListener('click', () => applyZoom(zoom / 1.2));
  const zoomLabel = document.createElement('button');
  zoomLabel.type = 'button';
  zoomLabel.className = 'rw-pb-tidy';
  zoomLabel.textContent = '100%';
  attachTooltip(zoomLabel, 'Reset zoom to 100%.');
  zoomLabel.addEventListener('click', () => applyZoom(1));
  const zoomIn = document.createElement('button');
  zoomIn.type = 'button';
  zoomIn.className = 'rw-pb-tidy';
  zoomIn.textContent = '+';
  attachTooltip(zoomIn, 'Zoom in (scroll wheel works anywhere on the board too).');
  zoomIn.addEventListener('click', () => applyZoom(zoom * 1.2));
  zoomBar.append(zoomOut, zoomLabel, zoomIn);

  // ---------------- Max/MSP-style free layout -------------------------
  // Every module/field is draggable by its header. The stacked flow
  // layout is the tidy default; the FIRST drag freezes every unit at
  // its current position (re-parented to the surface, absolute), after
  // which units move freely like nodes in a patcher. TIDY restores the
  // flow. Cables follow automatically (anchors are live jack rects).
  // Free positions are session-local by design (the tidy layout is the
  // document; free layout is a workbench arrangement).
  let freeMode = false;
  // Baseline root width the current free-layout positions/widths were
  // measured against — lets the resize observer below rescale every
  // unit's left/width by the ratio of new/old width so a custom
  // arrangement shrinks and grows horizontally WITH the window instead
  // of holding fixed pixel geometry (owner bug report: nodes didn't
  // resize going from a maximized window back down to a smaller one).
  let freeRefWidth: number | null = null;
  interface UnitHome { unit: HTMLElement; parent: HTMLElement; next: Node | null }
  const unitHomes: UnitHome[] = [];

  const tidyBtn = document.createElement('button');
  tidyBtn.type = 'button';
  tidyBtn.className = 'rw-pb-tidy';
  tidyBtn.textContent = 'TIDY';
  attachTooltip(tidyBtn, 'Snap all modules back into the stacked layout (drag any module header to arrange freely, Max/MSP style).');
  tidyBtn.addEventListener('click', () => { suspendedFree = null; tidy(); });
  const pbTools = document.createElement('span');
  pbTools.className = 'rw-pb-tools';
  pbTools.append(zoomBar, tidyBtn);
  bus.appendChild(pbTools);

  function allUnits(): HTMLElement[] {
    return [
      bus,
      ...Array.from(surface.querySelectorAll<HTMLElement>('.rw-pb-module, .rw-pb-field, .rw-pb-graphnode')),
    ];
  }

  function freeze(): void {
    if (freeMode) return;
    freeMode = true;
    const bRect = board.getBoundingClientRect();
    const placed = allUnits().map((unit) => ({ unit, r: unit.getBoundingClientRect() }));
    unitHomes.length = 0;
    for (const { unit } of placed) {
      unitHomes.push({ unit, parent: unit.parentElement!, next: unit.nextSibling });
    }
    // Two passes: measure everything first, THEN re-parent/absolutize
    // (in BOARD coordinates, dividing out the zoom).
    board.style.minHeight = `${board.scrollHeight}px`;
    board.style.minWidth = `${board.scrollWidth}px`;
    for (const { unit, r } of placed) {
      unit.classList.add('rw-pb-unit-free');
      unit.style.left = `${(r.left - bRect.left) / zoom}px`;
      unit.style.top = `${(r.top - bRect.top) / zoom}px`;
      unit.style.width = `${r.width / zoom}px`;
      board.appendChild(unit);
    }
    root.classList.add('rw-pb-freemode');
    freeRefWidth = root.getBoundingClientRect().width;
    syncSurfaceSize();
  }

  function tidy(): void {
    if (!freeMode) return;
    freeMode = false;
    freeRefWidth = null;
    for (const h of unitHomes) {
      h.unit.classList.remove('rw-pb-unit-free');
      h.unit.style.left = '';
      h.unit.style.top = '';
      h.unit.style.width = '';
      // The recorded next-sibling may itself have been re-parented to
      // the surface; unitHomes is in original DOM order, and the unit
      // parents hold only units, so appending in order reproduces the
      // flow exactly.
      if (h.next && h.next.parentNode === h.parent) h.parent.insertBefore(h.unit, h.next);
      else h.parent.appendChild(h.unit);
    }
    unitHomes.length = 0;
    board.style.minHeight = '';
    board.style.minWidth = '';
    root.classList.remove('rw-pb-freemode');
    syncSurfaceSize();
  }

  /** Free-layout collision resolution (owner: "patch nodes can't
   *  overlap each other"): after a drop, push the dropped unit out of
   *  any unit it intersects, along whichever axis needs the smaller
   *  shove, re-scanning until clean. Runs on RELEASE, not per-move —
   *  mid-drag overlap is allowed (it's how you pass over the board),
   *  the resting layout is what stays collision-free. Iteration-capped:
   *  a pathological packing degrades to "some overlap remains" rather
   *  than a livelock. */
  function resolveOverlap(unit: HTMLElement): void {
    const GAP = 10;
    const others = (): HTMLElement[] =>
      Array.from(board.querySelectorAll<HTMLElement>('.rw-pb-unit-free')).filter((u) => u !== unit);
    const overlapsAny = (): boolean => {
      const l = parseFloat(unit.style.left) || 0;
      const t = parseFloat(unit.style.top) || 0;
      const w = unit.offsetWidth, h = unit.offsetHeight;
      return others().some((other) => {
        const ol = parseFloat(other.style.left) || 0;
        const ot = parseFloat(other.style.top) || 0;
        return Math.min(l + w, ol + other.offsetWidth) - Math.max(l, ol) > 0
          && Math.min(t + h, ot + other.offsetHeight) - Math.max(t, ot) > 0;
      });
    };
    for (let iter = 0; iter < 24; iter++) {
      const l = parseFloat(unit.style.left) || 0;
      const t = parseFloat(unit.style.top) || 0;
      const w = unit.offsetWidth, h = unit.offsetHeight;
      let pushed = false;
      for (const other of others()) {
        const ol = parseFloat(other.style.left) || 0;
        const ot = parseFloat(other.style.top) || 0;
        const ow = other.offsetWidth, oh = other.offsetHeight;
        const overlapX = Math.min(l + w, ol + ow) - Math.max(l, ol);
        const overlapY = Math.min(t + h, ot + oh) - Math.max(t, ot);
        if (overlapX <= 0 || overlapY <= 0) continue;
        if (overlapX < overlapY) {
          const nl = l + w / 2 < ol + ow / 2 ? ol - w - GAP : ol + ow + GAP;
          unit.style.left = `${Math.max(0, nl)}px`;
        } else {
          const nt = t + h / 2 < ot + oh / 2 ? ot - h - GAP : ot + oh + GAP;
          unit.style.top = `${Math.max(0, nt)}px`;
        }
        pushed = true;
        break; // positions changed — re-scan from the top
      }
      if (!pushed) break;
    }
    // Guaranteed fallback: a dense column can exhaust the push cascade
    // (each push lands on the next unit down). If ANY overlap survives,
    // park the unit below the lowest one — always collision-free.
    if (overlapsAny()) {
      let maxBottom = 0;
      for (const other of others()) {
        const b = (parseFloat(other.style.top) || 0) + other.offsetHeight;
        if (b > maxBottom) maxBottom = b;
      }
      unit.style.top = `${maxBottom + GAP}px`;
    }
    // Grow the board if the push landed past its current edge.
    const need = (parseFloat(unit.style.left) || 0) + unit.offsetWidth + 24;
    if (need > board.offsetWidth) board.style.minWidth = `${need}px`;
    const needH = (parseFloat(unit.style.top) || 0) + unit.offsetHeight + 24;
    if (needH > board.offsetHeight) board.style.minHeight = `${needH}px`;
    syncSurfaceSize();
  }

  // Stack containers a dragged unit can reorder within (owner request:
  // drag-and-drop node ORDER inside the default vertical stacks, with
  // an insertion line; dragging away from every stack breaks the board
  // into free layout instead).
  const stacks = (): HTMLElement[] => [rail, col1, col2];
  const insertLine = document.createElement('div');
  insertLine.className = 'rw-pb-insertline';

  /** True for a non-draggable divider/label left directly in a stack
   *  (e.g. `graphTitle`, the graph-empty message) — these are skipped
   *  as reorder boundaries so a stack full of real units doesn't treat
   *  a label as either the "last unit" for bottom-edge purposes or a
   *  valid "insert before this" reference. */
  const isStaticChild = (el: Element): boolean => (el as HTMLElement).dataset?.pbStatic === 'true';

  function stackUnder(x: number, y: number): HTMLElement | null {
    if (freeMode) return null;
    for (const c of stacks()) {
      const r = c.getBoundingClientRect();
      // Vertical extent ends at the LAST UNIT, not the flex column's box
      // (the columns stretch to the bay's full height, and their empty
      // tails would otherwise swallow every breakout drop).
      const units = Array.from(c.children).filter((el) => el !== insertLine && !isStaticChild(el)) as HTMLElement[];
      const last = units[units.length - 1];
      const bottom = last ? last.getBoundingClientRect().bottom + 30 : r.top + 40;
      if (x >= r.left - 20 && x <= r.right + 20 && y >= r.top - 10 && y <= bottom) return c;
    }
    return null;
  }

  function insertRefIn(container: HTMLElement, y: number, dragged: HTMLElement): HTMLElement | null {
    for (const child of Array.from(container.children) as HTMLElement[]) {
      if (child === dragged || child === insertLine || isStaticChild(child)) continue;
      const r = child.getBoundingClientRect();
      if (y < r.top + r.height / 2) return child;
    }
    return null;
  }

  function makeUnitDraggable(unit: HTMLElement, handle: HTMLElement): void {
    handle.classList.add('rw-pb-unit-handle');
    handle.addEventListener('pointerdown', (ev) => {
      const t = ev.target as HTMLElement;
      if (t.closest('input, select, button, .rw-rack-jack')) return;
      ev.preventDefault();
      const pid = ev.pointerId;
      const startX = ev.clientX, startY = ev.clientY;
      let started = false;
      let baseL = 0, baseT = 0;
      let stackTarget: HTMLElement | null = null;
      const canStack = unit !== bus; // the bus stays a top strip
      const doc = root.ownerDocument;

      const beginFree = (e: PointerEvent): void => {
        freeze();
        baseL = parseFloat(unit.style.left) || 0;
        baseT = parseFloat(unit.style.top) || 0;
        // Re-base the gesture so the unit doesn't jump.
        (unit.dataset.dragBaseX as unknown) = undefined;
        unit.classList.add('rw-pb-unit-dragging');
        void e;
      };

      const onMove = (e: PointerEvent): void => {
        if (e.pointerId !== pid) return;
        if (!started) {
          if (Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return;
          started = true;
          if (!freeMode) unit.classList.add('rw-pb-unit-lifting');
          else { beginFree(e); }
        }
        e.preventDefault();

        if (!freeMode) {
          // TIDY mode: reorder within a stack (insertion line), or lift
          // out past every stack to break into free layout on drop.
          stackTarget = canStack ? stackUnder(e.clientX, e.clientY) : null;
          if (stackTarget) {
            const ref = insertRefIn(stackTarget, e.clientY, unit);
            if (ref) stackTarget.insertBefore(insertLine, ref);
            else stackTarget.appendChild(insertLine);
          } else {
            insertLine.remove();
          }
          return;
        }

        // FREE mode: absolute move (pointer deltas are visual pixels;
        // unit coords are board units) + magnetic snapping to nearby
        // nodes (x-align, top-align, or stack directly beneath).
        let nl = Math.max(0, baseL + (e.clientX - startX) / zoom);
        let nt = Math.max(0, baseT + (e.clientY - startY) / zoom);
        const SNAP = 12;
        for (const other of Array.from(board.querySelectorAll<HTMLElement>('.rw-pb-unit-free'))) {
          if (other === unit) continue;
          const ol = parseFloat(other.style.left) || 0;
          const ot = parseFloat(other.style.top) || 0;
          const ow = other.offsetWidth, oh = other.offsetHeight;
          const xOverlap = nl < ol + ow && nl + unit.offsetWidth > ol;
          if (Math.abs(nl - ol) < SNAP) nl = ol;                        // left-align
          if (xOverlap && Math.abs(nt - (ot + oh + 10)) < SNAP) nt = ot + oh + 10; // stack below
          if (xOverlap && Math.abs(nt + unit.offsetHeight + 10 - ot) < SNAP) nt = ot - unit.offsetHeight - 10; // stack above
          if (Math.abs(nt - ot) < SNAP && !xOverlap) nt = ot;           // top-align
        }
        unit.style.left = `${nl}px`;
        unit.style.top = `${nt}px`;
        const need = nl + unit.offsetWidth + 24;
        if (need > board.offsetWidth) { board.style.minWidth = `${need}px`; syncSurfaceSize(); }
        const needH = nt + unit.offsetHeight + 24;
        if (needH > board.offsetHeight) { board.style.minHeight = `${needH}px`; syncSurfaceSize(); }
      };

      const onUp = (e: PointerEvent): void => {
        if (e.pointerId !== pid) return;
        doc.removeEventListener('pointermove', onMove);
        doc.removeEventListener('pointerup', onUp);
        doc.removeEventListener('pointercancel', onUp);
        unit.classList.remove('rw-pb-unit-dragging', 'rw-pb-unit-lifting');
        if (!started) { insertLine.remove(); return; }
        if (!freeMode) {
          if (stackTarget && insertLine.parentNode === stackTarget) {
            // Reorder within/into the stack at the insertion line.
            stackTarget.insertBefore(unit, insertLine);
            insertLine.remove();
          } else {
            // Dropped away from every stack: break out to free layout
            // and place the unit under the pointer.
            insertLine.remove();
            freeze();
            const bRect = board.getBoundingClientRect();
            unit.style.left = `${Math.max(0, (e.clientX - bRect.left) / zoom - unit.offsetWidth / 2)}px`;
            unit.style.top = `${Math.max(0, (e.clientY - bRect.top) / zoom - 10)}px`;
            resolveOverlap(unit);
          }
        } else {
          // Free-mode drag released: settle into a non-overlapping spot.
          resolveOverlap(unit);
        }
      };
      doc.addEventListener('pointermove', onMove, { passive: false });
      doc.addEventListener('pointerup', onUp);
      doc.addEventListener('pointercancel', onUp);
    });
  }

  // Handles: module heads, field titles, the bus title. Graph node
  // modules get their handle wired individually in rebuildGraphModules
  // (they're created dynamically, after this one-shot setup loop runs).
  for (const m of Array.from(surface.querySelectorAll<HTMLElement>('.rw-pb-module'))) {
    const head = m.querySelector<HTMLElement>('.rw-pb-module-head');
    if (head) makeUnitDraggable(m, head);
  }
  for (const f of Array.from(surface.querySelectorAll<HTMLElement>('.rw-pb-field'))) {
    const title = f.querySelector<HTMLElement>('.rw-pb-field-title');
    if (title) makeUnitDraggable(f, title);
  }
  {
    const busTitle = bus.querySelector<HTMLElement>('.rw-pb-field-title');
    if (busTitle) makeUnitDraggable(bus, busTitle);
  }
  // GRAPH ENGINE — one module per graph node in the patch, full stop
  // (owner: "show all nodes, active or not" — a real node-editor
  // surface, not a filtered activity view). A node with no connections
  // yet (freshly added via the right-click Add Node menu, or just never
  // wired to anything) still gets a module, dimmed via `--inert` in
  // frame() so a glance still tells live signal-carrying nodes apart
  // from placeholders. Every OUT/IN row comes from the node TYPE's own
  // `def.outputs`/`def.inputs` (not "whatever's currently plugged"), so
  // an unwired node still has jacks to drag from/to — the whole point of
  // being able to add a node here and wire it up without leaving the
  // bay.
  //
  // The module itself is a full peer of a FUNCTION GENERATOR module or
  // param field (owner: "globally shared parallel node behavior
  // properties") — same `.rw-pb-module-head` handle, same
  // `makeUnitDraggable`, reorderable within `rail`'s stack or breakable
  // into free layout — it's a real child of `rail`, not a separate
  // wrapper `allUnits()` has to special-case. `graphTitle` and the
  // empty-state message are the only non-draggable (`data-pb-static`)
  // children left in the stack, so stack reordering skips over them
  // rather than treating label text as a drop boundary.
  const graphTitle = document.createElement('div');
  graphTitle.className = 'rw-pb-field-title';
  graphTitle.dataset.pbStatic = 'true';
  graphTitle.textContent = 'GRAPH ENGINE';
  attachTooltip(graphTitle, 'Every node in the graph patch. Dimmed = not connected to anything yet. Drag a module by its header to reorder/move it, like any other module. Right-click empty board space to add a node; drag a bound param\'s cable (on the faceplate) to re-target or unplug it.');
  rail.appendChild(graphTitle);
  const graphEmpty = document.createElement('div');
  graphEmpty.className = 'rw-pb-graph-empty';
  graphEmpty.dataset.pbStatic = 'true';
  graphEmpty.textContent = 'No graph nodes yet — right-click the board to add one, or use the Graph editor.';

  /** Keyed `${nodeId}#${port}`, `port` always a real declared port name
   *  (never '') — resolve a binding/wire's possibly-unset `sourcePort`
   *  via `defaultOutputPort()` before looking a jack up here.
   *  `graphInputJacks` (IN side) is declared earlier, alongside the
   *  other static jack registries. */
  const graphNodeJacks = new Map<string, HTMLElement>();
  /** One `.rw-pb-graphnode` element per node in the patch, kept alive
   *  across rebuilds (see rebuildGraphModules) so a module's free-layout
   *  position / drag-handler binding survives unrelated `modGraph`
   *  writes (e.g. a param tweak on some OTHER node). */
  const graphModuleEls = new Map<string, HTMLElement>();
  /** On-faceplate control per node param, keyed `${nodeId}#${paramName}`
   *  — the node's own knobs (rate, shape, etc.), so a module feels like
   *  a real synth voice, not just jacks and a label (owner: "control
   *  knobs on the node in the patch bay so it feels like an actual
   *  analog synth"). Reconciled every rebuild (same rule as IN/OUT
   *  rows — a node's `type`, and therefore its param set, can mutate in
   *  place); VALUES refreshed separately via `refreshGraphControls()`
   *  so typing into one doesn't require a structural rebuild. */
  const graphParamInputs = new Map<string, { el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement; kind: 'number' | 'enum' | 'boolean' | 'text' }>();
  /** Rotary knobs for graph node NUMBER params (`${nodeId}#${param}`). */
  const graphKnobs = new Map<string, MiniKnob>();
  /** Live trace surfaces for `scope` nodes (nodeId → canvas + ring
   *  buffer). Fed each frame from `engine.probe()` — the same sampling
   *  mechanism as the graph editor's Probe overlay. */
  const scopeCanvases = new Map<string, { canvas: HTMLCanvasElement; buf: number[] }>();
  /** Engine handle, resolved lazily the first time a scope module needs
   *  probing (never forces engine construction for scope-less patches). */
  let engineRef: GraphEngine | null = null;
  // null (not '') so the very first call — an empty graph's signature
  // is also '' — doesn't collide with "unchanged" and skip building
  // the empty-state message.
  let graphSig: string | null = null;

  /** The declared name of `nodeId`'s default (first) output port, or
   *  'out' if the node/def can't be resolved — the same fallback the
   *  engine and Advanced-view editor use for an unset `sourcePort`. */
  function defaultOutputPort(nodeId: string): string {
    const node = settings.get('modGraph')?.nodes.find((n) => n.id === nodeId);
    const def = node ? getDef(node.type) : null;
    return def?.outputs[0]?.name ?? 'out';
  }

  function rebuildGraphModules(): void {
    const patch = settings.get('modGraph');
    const nodes = patch?.nodes ?? [];

    // Purely structural: which nodes exist, and their type (which
    // determines their fixed IN/OUT port layout). Connection state
    // (bindings, wires) is drawn live every frame in frame() — it
    // never needs to trigger a DOM rebuild here.
    const sig = nodes.map((n) => `${n.id}:${n.type}`).join('|');
    if (sig === graphSig) return;
    graphSig = sig;

    const nodeIds = new Set(nodes.map((n) => n.id));

    // Remove modules for nodes that no longer exist — actual DOM
    // removal (not a full innerHTML wipe) so an unrelated node's module
    // elsewhere in `rail`/`board` (possibly mid free-layout-drag) is
    // untouched. Also prune any stale `unitHomes` entry so `tidy()`
    // never tries to reinsert a detached element (see freeze()/tidy()).
    for (const [nodeId, el] of Array.from(graphModuleEls)) {
      if (nodeIds.has(nodeId)) continue;
      el.remove();
      graphModuleEls.delete(nodeId);
      for (const key of Array.from(graphNodeJacks.keys())) {
        if (key.startsWith(`${nodeId}#`)) graphNodeJacks.delete(key);
      }
      for (const key of Array.from(graphInputJacks.keys())) {
        if (key.startsWith(`${nodeId}#`)) graphInputJacks.delete(key);
      }
      for (const key of Array.from(graphParamInputs.keys())) {
        if (key.startsWith(`${nodeId}#`)) graphParamInputs.delete(key);
      }
      for (const key of Array.from(graphKnobs.keys())) {
        if (key.startsWith(`${nodeId}#`)) graphKnobs.delete(key);
      }
      for (const key of Array.from(shapeJacks.keys())) {
        if (key.startsWith(`${nodeId}#`)) shapeJacks.delete(key);
      }
      scopeCanvases.delete(nodeId);
      const homeIdx = unitHomes.findIndex((h) => h.unit === el);
      if (homeIdx >= 0) unitHomes.splice(homeIdx, 1);
    }

    if (nodes.length === 0) {
      graphEmpty.remove();
      rail.insertBefore(graphEmpty, graphTitle.nextSibling);
      return;
    }
    graphEmpty.remove();

    /** Free-mode-created modules this pass; collision-resolved at the
     *  bottom of the function once their rows exist (real height). */
    const spawnedFreeThisPass: HTMLElement[] = [];

    for (const node of nodes) {
      const nodeId = node.id;
      const def = getDef(node.type);
      const label = def?.label ?? node.type;

      let mod = graphModuleEls.get(nodeId);
      let head: HTMLElement;
      if (!mod) {
        mod = document.createElement('div');
        mod.className = 'rw-pb-graphnode';
        head = document.createElement('div');
        head.className = 'rw-pb-module-head';
        // Mute LED, same convention as a FUNCTION GENERATOR module's own
        // enable toggle (owner: knobs/toggles here should feel like a
        // real synth module, not just jacks and a label).
        const en = document.createElement('input');
        en.type = 'checkbox';
        en.className = 'rw-pb-led-toggle';
        en.addEventListener('change', () => {
          const cur = settings.get('modGraph');
          if (!cur) return;
          const upd: GraphPatch = { ...cur, nodes: cur.nodes.map((n) => (n.id === nodeId ? { ...n, enabled: en.checked } : n)) };
          settings.set('modGraph', upd);
          void getEngine().then((e) => e.setPatch(upd));
        });
        attachTooltip(en, 'Enable this node (muted: tick is skipped, every output reads 0).');
        const titleEl = document.createElement('span');
        titleEl.className = 'rw-pb-graphnode-title';
        head.append(en, titleEl);
        mod.appendChild(head);
        makeUnitDraggable(mod, head);
        rail.appendChild(mod);
        graphModuleEls.set(nodeId, mod);
        if (freeMode) {
          // Free mode: the rail is an empty flow container — a module
          // left there renders statically at the board's top-left OVER
          // the free units (a real reported bug: spawned nodes
          // overlapping). Promote every module created during free
          // mode to a free unit immediately, whatever created it
          // (right-click menu, tutorial action button, MCP
          // add_graph_node, Graph editor); cursor-positioned spawns
          // then just move it (placeSpawnedModule). Collision
          // resolution happens at the END of this rebuild — the
          // module has no rows yet here, so its height would read
          // head-only and the push math would under-shoot.
          mod.classList.add('rw-pb-unit-free');
          mod.style.width = '200px';
          mod.style.left = '20px';
          mod.style.top = '20px';
          unitHomes.push({ unit: mod, parent: rail, next: null });
          board.appendChild(mod);
          spawnedFreeThisPass.push(mod);
        }
      } else {
        head = mod.querySelector('.rw-pb-module-head')!;
      }
      const titleEl = head.querySelector('.rw-pb-graphnode-title')!;
      if (titleEl.textContent !== label) titleEl.textContent = label;

      // Scope trace — present iff the node's CURRENT type is 'scope'
      // (same reconcile-every-rebuild rule as the port/param rows: a
      // node's type can mutate in place under the same id).
      const wantScope = node.type === 'scope';
      if (scopeCanvases.has(nodeId) && !wantScope) {
        scopeCanvases.get(nodeId)!.canvas.closest('.rw-pb-scoperow')?.remove();
        scopeCanvases.delete(nodeId);
      } else if (!scopeCanvases.has(nodeId) && wantScope) {
        const row = document.createElement('div');
        row.className = 'rw-pb-row rw-pb-scoperow';
        const cv = document.createElement('canvas');
        cv.className = 'rw-pb-scope-canvas';
        cv.width = 180;
        cv.height = 44;
        attachTooltip(cv, 'Live trace of the signal passing through this scope (out = in, unchanged).');
        row.appendChild(cv);
        mod.insertBefore(row, mod.querySelector('.rw-pb-row--out'));
        scopeCanvases.set(nodeId, { canvas: cv, buf: [] });
        if (!engineRef) void getEngine().then((e) => { engineRef = e; });
      }

      // Reconcile IN rows against the node's CURRENT type's input
      // ports — NOT "built once at creation": Beginner view mutates an
      // EXISTING node's `type` in place when its source dropdown
      // changes (same id, e.g. LFO -> Noise), so a module can gain or
      // lose input ports without its element ever being torn down. A
      // first version of this gated IN-row creation on `!mod` (module
      // just-created) and missed exactly this case — caught live by
      // retargeting a Beginner row's source from LFO to Noise and
      // finding the resulting module had no "clock" IN row at all.
      const wantedIns = new Map((def?.inputs ?? []).map((p) => [p.name, p] as const));
      const haveIns = new Set(
        [...graphInputJacks.keys()]
          .filter((k) => k.startsWith(`${nodeId}#`))
          .map((k) => k.slice(nodeId.length + 1)),
      );
      for (const port of haveIns) {
        if (wantedIns.has(port)) continue;
        graphInputJacks.get(`${nodeId}#${port}`)?.closest('.rw-pb-row')?.remove();
        graphInputJacks.delete(`${nodeId}#${port}`);
      }
      for (const [portName, portSpec] of wantedIns) {
        if (graphInputJacks.has(`${nodeId}#${portName}`)) continue;
        const row = document.createElement('div');
        row.className = 'rw-pb-row';
        const rowLabel = document.createElement('label');
        rowLabel.textContent = portSpec.label ?? portSpec.name;
        const jack = makeJack('rw-rack-jack--in rw-pb-jack--graphin');
        jack.addEventListener('pointerdown', (ev) => dragGraphIn(ev, nodeId, portSpec.name, jack));
        attachTooltip(jack, () => {
          const cur = settings.get('modGraph');
          const curNode = cur?.nodes.find((n) => n.id === nodeId);
          const ref = curNode?.inputs[portSpec.name];
          const portLabel = portSpec.label ?? portSpec.name;
          if (!ref) return `${label} · ${portLabel} IN — drag from another node's OUT jack here to wire it (or drag this jack to one).`;
          const { nodeId: srcId } = splitInputRef(ref);
          const srcNode = cur?.nodes.find((n) => n.id === srcId);
          const srcLabel = srcNode ? (getDef(srcNode.type)?.label ?? srcNode.type) : 'an unknown node';
          return `${label} · ${portLabel} IN — wired from ${srcLabel}. Drag to move, drop in space to unplug.`;
        });
        row.append(jack, rowLabel);
        // Land new IN rows right before the first OUT row (or at the
        // end if there isn't one yet) so IN stays visually above OUT
        // even when ports arrive across separate rebuilds.
        mod.insertBefore(row, mod.querySelector('.rw-pb-row--out'));
        graphInputJacks.set(`${nodeId}#${portName}`, jack);
      }

      // Reconcile param controls (rate, shape, etc.) — the node's OWN
      // knobs, between its IN and OUT jacks, same signal-flow-order
      // convention. Free-text params (only the Note node's `text`) get
      // a full-width textarea (owner bug report: a Note added via the
      // bay had nothing to type into — Note has no ports, so its
      // module was a bare title with no way to actually write a note).
      const wantedParams = new Map(Object.entries(def?.params ?? {}));
      const haveParams = new Set(
        [...graphParamInputs.keys()]
          .filter((k) => k.startsWith(`${nodeId}#`))
          .map((k) => k.slice(nodeId.length + 1)),
      );
      for (const name of haveParams) {
        if (wantedParams.has(name)) continue;
        graphParamInputs.get(`${nodeId}#${name}`)?.el.closest('.rw-pb-row')?.remove();
        graphParamInputs.delete(`${nodeId}#${name}`);
        graphKnobs.delete(`${nodeId}#${name}`);
        shapeJacks.delete(`${nodeId}#${name}`);
      }
      for (const [paramName, spec] of wantedParams) {
        if (graphParamInputs.has(`${nodeId}#${paramName}`)) continue;

        // Free-text (only the Note node's `text`): a full-width
        // textarea, ComfyUI-style like the Graph editor's own inline
        // note-editing — a compact label+control row would squeeze a
        // multi-line field into a sliver. No knob, no jack, no cable.
        if (spec.kind === 'text') {
          const row = document.createElement('div');
          row.className = 'rw-pb-row rw-pb-row--note';
          const ta = document.createElement('textarea');
          ta.className = 'rw-pb-note-text';
          ta.placeholder = 'Notes…';
          ta.spellcheck = false;
          ta.value = String(node.params[paramName] ?? spec.default);
          ta.addEventListener('input', () => writeGraphNodeParam(nodeId, paramName, ta.value));
          // Typing must never bubble into the module-header drag or the
          // board's right-click Add Node menu. Header-drag is already
          // scoped to `.rw-pb-module-head` (this row lives in the body,
          // never inside it) and the board's contextmenu handler already
          // excludes anything inside `.rw-pb-graphnode` wholesale, so no
          // extra guards are needed here — unlike AdvancedView.ts's
          // canvas-wide mousedown/keydown/contextmenu listeners, which
          // DO need the `.rw-graph-note-text` closest-check bailouts
          // this view's per-row-scoped listeners don't share.
          row.appendChild(ta);
          mod.insertBefore(row, mod.querySelector('.rw-pb-row--out'));
          graphParamInputs.set(`${nodeId}#${paramName}`, { el: ta, kind: 'text' });
          continue;
        }

        const row = document.createElement('div');
        row.className = 'rw-pb-row';
        const rowLabel = document.createElement('label');
        rowLabel.textContent = paramName;
        let ctl: HTMLInputElement | HTMLSelectElement;
        let kind: 'number' | 'enum' | 'boolean';
        let knob: MiniKnob | null = null;
        if (spec.kind === 'number') {
          kind = 'number';
          // Rotary knob beside the LCD field — same pot-above-legend
          // pairing as the Classic modules / faceplate cells (owner:
          // adjust values with GUI knobs, eurorack style).
          knob = createMiniKnob({
            min: spec.min, max: spec.max, step: spec.step,
            label: `${label} ${paramName}`,
            defaultValue: spec.default,
            get: () => {
              const cur = settings.get('modGraph')?.nodes.find((n) => n.id === nodeId);
              const v = cur?.params[paramName] ?? spec.default;
              return typeof v === 'number' ? v : spec.default;
            },
            set: (v) => writeGraphNodeParam(nodeId, paramName, v),
          });
          const input = document.createElement('input');
          input.type = 'number';
          input.step = String(spec.step);
          input.min = String(spec.min);
          input.max = String(spec.max);
          input.addEventListener('input', () => {
            const v = parseFloat(input.value);
            if (Number.isFinite(v)) writeGraphNodeParam(nodeId, paramName, v);
          });
          ctl = input;
        } else if (spec.kind === 'enum') {
          kind = 'enum';
          const sel = document.createElement('select');
          sel.className = 'rw-select';
          for (const opt of spec.options) {
            const o = document.createElement('option');
            o.value = opt; o.textContent = opt;
            sel.appendChild(o);
          }
          sel.addEventListener('change', () => writeGraphNodeParam(nodeId, paramName, sel.value));
          ctl = sel;
          // Waveform picker (LFO shape): a jack the SOURCES bus
          // waveform jacks can plug into — drag TRI here for a
          // triangle wave (owner ask). Threshold in waveShapeMatches
          // keeps non-waveform enums (Noise kind, Ramp mode) jack-free.
          if (waveShapeMatches(spec.options) >= 2) {
            const sj = makeJack('rw-rack-jack--in rw-pb-jack--shape');
            sj.addEventListener('pointerdown', (ev) => dragShapeJack(ev, nodeId, paramName, sj));
            attachTooltip(sj, `${label} · ${paramName} — plug a SOURCES waveform jack in here (or drag this to one) to pick the wave.`);
            row.appendChild(sj);
            shapeJacks.set(`${nodeId}#${paramName}`, sj);
          }
        } else {
          kind = 'boolean';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.addEventListener('change', () => writeGraphNodeParam(nodeId, paramName, cb.checked));
          ctl = cb;
        }
        attachTooltip(row, `${label} · ${paramName}`);
        row.append(rowLabel);
        if (knob) {
          row.appendChild(knob.el);
          graphKnobs.set(`${nodeId}#${paramName}`, knob);
        }
        row.appendChild(ctl);
        mod.insertBefore(row, mod.querySelector('.rw-pb-row--out'));
        graphParamInputs.set(`${nodeId}#${paramName}`, { el: ctl, kind });
      }

      // Reconcile OUT rows against the node's full declared output
      // list (`def.outputs`) — not just ports something happens to be
      // plugged into yet, so a freshly-added, unwired node still has a
      // jack to drag a first connection FROM.
      const wantedOuts = new Map((def?.outputs ?? []).map((p) => [p.name, p] as const));
      const haveOuts = new Set(
        [...graphNodeJacks.keys()]
          .filter((k) => k.startsWith(`${nodeId}#`))
          .map((k) => k.slice(nodeId.length + 1)),
      );
      for (const port of haveOuts) {
        if (wantedOuts.has(port)) continue;
        graphNodeJacks.get(`${nodeId}#${port}`)?.closest('.rw-pb-row')?.remove();
        graphNodeJacks.delete(`${nodeId}#${port}`);
      }
      for (const [portName, portSpec] of wantedOuts) {
        if (graphNodeJacks.has(`${nodeId}#${portName}`)) continue;
        const row = document.createElement('div');
        row.className = 'rw-pb-row rw-pb-row--out';
        const rowLabel = document.createElement('label');
        rowLabel.textContent = portName === 'out' ? 'OUT' : (portSpec.label ?? portName);
        const jack = makeJack('rw-rack-jack--out rw-pb-jack--graphout');
        jack.addEventListener('pointerdown', (ev) => dragGraphOut(ev, `${nodeId}#${portName}`, jack));
        attachTooltip(jack, `${label}${portName !== 'out' ? ' · ' + portName : ''} OUT — drag onto another node's IN jack to wire it. To re-target/unplug a PARAM binding, drag the cable's param-end on the faceplate instead.`);
        row.append(rowLabel, jack);
        mod.appendChild(row);
        graphNodeJacks.set(`${nodeId}#${portName}`, jack);
      }
    }

    // Now that every new module has its full row set (real height),
    // settle free-mode spawns into non-overlapping spots.
    for (const mod of spawnedFreeThisPass) resolveOverlap(mod);
  }

  /** Write one graph node's param — same two-write pattern (Settings +
   *  live engine push) every graph-editing surface uses. */
  function writeGraphNodeParam(nodeId: string, paramName: string, value: number | string | boolean): void {
    const patch = settings.get('modGraph');
    if (!patch) return;
    const next: GraphPatch = {
      ...patch,
      nodes: patch.nodes.map((n) => (n.id === nodeId ? { ...n, params: { ...n.params, [paramName]: value } } : n)),
    };
    settings.set('modGraph', next);
    void getEngine().then((e) => e.setPatch(next));
  }

  /** Refresh control VALUES (param inputs + the enable LED) from the
   *  current patch — separate from `rebuildGraphModules()`'s structural
   *  work so typing into one control doesn't require (or race) a DOM
   *  rebuild. Skips any input the user is actively editing, same rule
   *  `refreshSlots()` uses for the Classic RATE/AMT fields below. */
  function refreshGraphControls(): void {
    const patch = settings.get('modGraph');
    for (const [nodeId, mod] of graphModuleEls) {
      const node = patch?.nodes.find((n) => n.id === nodeId);
      const en = mod.querySelector<HTMLInputElement>('.rw-pb-led-toggle');
      if (en && document.activeElement !== en) en.checked = node?.enabled !== false;
    }
    for (const [key, entry] of graphParamInputs) {
      const { nodeId, port: paramName } = splitJackKey(key);
      const node = patch?.nodes.find((n) => n.id === nodeId);
      const def = node ? getDef(node.type) : null;
      const spec = def?.params[paramName];
      if (!spec || document.activeElement === entry.el) continue;
      const val = node?.params[paramName] ?? spec.default;
      if (entry.kind === 'boolean') (entry.el as HTMLInputElement).checked = !!val;
      else entry.el.value = String(val);
    }
    for (const knob of graphKnobs.values()) knob.refresh();
  }

  rebuildGraphModules();
  refreshGraphControls();
  settings.subscribe('modGraph', () => { rebuildGraphModules(); refreshGraphControls(); });

  // ---------------- right-click: add a graph node ---------------------
  // Blender/Max-MSP convention: right-click empty board space opens a
  // categorized node menu at the cursor; picking a type adds it to the
  // patch (visible immediately now that EVERY node gets a module, not
  // just "active" ones). Reuses the Graph editor's own `createPalette`
  // (same categorized node list, registry-driven) rather than
  // duplicating its grouping logic.
  let addNodeMenuEl: HTMLElement | null = null;
  function closeAddNodeMenu(): void {
    if (!addNodeMenuEl) return;
    addNodeMenuEl.remove();
    addNodeMenuEl = null;
    document.removeEventListener('pointerdown', onAddNodeMenuOutsideClick, true);
    document.removeEventListener('keydown', onAddNodeMenuKeydown, true);
  }
  function onAddNodeMenuOutsideClick(e: PointerEvent): void {
    if (addNodeMenuEl && !addNodeMenuEl.contains(e.target as Node)) closeAddNodeMenu();
  }
  function onAddNodeMenuKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') closeAddNodeMenu();
  }
  function openAddNodeMenu(clientX: number, clientY: number): void {
    closeAddNodeMenu();
    const menu = createPalette({
      onAdd: (type) => {
        addGraphNode(type, clientX, clientY);
        closeAddNodeMenu();
      },
    });
    menu.classList.add('rw-pb-addnode-menu');
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const left = Math.min(clientX, Math.max(0, window.innerWidth - rect.width - 8));
    const top = Math.min(clientY, Math.max(0, window.innerHeight - rect.height - 8));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    addNodeMenuEl = menu;
    // Defer listener registration a tick: the SAME right-click's
    // trailing pointerdown (some browsers fire one for the auxiliary
    // button) would otherwise close the menu the instant it opens.
    setTimeout(() => {
      document.addEventListener('pointerdown', onAddNodeMenuOutsideClick, true);
      document.addEventListener('keydown', onAddNodeMenuKeydown, true);
    }, 0);
  }
  /** Place a just-created graph module free-floating at the spawn point
   *  (owner: nodes "should appear free floating around where I spawned
   *  them, they shouldn't be stuck to the grid on the left"). Entering
   *  free layout if needed (freeze() records every unit's home, the new
   *  module included, so TIDY still restores the full stacked layout);
   *  when ALREADY in free mode this also fixes a real spawn bug: the
   *  rebuild appends new modules to the rail, which in free mode is an
   *  empty flow container — the module rendered statically at the
   *  board's top-left, visually overlapping whatever free units sat
   *  there. resolveOverlap() keeps the spawn point collision-free. */
  function placeSpawnedModule(nodeId: string, clientX: number, clientY: number): void {
    const mod = graphModuleEls.get(nodeId);
    // No narrow-mode guard here, deliberately: drag-breakout has none
    // either — free layout works in a narrow window until a RESIZE
    // suspends it (the ResizeObserver round-trip below), and spawning
    // should behave exactly like dragging out.
    if (!mod) return;
    // Entering free mode captures the new module (already in the rail)
    // with a home; if free mode was already on, rebuildGraphModules
    // promoted the module to a free unit at a fallback position — either
    // way it's a free unit now, just move it to the cursor.
    if (!freeMode) freeze();
    const bRect = board.getBoundingClientRect();
    mod.style.left = `${Math.max(0, (clientX - bRect.left) / zoom - mod.offsetWidth / 2)}px`;
    mod.style.top = `${Math.max(0, (clientY - bRect.top) / zoom - 10)}px`;
    resolveOverlap(mod);
  }

  function addGraphNode(type: NodeType, clientX?: number, clientY?: number): void {
    const patch = settings.get('modGraph') ?? { nodes: [], bindings: [] };
    const def = getDef(type);
    const inputs: Record<string, string | null> = {};
    for (const p of def?.inputs ?? []) inputs[p.name] = null;
    const nodeId = genId('n');
    // A companion 'none'-targeted binding (owner: "the patch is parallel
    // between the patch bay and the controls, they should be backwards
    // compatible") — Beginner view's rows are derived from BINDINGS, not
    // raw nodes (`rowsFromPatch` iterates `patch.bindings`), so a bare
    // node added here would be invisible there even though it already
    // shows up fine in Advanced view's canvas (which reads `patch.nodes`
    // directly). 'none' keeps it non-destructive — nothing modulates
    // until the user actually picks a target, same as Beginner's own
    // target dropdown default and the Patch Bay's own unplug convention
    // (applyGraphBindingTarget) — and it correctly still counts as
    // "inert"/dimmed here until a REAL target or wire exists.
    const next: GraphPatch = {
      nodes: [...patch.nodes, { id: nodeId, type, params: {}, inputs }],
      bindings: [...patch.bindings, {
        id: genId('b'), paramKey: 'none', sourceNodeId: nodeId, amount: 0.25, mode: 'additive',
      }],
    };
    // Same "actually active, not silently inert" rule loadSamplePatch()
    // already follows: the graph engine's own tick() no-ops entirely
    // while modMode is 'classic', so a node added here would sit in
    // Settings doing nothing (and Beginner view's graph rows are gated
    // behind the GRAPH/BOTH mode tabs too) until the user happened to
    // flip modes themselves.
    ensureGraphLive();
    settings.set('modGraph', next); // synchronous notify → module exists now
    void getEngine().then((e) => e.setPatch(next));
    if (clientX !== undefined && clientY !== undefined) {
      placeSpawnedModule(nodeId, clientX, clientY);
    }
  }
  root.addEventListener('contextmenu', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.rw-pb-module, .rw-pb-field, .rw-pb-graphnode, .rw-rack-jack, .rw-pb-bus-cell, input, select, button')) return;
    e.preventDefault();
    openAddNodeMenu(e.clientX, e.clientY);
  });

  // Narrow mode and free mode don't mix (narrow stacks the columns) —
  // but a custom node arrangement must SURVIVE the round-trip (owner
  // bug report): entering narrow suspends the free layout (positions
  // saved, board tidied); widening past the threshold re-freezes and
  // restores every node where it was. Only the TIDY button forgets.
  let suspendedFree: Array<{ unit: HTMLElement; left: string; top: string; width: string }> | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? root.clientWidth;
      const narrow = root.classList.contains('rw-pb--narrow');
      if (narrow && freeMode) {
        suspendedFree = allUnits().map((unit) => ({
          unit, left: unit.style.left, top: unit.style.top, width: unit.style.width,
        }));
        tidy();
      } else if (!narrow && suspendedFree) {
        const saved = suspendedFree;
        suspendedFree = null;
        freeze();
        for (const p of saved) {
          p.unit.style.left = p.left;
          p.unit.style.top = p.top;
          p.unit.style.width = p.width;
        }
        syncSurfaceSize();
        freeRefWidth = w;
      } else if (!narrow && freeMode) {
        // Continuous case: the window is shrinking/growing but never
        // crossed the narrow threshold. Rescale every free unit's
        // left/width by how much the container width changed since the
        // last measurement, so a custom layout tracks the window
        // horizontally instead of holding stale pixel geometry.
        if (freeRefWidth == null) freeRefWidth = w;
        else if (w > 0 && Math.abs(w - freeRefWidth) > 0.5) {
          const ratio = w / freeRefWidth;
          for (const unit of allUnits()) {
            if (!unit.classList.contains('rw-pb-unit-free')) continue;
            const l = parseFloat(unit.style.left) || 0;
            const uw = parseFloat(unit.style.width) || unit.offsetWidth;
            unit.style.left = `${l * ratio}px`;
            unit.style.width = `${uw * ratio}px`;
          }
          syncSurfaceSize();
          freeRefWidth = w;
        }
      }
      // Ground-truth resync on every resize (cheap, idempotent) — keeps
      // the scrollable surface correct even in plain flow mode after a
      // zoom action had previously locked in an explicit px size.
      syncSurfaceSize();
    }).observe(root);
  }

  // ---------------- slot value refresh --------------------------------
  function refreshSlots(): void {
    const slots = settings.get('modSlots');
    slotRefs.forEach((r, i) => {
      const s = slots[i];
      if (!s) return;
      r.en.checked = s.enabled;
      if (document.activeElement !== r.rate) r.rate.value = String(s.frequency);
      if (document.activeElement !== r.amount) r.amount.value = String(s.amount);
      r.srcLcd.textContent = String(s.source).toUpperCase();
    });
  }
  settings.subscribe('modSlots', refreshSlots);
  refreshSlots();

  // ---------------- cable rendering -----------------------------------
  const reduceMotion = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
  let dashOffset = 0;
  let lastT = 0;

  function frame(t: number): void {
    requestAnimationFrame(frame);
    if (!root.isConnected || !ctx) return;
    const dt = (t - lastT) / 1000;
    lastT = t;
    if (!reduceMotion) dashOffset += dt * 24;

    const rect = surface.getBoundingClientRect();
    if (rect.width === 0) return;
    // Popout-safety, same as RackLayer: an adopted 2D canvas can lose
    // its buffer — recreate it in the view's current document.
    if (canvas.ownerDocument !== root.ownerDocument) {
      canvas.remove();
      canvas = root.ownerDocument.createElement('canvas');
      canvas.className = 'rw-pb-cables';
      surface.insertBefore(canvas, surface.firstChild);
      ctx = canvas.getContext('2d');
      if (!ctx) return;
    }
    // Coverage: the surface's box PLUS everything laid out inside it —
    // the board can be far taller than the surface's own box (the bay
    // root scrolls it), and a box-sized canvas only covered the top
    // scrollport-slice: cables to jacks below the fold drew into
    // clipped space and silently vanished. Children rects also include
    // the board's zoom transform and free-mode breakout units. The
    // canvas itself is deliberately excluded (see fitCableCanvas docs).
    let covW = rect.width, covH = rect.height;
    for (const child of Array.from(surface.children)) {
      if (child === canvas || !(child instanceof HTMLElement)) continue;
      const cr = child.getBoundingClientRect();
      covW = Math.max(covW, cr.right - rect.left);
      covH = Math.max(covH, cr.bottom - rect.top);
    }
    // Zoom-aware sizing (Global Text Size): keeps the canvas's VISUAL
    // size equal to the coverage so anchors measured in screen pixels
    // land exactly where drawn — see fitCableCanvas's docs.
    const { w, h } = fitCableCanvas(canvas, ctx, { width: covW, height: covH });
    ctx.clearRect(0, 0, w, h);
    const local = (p: Pt): Pt => ({ x: p.x - rect.left, y: p.y - rect.top });
    const anchor = (el: HTMLElement | undefined): Pt | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 ? rectCenter(r) : null;
    };

    const slots = settings.get('modSlots');
    const plugged = new Set<string>();

    for (const c of classicCables(slots)) {
      if (pending?.kind === 'to-param' && pending.slotIndex === c.slotIndex) continue;
      const a = anchor(slotOutJacks.get(c.slotIndex));
      const b = anchor(paramJacks.get(c.target));
      if (!a || !b) continue;
      plugged.add(c.target);
      drawPatchCable(ctx, local(a), local(b), CLASSIC_COLOR, {
        style: 'sag', dim: !c.enabled, dashed: !reduceMotion && c.enabled, dashOffset,
      });
    }

    // Source cables: SOURCES jack → SRC IN, for jackable sources.
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const srcJack = srcJacks.get(s?.source as ModSource);
      if (!s || !srcJack) continue;
      const a = anchor(srcJack);
      const b = anchor(slotSrcJacks.get(i));
      if (!a || !b) continue;
      drawPatchCable(ctx, local(a), local(b), SOURCE_COLOR, {
        style: 'sag', dim: !s.enabled, dashed: false,
      });
    }

    // Cables sourced from a `param-out` node anchor at that param's own
    // faceplate OUT jack (the hardware picture: Height OUT feeding Depth
    // IN runs jack-to-jack), falling back to the node's module jack when
    // the faceplate jack isn't in view (e.g. a cv:-target-only board).
    const graphPatchForWires = settings.get('modGraph');
    const graphOutAnchor = (sourceNodeId: string, sourcePort: string | undefined): HTMLElement | undefined => {
      const node = graphPatchForWires?.nodes.find((n) => n.id === sourceNodeId);
      if (node?.type === 'param-out') {
        const fp = paramOutJacks.get(String(node.params.key));
        if (fp) return fp;
      }
      return graphNodeJacks.get(`${sourceNodeId}#${sourcePort || defaultOutputPort(sourceNodeId)}`);
    };

    // Graph binding cables — one per binding, from that binding's OWN
    // source node's jack (rebuilt above whenever the set of active graph
    // sources changes), not one shared point. Draggable from the param
    // end (dragGraphParam); skip the static draw for whichever binding is
    // currently being dragged so only its rubber-band shows.
    for (const gc of graphCables(graphPatchForWires)) {
      if (pending?.kind === 'to-param-graph' && pending.bindingId === gc.bindingId) continue;
      const g = anchor(graphOutAnchor(gc.sourceNodeId, gc.sourcePort));
      const b = anchor(paramJacks.get(gc.paramKey));
      if (!g || !b) continue;
      plugged.add(gc.paramKey);
      drawPatchCable(ctx, local(g), local(b), GRAPH_COLOR, {
        style: 'sag', dim: !gc.enabled, dashed: false,
      });
    }

    // Node-to-node input wiring (a graph node's OUT feeding ANOTHER
    // node's IN port, e.g. a Sync's pulse into Noise's clock) — distinct
    // from a binding, which feeds a Settings param. Draggable from
    // either end (dragGraphIn/dragGraphOut); skip the static draw for
    // whichever IN port is currently being dragged so only its
    // rubber-band shows (OUT-side drags only ever create a new wire, so
    // there's no existing one to hide while dragging from that end).
    for (const w of nodeWires(graphPatchForWires)) {
      if (pending?.kind === 'to-graphin' && pending.nodeId === w.targetNodeId && pending.port === w.targetPort) continue;
      const a = anchor(graphOutAnchor(w.sourceNodeId, w.sourcePort));
      const b = anchor(graphInputJacks.get(`${w.targetNodeId}#${w.targetPort}`));
      if (!a || !b) continue;
      drawPatchCable(ctx, local(a), local(b), NODE_WIRE_COLOR, { style: 'sag', dashed: false });
    }

    // Waveform-shape cables — a picture of each shape param's current
    // value: SOURCES bus waveform jack → the node's shape jack (drag
    // either end to re-pick; there's no unplugged state since a shape
    // always has a value).
    for (const [key, sj] of shapeJacks) {
      if (pending?.kind === 'to-shapesrc' && `${pending.nodeId}#${pending.param}` === key) continue;
      const { nodeId, port: param } = splitJackKey(key);
      const node = graphPatchForWires?.nodes.find((n) => n.id === nodeId);
      const spec = node ? getDef(node.type)?.params[param] : undefined;
      const val = String(node?.params[param] ?? (spec?.kind === 'enum' ? spec.default : ''));
      const src = OPTION_TO_WAVE_SOURCE[val];
      if (!src) { sj.classList.remove('rw-rack-jack--plugged'); continue; }
      const a = anchor(srcJacks.get(src));
      const b = anchor(sj);
      if (!a || !b) continue;
      sj.classList.add('rw-rack-jack--plugged');
      drawPatchCable(ctx, local(a), local(b), SOURCE_COLOR, {
        style: 'sag', dim: node?.enabled === false, dashed: false,
      });
    }

    // Video routing cables (Source A/B → Composite/Dual Raster →
    // Renderer) — a fixed 5-endpoint patch, drawn straight from
    // Settings rather than a graph structure. `renderer-in` always
    // resolves to something (never unplugged, per the "normals to
    // Source A" convention).
    const VIDEO_IN_KEYS: VideoInKey[] = ['composite-inA', 'composite-inB', 'dualraster-inA', 'dualraster-inB', 'renderer-in'];
    const VIDEO_SRC_TO_OUT: Record<VideoSourceId, VideoOutKey> = {
      sourceA: 'sourceA-out', sourceB: 'sourceB-out', composite: 'composite-out', dualRaster: 'dualraster-out',
    };
    const usedVideoOuts = new Set<VideoOutKey>();
    for (const inKey of VIDEO_IN_KEYS) {
      if (pending?.kind === 'to-videoout' && pending.inKey === inKey) continue;
      const src = currentVideoSourceFor(inKey);
      // RENDERER IN's normal (sourceA, the default) draws no cable at
      // all — a real Eurorack normal connection is invisible until you
      // actually patch something else in; only a genuine choice earns
      // a visible cable.
      const isNormalled = inKey === 'renderer-in' && src === 'sourceA';
      const outKey: VideoOutKey | null = isNormalled || src === 'none' ? null : VIDEO_SRC_TO_OUT[src];
      const inJack = videoJacks.get(inKey);
      if (inJack) inJack.classList.toggle('rw-rack-jack--plugged', outKey !== null);
      if (!outKey) continue;
      usedVideoOuts.add(outKey);
      const a = anchor(videoJacks.get(outKey));
      const b = anchor(inJack);
      if (!a || !b) continue;
      drawPatchCable(ctx, local(a), local(b), VIDEO_COLOR, { style: 'sag', dashed: false });
    }
    for (const outKey of ['sourceA-out', 'sourceB-out', 'composite-out', 'dualraster-out'] as VideoOutKey[]) {
      videoJacks.get(outKey)?.classList.toggle('rw-rack-jack--plugged', usedVideoOuts.has(outKey));
    }

    if (pending) {
      let fixed: HTMLElement | undefined;
      let color = CLASSIC_COLOR;
      if (pending.kind === 'to-param') {
        fixed = slotOutJacks.get(pending.slotIndex);
      } else if (pending.kind === 'to-slotout') {
        fixed = paramJacks.get(pending.paramKey);
      } else if (pending.kind === 'to-slotsrc') {
        fixed = srcJacks.get(pending.source);
        color = SOURCE_COLOR;
      } else if (pending.kind === 'to-param-graph') {
        const bindingId = pending.bindingId;
        const patch = settings.get('modGraph');
        const b = patch?.bindings.find((x) => x.id === bindingId);
        fixed = b ? graphNodeJacks.get(`${b.sourceNodeId}#${b.sourcePort || defaultOutputPort(b.sourceNodeId)}`) : undefined;
        color = GRAPH_COLOR;
      } else if (pending.kind === 'to-graphin') {
        fixed = graphInputJacks.get(`${pending.nodeId}#${pending.port}`);
        color = NODE_WIRE_COLOR;
      } else if (pending.kind === 'to-paramout') {
        fixed = paramOutJacks.get(pending.paramKey);
        color = GRAPH_COLOR;
      } else if (pending.kind === 'to-shapesrc') {
        fixed = shapeJacks.get(`${pending.nodeId}#${pending.param}`);
        color = SOURCE_COLOR;
      } else if (pending.kind === 'to-videoin') {
        fixed = videoJacks.get(pending.outKey);
        color = VIDEO_COLOR;
      } else if (pending.kind === 'to-videoout') {
        fixed = videoJacks.get(pending.inKey);
        color = VIDEO_COLOR;
      } else {
        fixed = graphNodeJacks.get(pending.sourceKey);
        color = NODE_WIRE_COLOR;
      }
      const a = anchor(fixed);
      if (a) {
        drawPatchCable(ctx, local(a), local(pending.pos), color, {
          style: 'sag', highlight: true, dashed: !reduceMotion, dashOffset,
        });
      }
    }

    for (const [key, el] of paramJacks) {
      el.classList.toggle('rw-rack-jack--plugged', plugged.has(key));
    }
    for (const [i, el] of slotOutJacks) {
      el.classList.toggle('rw-rack-jack--plugged', slots[i] ? slots[i].target !== 'none' : false);
    }
    for (const [key, el] of graphInputJacks) {
      const { nodeId, port } = splitJackKey(key);
      el.classList.toggle('rw-rack-jack--plugged', !!graphPatchForWires?.nodes.find((n) => n.id === nodeId)?.inputs[port]);
    }

    // Dim graph modules with no connection at all (freshly added via
    // the right-click menu, or just never wired to anything) so a
    // glance still tells live signal-carrying nodes apart from
    // placeholders — every node gets a module now, not just active ones.
    const connectedNodes = new Set<string>();
    for (const b of graphPatchForWires?.bindings ?? []) {
      if (b.paramKey !== 'none') connectedNodes.add(b.sourceNodeId);
    }
    for (const w of nodeWires(graphPatchForWires)) {
      connectedNodes.add(w.sourceNodeId);
      connectedNodes.add(w.targetNodeId);
    }
    for (const [nodeId, mod] of graphModuleEls) {
      mod.classList.toggle('rw-pb-graphnode--inert', !connectedNodes.has(nodeId));
    }

    // Preview monitors (VIDEO SOURCE / RENDER PREVIEW) — cover-fit
    // drawImage while expanded; skipped entirely while collapsed.
    for (const pv of bayPreviews) {
      if (!pv.expanded()) continue;
      const img = pv.src();
      const c2 = pv.canvas.getContext('2d');
      if (!c2) continue;
      const { width: pw, height: ph } = pv.canvas;
      if (!img) { c2.clearRect(0, 0, pw, ph); continue; }
      const iw = (img as HTMLVideoElement).videoWidth ?? (img as HTMLCanvasElement).width;
      const ih = (img as HTMLVideoElement).videoHeight ?? (img as HTMLCanvasElement).height;
      if (!iw || !ih) { c2.clearRect(0, 0, pw, ph); continue; }
      const s = Math.max(pw / iw, ph / ih);
      const dw = iw * s, dh = ih * s;
      try {
        c2.drawImage(img, (pw - dw) / 2, (ph - dh) / 2, dw, dh);
      } catch { /* source mid-teardown; next frame recovers */ }
    }

    // Scope traces — sample each scope node's passthrough output via
    // the engine's probe (same mechanism as the graph editor's Probe
    // overlay) into a ring buffer and draw the phosphor line.
    if (engineRef) {
      for (const [nodeId, s] of scopeCanvases) {
        s.buf.push(engineRef.probe(nodeId, 'out'));
        if (s.buf.length > s.canvas.width) s.buf.shift();
        const c = s.canvas.getContext('2d');
        if (!c) continue;
        const { width: cw, height: ch } = s.canvas;
        c.clearRect(0, 0, cw, ch);
        c.strokeStyle = 'rgba(95, 255, 133, 0.25)';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(0, ch / 2);
        c.lineTo(cw, ch / 2);
        c.stroke();
        // Symmetric autoscale: ±1 minimum so control signals read at a
        // steady height, expanding for raw param-out values beyond ±1.
        let maxAbs = 1;
        for (const v of s.buf) maxAbs = Math.max(maxAbs, Math.abs(v));
        c.strokeStyle = '#5fff85';
        c.lineWidth = 1.5;
        c.shadowColor = 'rgba(95, 255, 133, 0.6)';
        c.shadowBlur = 3;
        c.beginPath();
        for (let i = 0; i < s.buf.length; i++) {
          const x = cw - s.buf.length + i;
          const y = ch / 2 - (s.buf[i] / maxAbs) * (ch / 2 - 3);
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.stroke();
        c.shadowBlur = 0;
      }
    }

    // Refresh faceplate controls from the current base + live values
    // (another surface — a Classic slider, a preset load, keyframe
    // playback, an LFO — may be driving them); skip whichever input the
    // user is actively typing into, same rule every other live-refresh
    // loop here uses. Knob/live updates are change-guarded internally,
    // so this is cheap per frame.
    for (const [key, input] of paramValueInputs) {
      const v = settings.get(key as keyof Settings);
      if (typeof v !== 'number') continue;
      if (document.activeElement !== input) {
        // Round for DISPLAY only (e.g. a 4:3 aspect ratio is
        // 1.3333333333333333 as a raw float) — writes still use the
        // input's own exact typed value, untouched by this.
        const rounded = Number(v.toFixed(4));
        if (parseFloat(input.value) !== rounded) input.value = String(rounded);
      }
      const knob = paramKnobs.get(key);
      knob?.refresh();
      // Live (modulated) display: amber needle on the knob + ▸ readout,
      // same language as Controls' orange live badge. Display only.
      const liveV = live ? live.getLive(key) : v;
      const modded = Math.abs(liveV - v) > 1e-6;
      knob?.setLive(modded ? liveV : null);
      const span = paramLiveSpans.get(key);
      if (span) {
        if (modded) {
          const txt = `▸ ${Number(liveV.toFixed(4))}`;
          if (span.textContent !== txt) span.textContent = txt;
          if (span.hidden) span.hidden = false;
        } else if (!span.hidden) {
          span.hidden = true;
        }
      }
    }
  }
  requestAnimationFrame(frame);

  return root;
}
