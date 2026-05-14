/**
 * Public types for the signal-graph modulation engine.
 *
 * The graph is a DAG of pure-function nodes connected by named ports. A
 * `Signal` is just a normalized scalar; convention is 0..1 unipolar or
 * -1..+1 bipolar, but signals are unbounded — the engine clamps NaN /
 * Infinity / denormals to 0 at every node output.
 *
 * Bindings are the terminal: each binding reads one node output and
 * writes its value (scaled by `amount`, optionally curved) into a key on
 * `SettingsStore`. Multiple bindings can target the same param; their
 * effects sum (matching `ModMatrix`'s summing-amplifier behavior).
 */

export type Signal = number;

export type NodeType =
  // Sources
  | 'lfo' | 'ramp' | 'noise' | 'constant' | 'clock'
  // Audio CV
  | 'audio-envelope' | 'audio-band' | 'audio-pitch' | 'audio-onset'
  // Video CV (Stage 5 fills in; Stage 1 ships zero-output stubs)
  | 'video-luma' | 'video-luma-row' | 'video-luma-col'
  | 'video-motion' | 'video-color' | 'video-edge'
  // Inputs
  | 'joystick-x' | 'joystick-y' | 'joystick-z'
  | 'midi-cc' | 'midi-note' | 'osc-in'
  // v9: external voltage control
  | 'cv-input' | 'gamepad-axis' | 'gamepad-button'
  // v9: CV out — sink node, writes its input to a CV output channel
  | 'cv-output'
  // Processors
  | 'attenuator' | 'inverter' | 'offset' | 'scale' | 'range'
  | 'mixer' | 'multiplier' | 'crossfade' | 'min' | 'max'
  | 'comparator' | 'sample-and-hold' | 'slew' | 'quantize'
  | 'curve' | 'delay' | 'track-and-hold'
  // Logic / utility
  | 'trigger-to-gate' | 'gate-to-trigger' | 'clock-divider' | 'sequencer';

export type CurveType = 'linear' | 'exp' | 'log' | 'sCurve';
export type BindingMode = 'additive' | 'multiplicative';

export interface GraphNode {
  id: string;
  type: NodeType;
  /** Node-specific config. Numbers / strings / booleans only — JSON-serializable. */
  params: Record<string, number | string | boolean>;
  /** Input port name -> source node id. `null` means the port is unpatched. */
  inputs: Record<string, string | null>;
  /** Optional canvas position for the advanced-view editor. */
  position?: { x: number; y: number };
}

export interface TargetBinding {
  id: string;
  /** Settings key (validated at engine boundary). */
  paramKey: string;
  sourceNodeId: string;
  /** Defaults to the node's primary output port (`'out'`). */
  sourcePort?: string;
  amount: number;
  /**
   * Legacy "binding curve" (predates the shared output stage). Kept for
   * backwards-compat so old saved patches still load; new code should
   * use `outputCurve` instead. When both are present, `outputCurve`
   * wins.
   */
  curve?: CurveType;
  mode: BindingMode;
  /**
   * Output stage — same five fields as Classic `ModSlot.outputCurve` etc.
   * All optional with sensible defaults applied at the engine boundary
   * (curve='linear', min=-1, max=1, offset=0, invert=false). Beginner
   * view's "Output" controls and Advanced view's binding inspector both
   * write to these fields — there is NO parallel data structure.
   */
  outputCurve?: 'linear' | 'exp' | 'log' | 's' | 'step';
  outputMin?: number;
  outputMax?: number;
  outputOffset?: number;
  outputInvert?: boolean;
}

export interface GraphPatch {
  nodes: GraphNode[];
  bindings: TargetBinding[];
}

// --------------------------------------------------------------------
// Node definition (registry entry shape)
// --------------------------------------------------------------------

export type ParamSpec =
  | { kind: 'number'; min: number; max: number; step: number; default: number }
  | { kind: 'enum';   options: string[]; default: string }
  | { kind: 'boolean'; default: boolean };

export interface PortSpec {
  name: string;
  kind: 'control' | 'audio' | 'video' | 'gate' | 'trigger';
  /** Optional human-readable label; defaults to `name`. */
  label?: string;
}

/**
 * Per-frame execution context handed to `tick()`. Held by reference and
 * mutated each frame by `GraphEngine`; nodes must not retain it across
 * frames.
 */
export interface NodeContext {
  /** Seconds since engine boot. Monotonic. */
  timeSec: number;
  /** Frame delta in seconds (clamped to ~0.5s upper bound). */
  dt: number;
  /** Increments by 1 every `tick()`. */
  frame: number;
  /** Optional dependencies; nodes opt in by reading what they need. */
  deps: NodeDeps;
  /** Joystick state, last set via `engine.setJoystick(...)`. */
  joystick: { x: number; y: number; z: number };
}

/** Subsystem references threaded through the engine. All optional. */
export interface NodeDeps {
  fft?: AudioFFTLike | null;
  beat?: BeatLike | null;
  midiClock?: MidiClockLike | null;
  midiMapping?: MidiMappingLike | null;
  midiManager?: unknown;
  osc?: OscLike | null;
  /** v9: external CV reader (DC-coupled audio interface). Null until started. */
  cv?: CVLike | null;
  /** v9: gamepad / HID poller. Null when no gamepad is bound. */
  gamepad?: GamepadLike | null;
  /** v9: CV output writer. Null when CV-out is not running. The
   *  `cv-output` graph node uses this to deliver per-frame source
   *  values to the CV-output subsystem. */
  cvOut?: CVOutputLike | null;
  /** Stage 5: shared video readback service. Null until wired. */
  videoTap?: VideoTapLike | null;
  /**
   * Single shared internal BPM (mirrors `Settings.internalBpm`).
   * Refreshed once per `GraphEngine.tick()` so the Clock node's
   * `source: 'internal'` mode reads the same value as the Timeline
   * sequencer and Classic LFO patches in Tempo sync mode.
   */
  bpm?: number;
}

// Minimal duck-typed interfaces so the engine stays decoupled from the
// concrete classes (and so tests can pass simple stubs in).

export interface AudioFFTLike {
  bands: ArrayLike<number>;
  getEnvelope(): number;
  /**
   * Optional time-domain access for pitch tracking. May be null in tests
   * or before audio has started.
   */
  getTimeDomain?(out: Float32Array): boolean;
}

export interface BeatLike {
  pulse: number;
}

export interface MidiClockLike {
  bpm: number;
  phase01: number;
  beatPulse: number;
  divisionToHz(div: string): number;
  divisionPhase(div: string): number;
}

export interface MidiMappingLike {
  getRawCC(channel: number, cc: number): number;
  getPoly(channel: number): { lastNote: number | null; lastVelocity: number };
}

export interface OscLike {
  getMostRecent(): number;
  getByAddress?(address: string): number;
  /** Last value cached for an exact (address, argIndex) pair. 0 if unseen. */
  getValue?(address: string, argIndex: number): number;
}

export interface CVLike {
  /** Latest normalized sample for `channel` (-1..1, or 0..1 if unipolar). */
  getNormalized(channel: number): number;
  /** Voltage label for `channel` — NaN if no data has arrived yet. */
  getVoltage(channel: number): number;
  /** Variance of `channel` over the recent window — for CV Learn. */
  getVariance(channel: number): number;
  running: boolean;
  channelCount: number;
}

export interface GamepadLike {
  getAxis(i: number): number;
  getButton(i: number): number;
  getAxisVariance(i: number): number;
}

export interface CVOutputLike {
  setGraphSource(channelIndex: number, value: number): void;
}

export interface VideoTapLike {
  getLumaRegion(rect: Rect, hi?: boolean): number;
  getColorRegion(rect: Rect): { h: number; s: number; v: number };
  getMotionRegion(rect: Rect): number;
  getEdgeDensity(rect: Rect): number;
  getRow(y: number): number;
  getCol(x: number): number;
}

export interface Rect { x: number; y: number; w: number; h: number; }

/**
 * A registered node implementation. State is opaque — registries pick
 * whatever shape they need; the engine just hands it back next tick.
 */
export interface NodeDef<S = unknown> {
  type: NodeType;
  /** Top-level palette category. */
  category: 'Sources' | 'Audio' | 'Video' | 'Inputs' | 'Processors' | 'Logic';
  /** Short label for palette / inspector. */
  label: string;
  /** One-sentence plain-language description for help / tooltip. */
  description: string;
  inputs: PortSpec[];
  outputs: PortSpec[];
  params: Record<string, ParamSpec>;
  /** Returns the node's per-instance state. Called once at `setPatch`. */
  init(params: Record<string, number | string | boolean>): S;
  /**
   * Produce this frame's outputs from `inputs` and the prior `state`. May
   * mutate `state` in-place. Inputs map port name -> last value (0 if
   * unpatched); the engine has already substituted prior-frame values for
   * cycle edges.
   */
  tick(
    ctx: NodeContext,
    state: S,
    inputs: Record<string, number>,
    params: Record<string, number | string | boolean>,
    outputs: Record<string, number>,
  ): void;
}

// --------------------------------------------------------------------
// Engine-internal types (exported for tests)
// --------------------------------------------------------------------

export interface CompiledNode {
  node: GraphNode;
  def: NodeDef<unknown>;
  state: unknown;
  /** This frame's outputs, indexed by port name. */
  outputs: Record<string, number>;
  /** Last frame's outputs — used as inputs for cycle edges. */
  prevOutputs: Record<string, number>;
}

export interface CompiledPatch {
  byId: Map<string, CompiledNode>;
  /** Topological order. Nodes with cycles still appear here; their cycle inputs read `prevOutputs`. */
  order: string[];
  /** Edges that close a cycle and therefore use one-frame delay. */
  cycleEdges: Array<{ from: string; to: string; toPort: string }>;
  bindings: TargetBinding[];
}
