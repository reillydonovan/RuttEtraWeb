/**
 * Beginner view — flat slot-row projection of a `GraphPatch`.
 *
 * Each row is rendered by the **same** `SlotRow` component used by the
 * Classic 4-slot matrix in `ModulationSection`. The row reads from a
 * `SlotRowAdapter` that synthesizes a slot-like view of the underlying
 * Graph data (one source node + one Output binding per row); writes
 * mutate `node.params` / `binding.*` directly. Edits in either Classic
 * or Graph beginner reflect through the same shared component.
 *
 * If a row's underlying structure is more complex than one-source ->
 * one-binding (cycles, fan-out, multiple processors, etc.), the row
 * shows a "too complex for Beginner view" placeholder for THAT row
 * only — other rows still render normally.
 *
 * The Advanced view's binding inspector mutates the same TargetBinding
 * fields. There is no parallel data structure for "beginner output stage".
 */

import { ModTarget, OutputCurve, SettingsStore } from '../../state/Settings';
import {
  CurveType, GraphNode, GraphPatch, NodeType, TargetBinding,
} from '../../modulation/graph/types';
import { allDefs, getDef } from '../../modulation/graph/registry';
import { makeRangeAdapter } from '../shared/rangeAdapter';
import { paramLabel, optionLabel } from '../../modulation/graph/paramLabel';
import { graphSpan } from '../../modulation/patchRange';
import '../../modulation/graph/bootstrap';
import { CLASSIC_SOURCE_NODE_TYPES } from '../../modulation/graph/convert';
import { TARGETS, cvOutputTargets } from '../targets';
import { PatchSectionDeps } from '../sections/PatchSection';
import { clonePatch } from '../../modulation/graph/clonePatch';
import {
  canPaste, createSlotRow, getSlotClipboard, setSlotClipboard,
  SlotRowAdapter, SourceKind, NodeParamField,
} from '../shared/SlotRow';

const MAX_BEGINNER_NODES = 6;

interface BeginnerRow {
  source: GraphNode;
  /** Always 0 entries here — beginner rows are exactly one-source-one-output. */
  processors: GraphNode[];
  binding: TargetBinding;
}

interface SourceOption { type: NodeType; label: string; }

function sourceOptions(): SourceOption[] {
  const out: SourceOption[] = [];
  for (const def of allDefs()) {
    if (CLASSIC_SOURCE_NODE_TYPES.has(def.type)
        || def.category === 'Sources' || def.category === 'Audio'
        || def.category === 'Video' || def.category === 'Inputs') {
      out.push({ type: def.type, label: def.label });
    }
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

const TARGET_OPTS_STATIC: { v: ModTarget | 'none'; l: string }[] = [
  { v: 'none', l: '— none —' },
  ...TARGETS,
];

function buildTargetOpts(settings: SettingsStore): { v: ModTarget | 'none'; l: string }[] {
  return [...TARGET_OPTS_STATIC, ...cvOutputTargets(settings)];
}

const CURVE_OPTS: { v: OutputCurve; l: string }[] = [
  { v: 'linear', l: 'Linear' },
  { v: 'exp',    l: 'Exp' },
  { v: 'log',    l: 'Log' },
  { v: 's',      l: 'S-curve' },
  { v: 'step',   l: 'Step' },
];

/**
 * Try to deconstruct the current patch into beginner-style rows. Each
 * row maps to one source node + one binding. Rows that don't fit this
 * shape are tagged `tooComplex: true` so the row UI can show a
 * placeholder for that row only — the rest still render normally.
 */
function rowsFromPatch(patch: GraphPatch): { rows: Array<BeginnerRow & { tooComplex?: boolean; reason?: string }>; outOfBudget: boolean } {
  if (patch.nodes.length > MAX_BEGINNER_NODES) {
    return { rows: [], outOfBudget: true };
  }
  if (patch.bindings.length === 0) return { rows: [], outOfBudget: false };

  const outDeg = new Map<string, number>();
  for (const n of patch.nodes) for (const v of Object.values(n.inputs)) {
    if (v) outDeg.set(v, (outDeg.get(v) ?? 0) + 1);
  }
  for (const b of patch.bindings) outDeg.set(b.sourceNodeId, (outDeg.get(b.sourceNodeId) ?? 0) + 1);

  const rows: Array<BeginnerRow & { tooComplex?: boolean; reason?: string }> = [];
  for (const binding of patch.bindings) {
    const source = patch.nodes.find((n) => n.id === binding.sourceNodeId);
    if (!source) {
      rows.push({ source: { id: '', type: 'constant', inputs: {}, params: {} }, processors: [], binding, tooComplex: true, reason: 'Binding has no source node' });
      continue;
    }
    // For beginner view we require exactly one source -> one binding,
    // with no processor nodes between them. Anything else is "too
    // complex for THIS row".
    const inputCount = Object.values(source.inputs).filter(Boolean).length;
    if (inputCount > 0) {
      rows.push({ source, processors: [], binding, tooComplex: true, reason: 'Source has upstream nodes — open Advanced view' });
      continue;
    }
    if ((outDeg.get(source.id) ?? 0) > 1) {
      rows.push({ source, processors: [], binding, tooComplex: true, reason: 'This source feeds multiple bindings — open Advanced view' });
      continue;
    }
    rows.push({ source, processors: [], binding });
  }
  return { rows, outOfBudget: false };
}

function genId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

/**
 * Per-row expand state. Lives for the page lifetime keyed by binding id;
 * never persisted (matches Classic's `modSlotExpanded` semantics — UI
 * state only).
 */
const rowExpanded = new Map<string, boolean>();

/** Map a Graph source NodeType to the shared SlotRow `SourceKind`. */
function nodeTypeToKind(type: NodeType): SourceKind {
  switch (type) {
    case 'lfo':              return 'lfo';
    case 'ramp':             return 'ramp';
    case 'audio-envelope':   return 'audio';
    case 'audio-band':       return 'audioBand';
    case 'audio-onset':      return 'beat';
    case 'midi-cc':
    case 'midi-note':        return 'midiOther';
    case 'osc-in':           return 'osc';
    case 'clock':            return 'midiClock';
    case 'joystick-x':
    case 'joystick-y':
    case 'joystick-z':       return 'joystick';
    case 'constant':         return 'constant';
    case 'cv-input':         return 'cvAudio';
    case 'gamepad-axis':
    case 'gamepad-button':   return 'gamepad';
    default:                 return 'unsupported';
  }
}

/**
 * Snapshot of a beginner row, used for the Copy/Paste clipboard. Stored
 * shape-tagged so a Classic ModSlot in the clipboard isn't accidentally
 * pasted into a Graph row (and vice versa).
 */
interface GraphRowSnapshot {
  __kind: 'graphRow';
  sourceType: NodeType;
  sourceParams: Record<string, number | string | boolean>;
  binding: TargetBinding;
}

/** What a graph row card needs from its surface (Controls ▸ Beginner rows, Patch Bay modules). */
export interface GraphRowHost {
  settings: SettingsStore;
  cv?: PatchSectionDeps['cv'];
  gamepad?: PatchSectionDeps['gamepad'];
  /** Write the patch (Settings + engine, the two-write rule). `skipRerender`: a drag is in progress. */
  writePatch(next: GraphPatch, opts?: { skipRerender?: boolean }): void;
  /** Called after the card opens or closes. */
  onExpandChange?(): void;
}

export type GraphRow = BeginnerRow & { tooComplex?: boolean; reason?: string };

function currentPatch(settings: SettingsStore): GraphPatch {
  const p = settings.get('modGraph');
  return p ? clonePatch(p) : { nodes: [], bindings: [] };
}

/** The Beginner row for binding `bindingId` in `patch`, or null when Beginner view can't show it
 *  (no such binding, or a patch with too many nodes). Rows flagged `tooComplex` are returned. */
export function graphRowFor(patch: GraphPatch, bindingId: string): GraphRow | null {
  const { rows, outOfBudget } = rowsFromPatch(patch);
  if (outOfBudget) return null;
  return rows.find((r) => r.binding.id === bindingId) ?? null;
}

/**
 * One graph patch's card (source node + its binding) — the SAME card in Controls ▸ Modulation
 * (Beginner rows) and in the Patch Bay's graph node modules, so the two never differ.
 */
export function createGraphRowCard(host: GraphRowHost, row: GraphRow): { root: HTMLElement; refresh(): void } {
  const { settings } = host;
  // Helpers that always reach the LATEST patch via settings, so writes
  // don't stomp on each other when multiple sliders fire in quick
  // succession.
  const mutate = (
    mutator: (cur: GraphPatch, src: GraphNode | undefined, b: TargetBinding | undefined) => void,
    opts: { skipRerender?: boolean } = {},
  ): void => {
    const cur = currentPatch(host.settings);
    const src = cur.nodes.find((n) => n.id === row.source.id);
    const b = cur.bindings.find((x) => x.id === row.binding.id);
    mutator(cur, src, b);
    host.writePatch(cur, opts);
  };

  const liveSource = (): GraphNode => {
    const cur = settings.get('modGraph');
    return cur?.nodes.find((n) => n.id === row.source.id) ?? row.source;
  };
  const liveBinding = (): TargetBinding => {
    const cur = settings.get('modGraph');
    return cur?.bindings.find((x) => x.id === row.binding.id) ?? row.binding;
  };
  const liveParam = <T extends number | string | boolean>(k: string, fallback: T): T => {
    const v = liveSource().params[k];
    return (v ?? fallback) as T;
  };
  /** Hover tooltip for a node param — the registry's `help` (one source for every surface). */
  const ph = (k: string): string | undefined => getDef(liveSource().type)?.params[k]?.help;

  const adapter: SlotRowAdapter = {
    // Graph rows don't have a per-row enable toggle — the binding's
    // existence IS the enable state. Hidden via caps.
    source: {
      get: () => liveSource().type,
      set: (v) => mutate((_cur, src) => {
        if (!src) return;
        src.type = v as NodeType;
        src.params = {};
      }),
      options: sourceOptions().map((o) => ({ v: o.type, l: o.label })),
      // What the chosen node is — the registry's one-line description.
      describe: () => {
        return getDef(liveSource().type)?.description ?? null;
      },
    },
    target: {
      get: () => liveBinding().paramKey,
      set: (v) => mutate((_cur, _src, b) => { if (b) b.paramKey = v as string; }),
      options: () => buildTargetOpts(settings) as ReadonlyArray<{ v: string; l: string }>,
    },
    range: makeRangeAdapter(settings, {
      target: () => liveBinding().paramKey,
      span: () => graphSpan(getDef(liveSource().type) ?? undefined, liveBinding().sourcePort, liveSource().params),
      stage: () => liveBinding(),
      amount: () => liveBinding().amount,
      mode: () => (liveBinding().mode === 'multiplicative' ? 'multiplicative' : 'additive'),
      write: (sol) => mutate((_c, _s, b) => {
        if (!b) return;
        b.amount = sol.amount; b.outputMin = sol.outputMin; b.outputMax = sol.outputMax; b.outputOffset = sol.outputOffset;
      }),
    }),
    amount: {
      get: () => liveBinding().amount,
      set: (v) => mutate((_cur, _src, b) => { if (b) b.amount = Math.max(-20, Math.min(20, v)); }, { skipRerender: true }),
      min: -20, max: 20, step: 0.001,
    },
    expanded: {
      get: () => rowExpanded.get(row.binding.id) ?? false,
      set: (v) => {
        rowExpanded.set(row.binding.id, v);
        host.onExpandChange?.();
      },
    },
    sourceKind: row.tooComplex ? 'unsupported' : nodeTypeToKind(liveSource().type),
    tooComplex: !!row.tooComplex,
    tooComplexReason: row.reason,

    // Every param the node has (registry), the same set the Patch Bay node module shows. The
    // CV channel and gamepad index stay in their live-readout groups instead.
    nodeParams: (() => {
      const def = getDef(liveSource().type);
      if (!def) return undefined;
      const kind = nodeTypeToKind(def.type);
      const skip = new Set(kind === 'cvAudio' ? ['channel'] : kind === 'gamepad' ? ['axis', 'button'] : []);
      const fields: NodeParamField[] = [];
      for (const [name, spec] of Object.entries(def.params)) {
        if (skip.has(name) || spec.kind === 'text') continue;
        const label = paramLabel(name, spec);
        const write = (v: number | string | boolean, drag = false): void =>
          mutate((_c, src) => { if (src) src.params[name] = v; }, { skipRerender: drag });
        if (spec.kind === 'number') {
          fields.push({ kind: 'num', label, a: {
            help: spec.help, min: spec.min, max: spec.max, step: spec.step,
            get: () => liveParam<number>(name, spec.default),
            set: (v) => write(v, true),
          } });
        } else if (spec.kind === 'enum') {
          fields.push({ kind: 'enum', label, a: {
            help: spec.help,
            get: () => String(liveParam<string>(name, spec.default)),
            set: (v) => write(v),
            options: spec.options.map((o) => ({ v: o, l: optionLabel(spec, o) })),
          } });
        } else {
          fields.push({ kind: 'bool', label, a: {
            help: spec.help,
            get: () => !!liveParam<boolean>(name, spec.default),
            set: (v) => write(v),
          } });
        }
      }
      return { title: def.label, fields };
    })(),

    // -------------------- LFO group (shape: rate, phase, duty, bipolar) --------------------
    lfo: {
      frequency: {
        help: ph('rate'),
        get: () => liveParam<number>('rate', 1),
        set: (v) => mutate((_c, src) => { if (src) src.params.rate = v; }, { skipRerender: true }),
        min: 0.01, max: 30, step: 0.01,
      },
      phase: {
        help: ph('phase'),
        get: () => liveParam<number>('phase', 0),
        set: (v) => mutate((_c, src) => { if (src) src.params.phase = v; }, { skipRerender: true }),
        min: 0, max: 1, step: 0.001,
      },
      duty: {
        help: ph('duty'),
        get: () => liveParam<number>('duty', 0.5),
        set: (v) => mutate((_c, src) => { if (src) src.params.duty = v; }, { skipRerender: true }),
        min: 0.05, max: 0.95, step: 0.01,
      },
      bipolar: {
        help: ph('bipolar'),
        get: () => liveParam<boolean>('bipolar', true),
        set: (v) => mutate((_c, src) => { if (src) src.params.bipolar = v; }),
      },
      // Graph LFO doesn't (yet) have sync mode — beginner view hides
      // these by leaving them off the adapter.
      // (No `syncMode` / `clockDivision` passed in.)
      // shape selection lives in the source dropdown — if a user wants
      // a different waveform, they pick a different node. Beginner
      // view's LFO is always 'lfo' kind regardless of shape; shape is
      // exposed as a separate enum at the param level instead.
    },

    // -------------------- v9: CV input --------------------
    cv: {
      channel: {
        help: ph('channel'),
        get: () => liveParam<number>('channel', 0),
        set: (v) => mutate((_c, src) => { if (src) src.params.channel = Math.max(0, Math.round(v)); }, { skipRerender: true }),
        min: 0, max: 31, step: 1,
      },
      readVoltage: () => {
        const route = liveParam<string>('route', 'audio');
        if (route !== 'audio') return NaN;
        return host.cv ? host.cv.getVoltage(liveParam<number>('channel', 0)) : NaN;
      },
      readNormalized: () => {
        const route = liveParam<string>('route', 'audio');
        if (route !== 'audio') return 0;
        return host.cv ? host.cv.getNormalized(liveParam<number>('channel', 0)) : 0;
      },
      calibrate: () => {
        const route = liveParam<string>('route', 'audio');
        if (route === 'audio') host.cv?.calibrate(liveParam<number>('channel', 0));
      },
      resetCalibration: () => {
        const route = liveParam<string>('route', 'audio');
        if (route === 'audio') host.cv?.resetCalibration(liveParam<number>('channel', 0));
      },
      rangeLabel: () => {
        const route = liveParam<string>('route', 'audio');
        if (route !== 'audio') return route.toUpperCase();
        const channels = settings.get('cvChannels');
        return channels[liveParam<number>('channel', 0)]?.range ?? '+/-5V';
      },
      available: () => {
        const route = liveParam<string>('route', 'audio');
        if (route === 'audio') return !!(host.cv && host.cv.running);
        return true;
      },
      get isOsc() { return liveParam<string>('route', 'audio') === 'osc'; },
      readVariance: () => host.cv ? host.cv.getVariance(liveParam<number>('channel', 0)) : 0,
    },

    // -------------------- v9: Gamepad --------------------
    gamepad: {
      index: {
        help: ph(liveSource().type === 'gamepad-button' ? 'button' : 'axis'),
        get: () => liveParam<number>(liveSource().type === 'gamepad-button' ? 'button' : 'axis', 0),
        set: (v) => mutate((_c, src) => {
          if (!src) return;
          const k = src.type === 'gamepad-button' ? 'button' : 'axis';
          src.params[k] = Math.max(0, Math.round(v));
        }, { skipRerender: true }),
        min: 0, max: 31, step: 1,
      },
      readValue: () => {
        if (!host.gamepad) return 0;
        if (liveSource().type === 'gamepad-button') {
          return host.gamepad.getButton(liveParam<number>('button', 0));
        }
        return host.gamepad.getAxis(liveParam<number>('axis', 0));
      },
      available: () => !!host.gamepad,
      get isButton() { return liveSource().type === 'gamepad-button'; },
    },

    // -------------------- Output stage (writes to the BINDING) --------------------
    output: {
      curve: {
        get: () => (liveBinding().outputCurve ?? mapLegacyCurve(liveBinding().curve)) as OutputCurve,
        set: (v) => mutate((_c, _s, b) => {
          if (!b) return;
          b.outputCurve = v as OutputCurve;
          // Drop the legacy curve field once the user touches the new
          // one so they stack rather than fight.
          delete b.curve;
        }),
        options: CURVE_OPTS,
      },
      min: {
        get: () => liveBinding().outputMin ?? -1,
        set: (v) => mutate((_c, _s, b) => { if (b) b.outputMin = v; }, { skipRerender: true }),
        min: -2, max: 2, step: 0.001,
      },
      max: {
        get: () => liveBinding().outputMax ?? 1,
        set: (v) => mutate((_c, _s, b) => { if (b) b.outputMax = v; }, { skipRerender: true }),
        min: -2, max: 2, step: 0.001,
      },
      offset: {
        get: () => liveBinding().outputOffset ?? 0,
        set: (v) => mutate((_c, _s, b) => { if (b) b.outputOffset = v; }, { skipRerender: true }),
        min: -1, max: 1, step: 0.001,
      },
      invert: {
        get: () => liveBinding().outputInvert ?? false,
        set: (v) => mutate((_c, _s, b) => { if (b) b.outputInvert = v; }),
      },
      // v20: expose the binding's apply mode in Beginner view too —
      // previously only the Advanced inspector could set it.
      applyMode: {
        get: () => liveBinding().mode ?? 'additive',
        set: (v) => mutate((_c, _s, b) => { if (b) b.mode = v as 'additive' | 'multiplicative'; }),
        options: [{ v: 'additive', l: 'Additive (+)' }, { v: 'multiplicative', l: 'Multiply (×)' }],
      },
    },

    copy: () => {
      const snap: GraphRowSnapshot = {
        __kind: 'graphRow',
        sourceType: liveSource().type,
        sourceParams: { ...liveSource().params },
        binding: { ...liveBinding() },
      };
      setSlotClipboard(snap);
    },
    paste: () => {
      const snap = getSlotClipboard() as { __kind?: string } | null;
      if (!snap || snap.__kind !== 'graphRow') return;
      const g = snap as GraphRowSnapshot;
      mutate((_c, src, b) => {
        if (!src || !b) return;
        src.type = g.sourceType;
        src.params = { ...g.sourceParams };
        // Preserve binding id + sourceNodeId; copy everything else.
        const keepId = b.id;
        const keepSrc = b.sourceNodeId;
        Object.assign(b, g.binding, { id: keepId, sourceNodeId: keepSrc });
      });
    },
    reset: () => {
      mutate((cur, _src, b) => {
        if (!b) return;
        cur.bindings = cur.bindings.filter((x) => x.id !== row.binding.id);
        cur.nodes = cur.nodes.filter((n) => n.id !== row.source.id);
      });
    },
    softReset: () => {
      // Type-defaults for the source node's params + identity output
      // stage + amount=0. Source type, paramKey, and mode are kept —
      // this is the "snap params back to neutral but keep my routing"
      // affordance. Pulls each param's default from the registry so
      // it stays accurate as the registry evolves.
      mutate((_cur, src, b) => {
        if (src) src.params = defaultsForNodeType(src.type);
        if (b) {
          b.amount = 0;
          b.curve = undefined;
          b.outputCurve = 'linear';
          b.outputMin = -1;
          b.outputMax = 1;
          b.outputOffset = 0;
          b.outputInvert = false;
        }
      });
    },
    hardReset: () => {
      // Source back to default sine LFO, target back to "none". The
      // binding stays in the patch — to fully delete the row, the user
      // can click X. Hard reset is a "wipe my settings, keep the row".
      mutate((_cur, src, b) => {
        if (src) {
          src.type = 'lfo';
          src.params = defaultsForNodeType('lfo');
          src.inputs = {};
        }
        if (b) {
          b.paramKey = 'none';
          b.amount = 0;
          b.mode = 'additive';
          b.sourcePort = undefined;
          b.curve = undefined;
          b.outputCurve = 'linear';
          b.outputMin = -1;
          b.outputMax = 1;
          b.outputOffset = 0;
          b.outputInvert = false;
        }
      });
    },
    caps: {
      showEnable: false,
      showCopyPaste: true,
      showMidiOut: false,
      resetLabel: 'Remove patch',
      showRampRetrigger: false,
    },
  };

  // Hook paste-disabled state — only allow paste when clipboard is a
  // graph-row snapshot (or a Classic ModSlot? for now we keep them
  // separate to avoid silent type mismatches).
  void canPaste;

  return createSlotRow(adapter);
}

/** Map legacy v1 binding `curve` enum to the v8 `OutputCurve` value. */
function mapLegacyCurve(c: CurveType | undefined): OutputCurve {
  if (!c || c === 'linear') return 'linear';
  if (c === 'exp') return 'exp';
  if (c === 'log') return 'log';
  if (c === 'sCurve') return 's';
  return 'linear';
}

/**
 * Pull a node's "type-default" params from the registry. Used by the
 * per-row Reset (↻) button: clicking Reset wipes user-tuned params
 * (LFO Rate=1, Shape=Sine, Depth=1, ...) and restores the spec defaults
 * without dropping the row.
 *
 * Returns an empty params object if the registry doesn't have the type
 * (defensive against stale presets after registry edits).
 */
function defaultsForNodeType(type: NodeType): Record<string, number | string | boolean> {
  const def = getDef(type);
  if (!def) return {};
  const out: Record<string, number | string | boolean> = {};
  for (const [k, spec] of Object.entries(def.params)) {
    out[k] = spec.default;
  }
  return out;
}

export function renderBeginnerView(host: HTMLElement, deps: PatchSectionDeps): () => void {
  const { settings } = deps;
  const root = document.createElement('div');
  root.className = 'rw-beginner-view';
  host.appendChild(root);

  const header = document.createElement('div');
  header.className = 'rw-beginner-header';
  header.textContent = 'Beginner view — same expandable rows as the Function Generators';
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

  /**
   * Continuous-input writes (slider drag) set this so the modGraph
   * subscription doesn't tear down the DOM mid-gesture and break
   * pointer capture.
   */
  let suppressRender = false;

  function writePatch(next: GraphPatch, opts: { skipRerender?: boolean } = {}): void {
    if (opts.skipRerender) suppressRender = true;
    try {
      settings.set('modGraph', next);
      void deps.getEngine().then((e) => e.setPatch(next));
    } finally {
      if (opts.skipRerender) suppressRender = false;
    }
    if (!opts.skipRerender) render();
  }

  /** Held adapters / refresh callbacks so we can re-render efficiently. */
  let activeRefreshers: Array<() => void> = [];

  function render(): void {
    rowsHost.innerHTML = '';
    activeRefreshers = [];

    const patch = settings.get('modGraph') ?? { nodes: [], bindings: [] };
    const { rows, outOfBudget } = rowsFromPatch(patch);

    if (outOfBudget) {
      const note = document.createElement('div');
      note.className = 'rw-mod-graph-empty';
      note.textContent = 'This patch has too many nodes for Beginner view — open Advanced view to edit.';
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

    for (const row of rows) {
      rowsHost.appendChild(buildRowUi(row));
    }
  }

  function buildRowUi(row: GraphRow): HTMLElement {
    const ui = createGraphRowCard({ settings, cv: deps.cv, gamepad: deps.gamepad, writePatch, onExpandChange: render }, row);
    activeRefreshers.push(ui.refresh);
    return ui.root;
  }


  // Re-render whenever modGraph changes from outside (preset apply,
  // advanced view edit, MIDI learn, etc.). `suppressRender` lets
  // continuous-input writes (slider drag) update state without nuking
  // the DOM mid-gesture.
  const unsubscribe = settings.subscribe('modGraph', () => {
    if (suppressRender) {
      // Even when we skip the rebuild, the active rows' refresh()
      // callbacks need to run so the slider's number input stays in
      // sync with the dragged range value.
      for (const r of activeRefreshers) r();
      return;
    }
    render();
  });
  // CV-output channels appear as `cv:N` entries in the Target dropdown.
  // Re-render the beginner view whenever the user adds / removes / re-
  // labels a CV output in the I/O panel — fastest way to refresh every
  // row's dropdown without a per-row rebuildTargetOptions hook.
  const unsubscribeCV = settings.subscribe('cvOutputChannels', () => render());

  render();

  return () => {
    unsubscribe();
    unsubscribeCV();
    root.remove();
  };
}

// Re-export so callers that still import the old function name keep
// working (kept minimal — there are none in the current tree, but
// PatchSection imports `renderBeginnerView` directly, which is the
// only consumer).
export type { SettingsStore };
