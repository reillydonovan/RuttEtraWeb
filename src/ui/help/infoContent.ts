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
import { groupHint } from './groupHints';
import { TARGETS } from '../targets';
import type { NodeDef } from '../../modulation/graph/types';
import type { FlowModel } from './signalFlow';

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
  /** Live signal-flow diagram (what's patched in / out right now). */
  flow?: FlowModel;
  /** Key into public/info/manifest.json: the picture / clip that SHOWS this unit
   *  (tools/tutorials/info-media.mjs generates them). Text is the supporting act. */
  mediaKey?: string;
}

/** Stable slug for a media key part ("Position & Size" → "position-size"). */
export function slug(s: string): string {
  return s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
/** The manifest key for a unit: section.<s> · group.<s>.<g> · module.<m> · node.<type> · timeline.<part>. */
export const mediaKeys = {
  section: (title: string): string => `section.${slug(title)}`,
  group: (section: string | null, title: string): string => `group.${slug(section ?? 'panel')}.${slug(title)}`,
  module: (title: string): string => `module.${slug(title)}`,
  node: (type: string): string => `node.${slug(type)}`,
  timeline: (part: string): string => `timeline.${slug(part)}`,
};

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
    summary: 'One of the four function generators, as a hardware module: a waveform running at RATE and scaled by AMT, sent from its OUT jack into any parameter.',
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
  'VIRTUAL CAMERA': { summary: 'The virtual 3D camera looking at the scanline mesh (not your webcam — that’s Video Source): field of view, clipping, orbit and fly speeds.' },
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
    mediaKey: mediaKeys.module(title),
  };
}

/** Info for a sub-group inside a Controls section (a headed block of controls). */
export function groupInfo(title: string, section: string | null, keys: readonly string[]): InfoContent {
  const rows = paramRows(keys);
  const summary = groupHint(section, title);
  return {
    title,
    kicker: section ? `${section} · group` : 'Controls group',
    summary: summary || (rows.length ? 'The controls in this group are listed below.' : 'No description yet.'),
    sections: rows.length ? [{ heading: 'Parameters', rows }] : [],
    tips: rows.length ? ['Hover any control for a short description. The ▾ next to a slider sets a custom range or an exact value.'] : [],
    aboutHash: rows.length ? 'param-reference' : undefined,
    mediaKey: mediaKeys.group(section, title),
  };
}

/** Hand-written guides for Controls sections with few or no parameters
 *  (buttons, files, connections): what each part does, in the order you use it. */
const SECTION_GUIDES: Record<string, { sections: InfoSection[]; tips: string[]; aboutHash: string }> = {
  Manual: {
    sections: [{ heading: 'Pages', rows: [
      { name: 'What is this?', text: 'What the 1973 Rutt/Etra Scan Processor was and what this recreation does.' },
      { name: 'Quick start', text: 'The menu bar, windows and tabs, skins, the Patch Bay and the first things to try.' },
      { name: 'Controls', text: 'Every panel section and parameter, with ranges.' },
      { name: 'Shortcuts', text: 'Keyboard shortcuts, globally and while the timeline is hovered.' },
      { name: 'Modulation · Timeline · Project', text: 'The Function Generator and Graph engines, keyframing and scenes, saving your work.' },
      { name: 'WebXR · Anaglyph 3D · 3D Recording', text: 'Headset, red/cyan and stereo output.' },
      { name: 'Video Audio · Streaming', text: 'Sound from video files; WebRTC and WHIP broadcast.' },
      { name: 'Tips & gotchas · About', text: 'Known quirks and the version you are running.' },
    ] }],
    tips: [
      'The full illustrated manual, with the Param Reference and Node Catalog, is Help ▸ Open Manual.',
      'Help ▸ Video Tutorials has the narrated course; Help ▸ Start Tutorial walks you through the panel in place.',
      'Every section and module has its own ⓘ like this one.',
    ],
    aboutHash: 'quick-start',
  },
  Presets: {
    sections: [{ heading: 'How it works', rows: [
      { name: 'Built-in looks', text: 'Click a chip to apply it. Only the look changes; MIDI/OSC mappings, the patch and the layout stay.' },
      { name: 'User Presets', text: 'Save Current stores the current state as your own preset in this browser; Load and Delete manage them.' },
      { name: 'Import / Export', text: 'Export JSON writes a preset file to share; Import reads one. Export Everything backs up all saved settings.' },
      { name: 'Danger Zone', text: 'Clear Saved and Hard Reset GUI wipe stored settings. Use them only to start over.' },
    ] }],
    tips: ['A preset is one look. A project is the whole workspace; a timeline is a score of looks over time.'],
    aboutHash: 'presets',
  },
  Project: {
    sections: [{ heading: 'How it works', rows: [
      { name: 'New / Open… / Save / Save As…', text: 'A project (.synth.json) holds every setting, your presets and your timelines. Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S.' },
      { name: 'Name', text: 'Click the name to rename the project.' },
      { name: 'Auto-save', text: 'Writes a recovery copy every 60 s. Unsaved work is also kept when you reload, and you are asked to restore or clear it.' },
      { name: 'Recent Projects', text: 'Reopen a project you saved before; Clear recent empties the list.' },
    ] }],
    tips: ['Output safety still applies on open: sound and CV output always load switched off.'],
    aboutHash: 'project-save-load-walkthrough',
  },
  Record: {
    sections: [{ heading: 'How it works', rows: [
      { name: 'Start Recording', text: 'Captures the render output to a video file in the browser and downloads it when you stop.' },
      { name: 'Record Timeline', text: 'Plays the loaded timeline from the start and records exactly its length.' },
      { name: 'Format · FPS · Bitrate', text: 'MP4 / H.264 or WebM; fixed when recording starts.' },
      { name: 'Include Mic · Include Video Audio', text: 'Adds sound to the recording.' },
      { name: 'Stereoscopic 3D', text: 'Records a side-by-side 3D video; IPD sets the eye spacing.' },
    ] }],
    tips: ['For a clean frame, hide the HUD with H before you record.'],
    aboutHash: 'recording',
  },
  Share: {
    sections: [{ heading: 'How it works', rows: [
      { name: 'Start Broadcast', text: 'Peer-to-peer: Copy URL gives a viewer link; anyone who opens it sees your output live, with no UI.' },
      { name: 'WHIP Output', text: 'Publishes to OBS, MediaMTX, Cloudflare or another WHIP server. Paste its Endpoint and Token, then Start WHIP.' },
    ] }],
    tips: ['Tokens are never saved into exported files.'],
    aboutHash: 'live-output-streaming-and-broadcast',
  },
  MCP: {
    sections: [{ heading: 'How it works', rows: [
      { name: 'MCP Bridge', text: 'Run tools/mcp-server on this computer, enter its URL, then Connect. An AI assistant can then read and set parameters, run menu actions, edit the graph patch and take screenshots.' },
      { name: 'Auto-connect on startup', text: 'Connects again whenever the app loads.' },
    ] }],
    tips: ['The bridge only listens on this computer (127.0.0.1). Opening someone else’s project never connects it.'],
    aboutHash: 'mcp-remote-control',
  },
};

/** Info for a Controls panel section. */
export function sectionInfo(title: string, keys: readonly string[]): InfoContent {
  const rows = paramRows(keys);
  const guide = SECTION_GUIDES[title];
  return {
    title,
    kicker: 'Controls section',
    summary: SECTION_HINTS[title] ?? MODULE_INFO[moduleKey(title)]?.summary ?? '',
    sections: [...(guide?.sections ?? []), ...(rows.length ? [{ heading: 'Parameters', rows }] : [])],
    tips: [...(guide?.tips ?? []), ...(rows.length ? ['Hover any control for a short description. The ▾ next to a slider sets a custom range or an exact value.'] : [])],
    aboutHash: guide?.aboutHash ?? (rows.length ? 'param-reference' : undefined),
    mediaKey: mediaKeys.section(title),
  };
}

function specDetail(spec: NodeDef['params'][string]): string {
  switch (spec.kind) {
    case 'number': return `${spec.min}–${spec.max}, default ${spec.default}`;
    case 'enum': return spec.options.length > 10 ? `one of ${spec.options.length} choices` : spec.options.join(' · ');
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
    sections.push({ heading: 'Controls', rows: params.map(([name, s]) => ({ name, detail: specDetail(s), ...(s.help ? { text: s.help } : {}) })) });
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
    mediaKey: mediaKeys.node(def.type),
  };
}

/**
 * The Timeline dock's ⓘ (owner: "the timeline feels like it needs an info
 * button… it's something I'm having a hard time using myself"). A quick
 * start in the order you actually do things, then a glossary of the
 * dock's parts. The long form is the manual's "Timeline sequencer (full
 * walkthrough)"; the video course has lessons 8 (Keyframes) and 9 (Scenes).
 */
export const TIMELINE_INFO: InfoContent = {
  kicker: 'Workspace window',
  title: 'Timeline',
  mediaKey: mediaKeys.timeline('overview'),
  summary:
    'A score for the synth, laid out in bars at the shared BPM. Keyframe one knob (a lane) or the whole look (a scene), press Play, and the timeline animates them for you.',
  tips: [
    'Make a timeline: + NEW, then give it a length in BARS. Nothing is animated until you add keyframes.',
    'Key one knob: in Controls, park the playhead (click or drag the ruler), then click the ◆ diamond on any slider. That creates its lane with a point at the playhead.',
    'Add more points: move the playhead to another bar and just turn the knob. Once a knob has a lane, every change is keyed at the playhead (auto-key).',
    'Key the whole look: press K (or double-click the SCENES track) to snapshot every setting at the playhead. The playhead blends between neighbouring scenes.',
    'Play: PLAY / Space. LOOP wraps at the end. |◀ ▶| (or , and .) jump between keyframes.',
    'Shape a lane: drag its points (left/right = bar, up/down = value), double-click a lane row to add a point, right-click a point for its easing or to delete it.',
    'Watch it: Help ▸ Video Tutorials, lessons 8 (Keyframes) and 9 (Scenes).',
  ],
  sections: [
    {
      heading: 'The parts',
      rows: [
        { name: 'Ruler', text: 'Bars along the top. Click or drag it to move the playhead. Ctrl/Cmd+wheel zooms, Shift+wheel pans.' },
        { name: 'SCENES', text: 'Whole-look snapshots. Each marker sets everything; the easing on a scene is the curve into it.' },
        { name: 'Lanes', text: 'One knob each, drawn in that knob\'s own numbers. The dashed line is the knob\'s base value. A lane adds to LFOs and CV rather than fighting them.' },
        { name: 'Inspector', text: 'The right column: the selected point\'s bar, value and easing; mute or delete its lane.' },
        { name: 'Amber knobs', text: 'In Controls, an amber readout means the timeline owns that knob right now.' },
        { name: 'DISPLAY', text: 'How the counter reads (bars, timecode, frames, samples). It never changes playback.' },
      ],
    },
  ],
  aboutHash: 'timeline-sequencer-full-walkthrough',
};
