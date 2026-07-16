/**
 * Pure faceplate-layout data for the Patch Bay view — DOM-free,
 * node-tested.
 *
 * The faceplate's engraved field grouping is the ORIGINAL hardware's:
 * the DCU sub-groups come from docs/about/04-synthesis.md (Position &
 * Size, Depth, Beam, Rotation, Scan, Linearity, Luminance — the manual
 * derives them from the Rutt Electrophysics brochure), and everything
 * else groups by its PARAM_DOCS `panel` category. A coverage test
 * asserts every TARGETS entry lands in exactly one field, so adding a
 * modulation target without a faceplate home fails loudly.
 */

import { TARGETS } from '../targets';
import { PARAM_DOCS } from '../help/paramDocs';
import type { ModSource } from '../../state/Settings';

export interface ParamJackSpec {
  key: string;
  label: string;
}

export interface FieldSpec {
  /** Engraved field label, e.g. 'POSITION & SIZE'. */
  title: string;
  /** Faceplate column: 1 = DCU (center-left), 2 = right rail. */
  column: 1 | 2;
  params: ParamJackSpec[];
}

/**
 * The DCU's brochure sub-groups (04-synthesis.md §DCU). Order = top to
 * bottom on the faceplate.
 */
const DCU_SUBGROUPS: ReadonlyArray<{ title: string; keys: readonly string[] }> = [
  { title: 'POSITION & SIZE', keys: ['hPos', 'vPos', 'hSize', 'vSize', 'aspect'] },
  { title: 'DEPTH',           keys: ['zPush', 'zBias'] },
  { title: 'BEAM',            keys: ['intensity', 'focus'] },
  { title: 'ROTATION',        keys: ['hCenter', 'vCenter', 'hSpin', 'vSpin', 'rotation'] },
  { title: 'SCAN',            keys: ['skip'] },
  { title: 'LINEARITY',       keys: ['hLinearity', 'vLinearity'] },
  { title: 'LUMINANCE',       keys: ['threshold', 'contrast', 'gamma'] },
];

/** PanelGroup -> right-rail field title + order. Groups not listed fall
 *  into 'AUXILIARY' at the end (coverage test keeps this honest). */
const PANEL_FIELDS: ReadonlyArray<{ title: string; panels: readonly string[] }> = [
  { title: 'COLORIZER / POST-FX', panels: ['Color/PostFX'] },
  { title: 'CAMERA',              panels: ['Camera'] },
  // No 'Pattern'/'Source' field group here (there used to be one,
  // "PATTERN GENERATOR" — confused an owner report next to the rail's
  // own dedicated PATTERN GENERATOR module, "it is unclear what the
  // difference is"). Every Pattern Generator param now gets its ONE
  // authoritative IN/OUT jack pair directly on that module instead
  // (`addParamCell`, kind-filtered) — a second static copy here would
  // be two competing jacks for the same signal. `videoCompositeMix`
  // (the only OTHER 'Source'-tagged key) falls to AUXILIARY, same as
  // any target with no dedicated field.
  { title: 'GEOMETRY',            panels: ['Geometry'] },
  { title: 'AUDIO ANALYZER',      panels: ['Audio'] },
];

/**
 * Every `patternXxx` TARGETS entry (the per-kind pattern params, plus
 * `patternMix`) is deliberately excluded from the general faceplate —
 * these get their ONE authoritative IN/OUT jack pair (or, for
 * `patternMix`, its one control) directly on the rail's own PATTERN
 * GENERATOR module (`addParamCell`/hand-built row in
 * `PatchBayView.ts`, kind-filtered). A second copy here would be a
 * silent `paramJacks` Map-key collision — two `addParamCell` calls for
 * the same key overwrite each other's jack registration, so whichever
 * builds second "wins" the wireable instance and the other's jack
 * becomes visually present but permanently unwireable (found live:
 * an owner-reported "brightness IN wired from Classic slot" drag
 * silently no-opped because the general faceplate's AUXILIARY catch-all
 * had re-registered `patternBrightness` after the Pattern Generator
 * module built its own copy first).
 */
const PATTERN_OWNED_PREFIX = 'pattern';

/**
 * Every raster-B / dual-trace TARGETS entry gets its ONE authoritative
 * IN/OUT jack pair (or, for `dualRasterEnabled`/`dualMode`, its one
 * control) directly on the rail's own DUAL RASTER module — same
 * reasoning and same bug class as `PATTERN_OWNED_PREFIX` above (a
 * second static copy on the general faceplate would be a silent
 * `paramJacks` Map-key collision, not a visible error). Listed
 * explicitly rather than by prefix: 17 of these 18 keys happen to
 * start with `b`, but relying on that would silently swallow a future
 * unrelated `b*`-prefixed target too.
 */
const DUAL_RASTER_OWNED = new Set<string>([
  'dualTracePos',
  'bHPos', 'bVPos', 'bHSize', 'bVSize',
  'bZPush', 'bZBias', 'bIntensity',
  'bHCenter', 'bVCenter', 'bHSpin', 'bVSpin', 'bRotation',
  'bHLinearity', 'bVLinearity',
  'bThreshold', 'bContrast', 'bGamma',
]);

/**
 * Build the faceplate fields from the live TARGETS × PARAM_DOCS join.
 * `extraTargets` (cv:N virtual outputs etc.) are handled by the caller
 * — this covers the static list.
 */
export function buildFaceplate(): FieldSpec[] {
  const labelOf = new Map<string, string>();
  for (const t of TARGETS) {
    if (t.v !== 'none' && !String(t.v).startsWith(PATTERN_OWNED_PREFIX) && !DUAL_RASTER_OWNED.has(String(t.v))) {
      labelOf.set(String(t.v), t.l);
    }
  }

  const fields: FieldSpec[] = [];
  const placed = new Set<string>();

  for (const g of DCU_SUBGROUPS) {
    const params = g.keys
      .filter((k) => labelOf.has(k))
      .map((k) => ({ key: k, label: labelOf.get(k)! }));
    for (const p of params) placed.add(p.key);
    if (params.length) fields.push({ title: g.title, column: 1, params });
  }

  for (const f of PANEL_FIELDS) {
    const params: ParamJackSpec[] = [];
    for (const [key, label] of labelOf) {
      if (placed.has(key)) continue;
      const panel = PARAM_DOCS[key]?.panel;
      if (panel && f.panels.includes(panel)) {
        params.push({ key, label });
        placed.add(key);
      }
    }
    if (params.length) fields.push({ title: f.title, column: 2, params });
  }

  // Whatever's left (new panels, DCU keys outside the brochure groups)
  // lands in a visible catch-all rather than silently vanishing.
  const leftovers: ParamJackSpec[] = [];
  for (const [key, label] of labelOf) {
    if (!placed.has(key)) leftovers.push({ key, label });
  }
  if (leftovers.length) fields.push({ title: 'AUXILIARY', column: 2, params: leftovers });

  return fields;
}

/**
 * The SOURCES field: signal jacks a slot's SRC IN can be patched from.
 * Deliberately the performable core (waveforms + audio + joystick), not
 * every ModSource — sources needing extra config (MIDI CC number, CV
 * channel, pattern output id) keep their dropdown home in the slot.
 */
export const SOURCE_JACKS: ReadonlyArray<{ source: ModSource; label: string }> = [
  { source: 'sine',     label: 'SINE' },
  { source: 'triangle', label: 'TRI' },
  { source: 'square',   label: 'SQR' },
  { source: 'saw',      label: 'SAW' },
  { source: 'pulse',    label: 'PULSE' },
  { source: 'ramp',     label: 'RAMP' },
  { source: 'audio',    label: 'AUDIO ENV' },
  { source: 'audioBand', label: 'AUDIO BAND' },
  { source: 'beat',     label: 'BEAT' },
  { source: 'joystickX', label: 'JOY X' },
  { source: 'joystickY', label: 'JOY Y' },
  // External control inputs. Their fine config (which CC number, which
  // CV channel, which OSC address) lives in the generator's slot body
  // in the Modulation panel — the jack picks the SIGNAL TYPE.
  { source: 'midiCC',   label: 'MIDI CC' },
  { source: 'cvAudio',  label: 'CV IN' },
  { source: 'osc',      label: 'OSC' },
];
