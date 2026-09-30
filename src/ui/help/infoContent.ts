/**
 * Content for the ⓘ info pop-ups on every Patch Bay module and every
 * Controls section (owner ask, 2026-09-30: "a little info button ... that
 * spawns a modal with supporting information about the node and how to
 * use it").
 *
 * One source per fact (principle 1): parameter text comes from
 * `PARAM_DOCS`, Controls-section summaries from `SECTION_HINTS`, graph
 * node text from the node registry's `NodeDef` (the same data behind the
 * About page's Param Reference and Node Catalog). The only text written
 * here is `MODULE_INFO` — summaries and tips for the Patch Bay's fixed
 * hardware modules, which have no other home. Pure and DOM-free.
 */

import { PARAM_DOCS } from './paramDocs';
import { SECTION_HINTS } from './sectionHints';
import { TARGETS } from '../targets';
import type { NodeDef } from '../../modulation/graph/types';

export interface InfoRow {
  name: string;
  /** Range / default / port kind — shown dimmed after the name. */
  detail?: string;
  text?: string;
}
export interface InfoSection { heading: string; rows: InfoRow[] }
export interface InfoContent {
  title: string;
  /** Small label above the title (category). */
  kicker?: string;
  summary: string;
  sections: InfoSection[];
  tips: string[];
  /** Anchor on about.html for "read more". */
  aboutHash?: string;
}

const LABELS = new Map<string, string>(TARGETS.map((t) => [String(t.v), t.l]));

/** Human label for a Settings key (TARGETS label, else a de-camelled key). */
export function paramLabel(key: string): string {
  return LABELS.get(key) ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

/** One row per documented parameter, in the order given, de-duplicated. */
export function paramRows(keys: readonly string[]): InfoRow[] {
  const seen = new Set<string>();
  const rows: InfoRow[] = [];
  for (const k of keys) {
    if (seen.has(k)) continue;
    seen.add(k);
    const doc = PARAM_DOCS[k];
    if (!doc) continue;
    rows.push({ name: paramLabel(k), detail: doc.range, text: doc.description });
  }
  return rows;
}

const JACK_TIP = 'Each parameter has an IN jack (left), a knob and value, and an OUT jack (right). Patch an output into IN to modulate it; drag its OUT onto another parameter’s IN to let one drive the other.';
const RANGE_TIP = 'The ▾ next to a parameter sets a custom min/max range (shared with the Controls panel).';

interface ModuleText { summary: string; tips?: string[]; about?: string }

/** Patch Bay hardware modules and faceplate fields, keyed by header text. */
export const MODULE_INFO: Record<string, ModuleText> = {
  'FUNCTION GEN': {
    summary: 'One of the four Classic modulation slots, as a hardware module: a waveform running at RATE and scaled by AMT, sent from its OUT jack into any parameter.',
    tips: [
      'Drag OUT onto a parameter’s IN jack to modulate that parameter.',
      'Drag a waveform from the SOURCES bus into SRC IN to change its shape.',
      'The LED in the header mutes the slot without removing its cable.',
    ],
  },
  SOURCES: {
    summary: 'The waveform and live-input bus: SINE, TRI, SQR, SAW, PULSE and RAMP, plus audio, beat, joystick, MIDI CC, CV IN and OSC.',
    tips: ['Drag a jack from here into a Function Generator’s SRC IN, or onto an LFO node’s shape jack, to pick its waveform.'],
  },
  'VIDEO SOURCE A': {
    summary: 'The main video input — webcam, screen or file (the same input as Controls ▸ Source).',
    tips: [
      'Drag OUT into COMPOSITE, DUAL RASTER or the RENDERER to route this picture.',
      'Open ▸ PREVIEW to see the raw input.',
    ],
  },
  'VIDEO SOURCE B': {
    summary: 'A second, independent video input — use it with COMPOSITE to blend two pictures, or with DUAL RASTER to give each raster its own camera.',
    tips: [
      'Pick a specific camera for it in Controls ▸ Video Source B.',
      'Drag OUT into COMPOSITE, DUAL RASTER or the RENDERER.',
    ],
  },
  COMPOSITE: {
    summary: 'Blends two video inputs into one picture with a blend mode (screen, add, mix, difference…) and a mix amount.',
    tips: [
      'Patch two sources into A and B; the order matters for subtract and mask modes.',
      'Send OUT to the RENDERER, or into one side of DUAL RASTER.',
    ],
  },
  'DUAL RASTER': {
    summary: 'Two scan rasters at once, each fed its own video. Raster B has its own position, depth, beam, rotation and luminance controls.',
    tips: [
      'Patch a video into A and another into B, then send OUT to the RENDERER — that also switches Dual Raster on.',
      'Mode sets how the two rasters share the frame (wipe or interleave).',
    ],
  },
  RENDERER: {
    summary: 'The output: whatever is patched into its IN becomes the scanline picture. With nothing patched it shows Video Source A.',
    tips: ['Unplug its cable to return to Video Source A.'],
  },
  'PATTERN GENERATOR': {
    summary: 'A built-in synthesized picture (bars, noise, Lissajous, oscilloscope…) laid over the video with a blend mode and mix — no camera needed.',
    tips: [
      'Each kind shows only the controls it uses; every one has IN and OUT jacks.',
      'Open ▸ PREVIEW to see the raw pattern before it is blended.',
    ],
  },
  'CV OUT': {
    summary: 'Sends signals out to analog hardware as control voltage, through a DC-coupled audio interface.',
    tips: ['Off on every load for safety — arm it in Controls ▸ CV Out first.'],
  },
  'POSITION & SIZE': { summary: 'Where the raster sits on screen and how big it is.' },
  DEPTH: { summary: 'Z displacement — how far bright areas push the scan lines toward you. The heart of the Rutt/Etra look.' },
  BEAM: { summary: 'The electron beam: overall brightness (intensity) and sharpness (focus).' },
  ROTATION: {
    summary: 'Rotates the raster. H Center and V Center set the pivot point — they only show a change while the raster is rotated or spinning.',
  },
  SCAN: { summary: 'Scan-line spacing — skipping lines for a sparser raster.' },
  LINEARITY: { summary: 'Bends the horizontal and vertical sweep, like the deflection linearity trims on the original hardware.' },
  LUMINANCE: { summary: 'Shapes how video brightness becomes depth: threshold cuts the darks, contrast and gamma bend the curve.' },
  'COLORIZER / POST-FX': { summary: 'Colour and the CRT post-processing chain: bloom, scanlines, chroma, vignette, feedback and analog character.' },
  CAMERA: { summary: 'The 3D camera looking at the mesh: field of view, clipping, orbit and fly speeds.' },
  GEOMETRY: { summary: 'The scanline mesh itself.' },
  'AUDIO ANALYZER': { summary: 'The audio analysis that feeds the audio sources — gain, floor, attack, release and beat sensitivity.' },
  AUXILIARY: { summary: 'Modulatable parameters that don’t have a dedicated module yet.' },
};

/** Header text → MODULE_INFO key ("FUNCTION GEN 3" → "FUNCTION GEN"). */
export function moduleKey(title: string): string {
  const t = title.trim().toUpperCase();
  if (t.startsWith('FUNCTION GEN')) return 'FUNCTION GEN';
  return t;
}

/** Info for a Patch Bay hardware module or faceplate field. */
export function moduleInfo(title: string, keys: readonly string[]): InfoContent {
  const m = MODULE_INFO[moduleKey(title)];
  const rows = paramRows(keys);
  const tips = [...(m?.tips ?? [])];
  if (rows.length) tips.push(JACK_TIP, RANGE_TIP);
  return {
    title: title.trim(),
    kicker: 'Patch Bay module',
    summary: m?.summary ?? 'A Patch Bay module.',
    sections: rows.length ? [{ heading: 'Parameters', rows }] : [],
    tips,
    aboutHash: rows.length ? 'param-reference' : 'the-patch-bay',
  };
}

/** Info for a Controls panel section. */
export function sectionInfo(title: string, keys: readonly string[]): InfoContent {
  const rows = paramRows(keys);
  return {
    title,
    kicker: 'Controls section',
    summary: SECTION_HINTS[title] ?? MODULE_INFO[moduleKey(title)]?.summary ?? '',
    sections: rows.length ? [{ heading: 'Parameters', rows }] : [],
    tips: rows.length ? ['Hover any control for a short description. The ▾ next to a slider sets a custom range or an exact value.'] : [],
    aboutHash: rows.length ? 'param-reference' : undefined,
  };
}

function specDetail(spec: NodeDef['params'][string]): string {
  switch (spec.kind) {
    case 'number': return `${spec.min}–${spec.max}, default ${spec.default}`;
    case 'enum': return spec.options.join(' · ');
    case 'boolean': return `on/off, default ${spec.default ? 'on' : 'off'}`;
    default: return 'text';
  }
}

/** Info for a graph-engine node (from its registry definition). */
export function nodeInfo(def: Pick<NodeDef, 'type' | 'label' | 'category' | 'description' | 'inputs' | 'outputs' | 'params'>): InfoContent {
  const sections: InfoSection[] = [];
  if (def.inputs.length) {
    sections.push({ heading: 'Inputs', rows: def.inputs.map((p) => ({ name: p.label ?? p.name, detail: p.kind })) });
  }
  const params = Object.entries(def.params).filter(([, s]) => s.kind !== 'text');
  if (params.length) {
    sections.push({ heading: 'Controls', rows: params.map(([name, s]) => ({ name, detail: specDetail(s) })) });
  }
  if (def.outputs.length) {
    sections.push({ heading: 'Outputs', rows: def.outputs.map((p) => ({ name: p.label ?? p.name, detail: p.kind })) });
  }
  const tips: string[] = [];
  if (def.outputs.length) tips.push('Drag an OUT jack onto a parameter’s IN to modulate it, or onto another node’s input to chain them.');
  if (def.inputs.length) tips.push('Its inputs take a cable from another node’s or a parameter’s OUT.');
  tips.push('The LED in the header mutes the node; ✕ deletes it. Right-click empty board space to add more nodes.');
  return {
    title: def.label,
    kicker: `Graph node · ${def.category}`,
    summary: def.description,
    sections,
    tips,
    aboutHash: `node-${def.type.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
  };
}
