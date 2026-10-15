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
  /** Single character / glyph icon. Plain text — keeps the CRT look. */
  icon: string;
  /** Section titles routed into this tab. */
  sections: string[];
}

export const COMPACT_TABS: CompactTabSpec[] = [
  { id: 'source', label: 'Source', icon: 'IN',  sections: ['Video Source A', 'Video Source B'] },
  { id: 'synth',  label: 'Synth',  icon: 'DCU', sections: ['Display Control Unit'] },
  { id: 'mod',    label: 'Mod',    icon: 'MOD', sections: ['Modulation', 'Audio', 'MIDI', 'OSC'] },
  { id: 'fx',     label: 'FX',     icon: 'FX',  sections: ['Color / Post FX', 'Geometry'] },
  { id: 'more',   label: 'More',   icon: '...', sections: ['Virtual Camera', 'Presets', 'Record', 'Share', 'Manual'] },
];
