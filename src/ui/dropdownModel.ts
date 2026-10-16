/**
 * The pure half of the themed dropdown menu (dropdown.ts): which row is next
 * under the arrow keys, which row a typed letter jumps to, and where the menu
 * goes. DOM-free so it can be unit-tested in node.
 */

export interface MenuRow {
  kind: 'option' | 'group';
  label: string;
  /** Options only. */
  disabled?: boolean;
}

/** Index of the next ENABLED option from `from` in `dir`, or `from` if there is none. */
export function nextOption(rows: readonly MenuRow[], from: number, dir: 1 | -1): number {
  let i = from;
  for (let step = 0; step < rows.length; step++) {
    i += dir;
    if (i < 0 || i >= rows.length) return from;     // stop at the ends, like a native list
    if (rows[i].kind === 'option' && !rows[i].disabled) return i;
  }
  return from;
}

export function firstOption(rows: readonly MenuRow[]): number {
  return rows.findIndex((r) => r.kind === 'option' && !r.disabled);
}

export function lastOption(rows: readonly MenuRow[]): number {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].kind === 'option' && !rows[i].disabled) return i;
  return -1;
}

/**
 * Type-ahead: the next enabled option whose label starts with `typed`
 * (case-insensitive), searching forward from the current row and wrapping.
 * A repeated single letter cycles through that letter's options.
 */
export function typeahead(rows: readonly MenuRow[], current: number, typed: string): number {
  const q = typed.toLowerCase();
  if (!q) return current;
  const cycle = q.length > 1 && [...q].every((c) => c === q[0]);
  const needle = cycle ? q[0] : q;
  const n = rows.length;
  for (let k = 1; k <= n; k++) {
    const i = (current + k) % n;
    const r = rows[i];
    if (r.kind === 'option' && !r.disabled && r.label.toLowerCase().startsWith(needle)) return i;
  }
  return current;
}

export interface Placement {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  /** Opened upward (there was more room above the field than below). */
  above: boolean;
}

/**
 * Place a menu for an anchor rect inside a viewport: left-aligned to the
 * field, at least as wide as it, below it unless the space below can't hold
 * `wanted` px and above has more room. Always fully on screen.
 */
export function placeMenu(
  anchor: { left: number; right: number; top: number; bottom: number },
  viewport: { width: number; height: number },
  wanted: number,
  contentWidth: number,
  gap = 4,
  margin = 8,
): Placement {
  const fieldW = anchor.right - anchor.left;
  const width = Math.min(Math.max(fieldW, contentWidth), viewport.width - margin * 2);
  const left = Math.max(margin, Math.min(anchor.left, viewport.width - margin - width));
  const below = viewport.height - anchor.bottom - gap - margin;
  const above = anchor.top - gap - margin;
  const useAbove = below < Math.min(wanted, 160) && above > below;
  const room = useAbove ? above : below;
  const maxHeight = Math.max(96, Math.min(wanted, room));
  const top = useAbove ? anchor.top - gap - maxHeight : anchor.bottom + gap;
  return { left, top, width, maxHeight, above: useAbove };
}
