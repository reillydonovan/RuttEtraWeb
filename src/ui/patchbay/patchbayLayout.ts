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
  { title: 'PATTERN GENERATOR',   panels: ['Pattern', 'Source'] },
  { title: 'GEOMETRY',            panels: ['Geometry'] },
  { title: 'AUDIO ANALYZER',      panels: ['Audio'] },
];

/**
 * Build the faceplate fields from the live TARGETS × PARAM_DOCS join.
 * `extraTargets` (cv:N virtual outputs etc.) are handled by the caller
 * — this covers the static list.
 */
export function buildFaceplate(): FieldSpec[] {
  const labelOf = new Map<string, string>();
  for (const t of TARGETS) {
    if (t.v !== 'none') labelOf.set(String(t.v), t.l);
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
