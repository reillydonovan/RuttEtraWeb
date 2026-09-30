/**
 * Why a cable can't be patched — the plain-language explanations shown
 * when a drag hovers a jack that won't accept it (owner: "if you try to
 * connect a patch that won't work you should get the red gradient cable
 * ... and a small tooltip describing why"). Pure and DOM-free; shared by
 * the Patch Bay (PatchBayView) and the rack skin's Controls cables
 * (RackLayer), so both surfaces give the same answer.
 *
 * Each surface decides VALIDITY itself (its drag handlers only snap to
 * jacks they can actually wire). This module only EXPLAINS a jack the
 * drag is near but won't snap to, from the kind of jack the cable is
 * coming from (`from`, the fixed end) and the kind it's hovering (`to`).
 */

export type JackKind =
  | 'param-in' | 'param-out'
  | 'slot-out'
  | 'slot-srcin' | 'shape' | 'bus'
  | 'node-in' | 'node-out'
  | 'video-in' | 'video-out';

export interface RejectContext {
  /** Both ends are the same parameter (param OUT → its own IN). */
  sameParam?: boolean;
  /** The cable being moved is an existing graph→parameter binding. */
  bindingReroute?: boolean;
  /** Video endpoint ids (`VideoOutKey`/`VideoInKey`) when relevant. */
  fromKey?: string;
  toKey?: string;
}

const OUTPUTS = new Set<JackKind>(['param-out', 'slot-out', 'node-out', 'video-out', 'bus']);
const WAVE_INPUTS = new Set<JackKind>(['slot-srcin', 'shape']);
const isVideo = (k: JackKind): boolean => k === 'video-in' || k === 'video-out';

export function rejectReason(from: JackKind, to: JackKind, ctx: RejectContext = {}): string {
  // Signal types that never mix.
  if (isVideo(from) && !isVideo(to)) return 'Video cables only connect video jacks — Source, Composite, Dual Raster and Renderer.';
  if (!isVideo(from) && isVideo(to)) return 'That’s a video jack — it carries a picture, not a control signal.';

  // Waveform picks: the SOURCES bus feeds SRC IN / LFO shape jacks only.
  if (from === 'bus' && !WAVE_INPUTS.has(to)) return 'SOURCES jacks pick a waveform — patch them into a Function Generator’s SRC IN or an LFO’s shape jack.';
  if (WAVE_INPUTS.has(from) && to !== 'bus') return 'This jack takes a waveform from the SOURCES bus.';
  if (WAVE_INPUTS.has(to) && from !== 'bus') return 'SRC IN and shape jacks take a waveform from the SOURCES bus.';
  if (to === 'bus') return 'SOURCES jacks are waveform outputs — they feed SRC IN and shape jacks.';

  // Direction.
  const fromOut = OUTPUTS.has(from);
  const toOut = OUTPUTS.has(to);
  if (fromOut && toOut) return 'Both ends are outputs — an output has to go into an input.';
  if (!fromOut && !toOut) return 'Both ends are inputs — connect this to an output jack.';

  if (ctx.sameParam) return 'A parameter can’t modulate itself.';

  // Video routing rules.
  if (isVideo(from)) {
    const out = from === 'video-out' ? ctx.fromKey : ctx.toKey;
    const inn = from === 'video-in' ? ctx.fromKey : ctx.toKey;
    if (out === 'dualraster-out') {
      return inn?.startsWith('dualraster') ? 'Dual Raster can’t feed its own input.' : 'Dual Raster’s output can only go to the Renderer.';
    }
    if (out === 'composite-out' && inn?.startsWith('composite')) return 'Composite can’t feed its own input.';
    return 'That video connection isn’t possible.';
  }

  // Modulation specifics.
  if (ctx.bindingReroute && to === 'node-in') return 'This cable sets a parameter — drop it on a parameter’s input.';
  if ((from === 'slot-out' && to === 'node-in') || (from === 'node-in' && to === 'slot-out')) {
    return 'Function Generators drive parameters, not graph node inputs — use a graph node’s or a parameter’s OUT.';
  }
  return 'Those two jacks can’t be patched together.';
}
