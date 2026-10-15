/**
 * Section grouping for compact-mode tab bar. The single source of truth so
 * grouping can be reorganized in one place without touching section files.
 *
 * Each tab references existing section titles (the strings passed to
 * `panel.addSection({ title, ... })`). `ResponsivePanel` looks the section
 * elements up by title.
 */

export interface CompactTabSpec {
  /** Stable id used for state + ARIA. */
  id: 'source' | 'synth' | 'mod' | 'fx' | 'more';
  /** Short label for the bottom tab bar. */
  label: string;
  /** Icon id (see TabBar's ICONS); unknown ids render as plain text. */
  icon: string;
  /** Section titles routed into this tab. */
  sections: string[];
}

/**
 * The phone's section set. Boundaries vs desktop (owner: "boundaries between
 * mobile and desktop capabilities"): the Patch Bay, Timeline, MIDI, OSC, CV,
 * MCP, XR, Dual Raster, Video Source B and the broadcast tools are
 * desktop-only — they need a mouse, a keyboard, hardware or a bridge. Their
 * sections simply aren't routed into a tab here (they still exist, and come
 * back the moment the layout is not compact).
 */
export const COMPACT_TABS: CompactTabSpec[] = [
  { id: 'source', label: 'Source', icon: 'source', sections: ['Video Source A'] },
  { id: 'synth',  label: 'Shape',  icon: 'shape',  sections: ['Display Control Unit', 'Virtual Camera'] },
  { id: 'mod',    label: 'Motion', icon: 'motion', sections: ['Modulation', 'Audio'] },
  { id: 'fx',     label: 'Color',  icon: 'color',  sections: ['Color / Post FX', 'Geometry'] },
  { id: 'more',   label: 'More',   icon: 'more',   sections: ['Presets', 'Record', 'Share', 'Manual'] },
];
