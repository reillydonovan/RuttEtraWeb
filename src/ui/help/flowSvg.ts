/**
 * Draws a `FlowModel` (signalFlow.ts) as an SVG string: the node as a
 * box in the middle, input ports on its left edge with cables fanning
 * out to where they come from, output ports on the right with cables
 * fanning to where they go. Cable colours match the Patch Bay's
 * (Classic green, graph cyan, node wire amber, video violet, SOURCES
 * pale green). Unplugged ports get a short dashed stub and a dim hint.
 * Pure string output (no DOM) so it's trivially testable.
 */

import type { FlowKind, FlowModel, FlowPort } from './signalFlow';

export const FLOW_COLORS: Record<FlowKind, string> = {
  mod: '#5fff85',
  graph: '#5fffd0',
  wire: '#ffb347',
  video: '#c85fff',
  wave: '#b9ffd0',
};

const W = 600;
const LABEL_L = 172;   // left link labels end here (text-anchor end)
const BOX_L = 214;
const BOX_R = 386;
const LABEL_R = 428;   // right link labels start here
const HEAD = 28;
const PAD = 8;
const ROW = 22;
const MAX_ROWS = 14;   // per side; the rest collapse into "+N more"

const esc = (t: string): string =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (t: string, n: number): string => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

interface Row { port: FlowPort; label: string; kind: FlowKind; idle: boolean; empty: boolean }

function rowsOf(ports: FlowPort[]): { rows: Row[]; groups: Array<{ port: FlowPort; first: number; last: number }>; hidden: number } {
  const rows: Row[] = [];
  const groups: Array<{ port: FlowPort; first: number; last: number }> = [];
  let hidden = 0;
  for (const p of ports) {
    const items = p.links.length
      ? p.links.map((l) => ({ port: p, label: l.label, kind: l.kind, idle: !!l.idle, empty: false }))
      : [{ port: p, label: p.empty ?? 'not patched', kind: p.kind, idle: true, empty: true }];
    if (rows.length + items.length > MAX_ROWS) { hidden += items.length; continue; }
    groups.push({ port: p, first: rows.length, last: rows.length + items.length - 1 });
    rows.push(...items);
  }
  return { rows, groups, hidden };
}

/** SVG markup for the diagram, or '' when there's nothing to draw. */
export function flowSvg(f: FlowModel): string {
  if (!f.inputs.length && !f.outputs.length) return '';
  const L = rowsOf(f.inputs);
  const R = rowsOf(f.outputs);
  const extraL = L.hidden ? 1 : 0;
  const extraR = R.hidden ? 1 : 0;
  const n = Math.max(L.rows.length + extraL, R.rows.length + extraR, 1);
  const boxH = HEAD + PAD * 2 + n * ROW;
  const foot = f.unpatched ? 22 : 0;
  const H = boxH + 8 + foot;
  const top = 4;
  // Centre each side's rows vertically inside the box body.
  const rowY = (count: number, i: number): number => {
    const body = n * ROW;
    const off = (body - count * ROW) / 2;
    return top + HEAD + PAD + off + i * ROW + ROW / 2;
  };

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" class="rw-flow" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Signal flow for ${f.title}`)}">`);
  // Box
  out.push(`<rect class="rw-flow-box" x="${BOX_L}" y="${top}" width="${BOX_R - BOX_L}" height="${boxH}" rx="3"/>`);
  out.push(`<line class="rw-flow-rule" x1="${BOX_L}" y1="${top + HEAD}" x2="${BOX_R}" y2="${top + HEAD}"/>`);
  out.push(`<text class="rw-flow-title" x="${(BOX_L + BOX_R) / 2}" y="${top + 18}" text-anchor="middle">${esc(clip(f.title.toUpperCase(), 24))}</text>`);

  const side = (s: typeof L, extra: number, left: boolean): void => {
    const count = s.rows.length + extra;
    for (const g of s.groups) {
      const yFirst = rowY(count, g.first);
      const yLast = rowY(count, g.last);
      const jy = (yFirst + yLast) / 2;
      const jx = left ? BOX_L : BOX_R;
      const row0 = s.rows[g.first];
      const col = FLOW_COLORS[row0.kind];
      // Port name inside the box.
      out.push(`<text class="rw-flow-port" x="${left ? BOX_L + 12 : BOX_R - 12}" y="${jy + 4}" text-anchor="${left ? 'start' : 'end'}"><title>${esc(g.port.name)}</title>${esc(clip(g.port.name, 13))}</text>`);
      for (let i = g.first; i <= g.last; i++) {
        const r = s.rows[i];
        const y = rowY(count, i);
        const c = FLOW_COLORS[r.kind];
        const x0 = jx;
        const x1 = left ? LABEL_L + 6 : LABEL_R - 6;
        const mid = (x0 + x1) / 2;
        const cls = `rw-flow-cable${r.idle ? ' rw-flow-cable--idle' : ''}${r.empty ? ' rw-flow-cable--empty' : ''}`;
        if (r.empty) {
          const stub = left ? x0 - 18 : x0 + 18;
          out.push(`<line class="${cls}" x1="${x0}" y1="${jy}" x2="${stub}" y2="${jy}" stroke="${c}"/>`);
        } else {
          out.push(`<path class="${cls}" d="M${x0} ${jy} C${mid} ${jy} ${mid} ${y} ${x1} ${y}" stroke="${c}"/>`);
          out.push(`<circle class="rw-flow-end" cx="${x1}" cy="${y}" r="2.5" fill="${c}"${r.idle ? ' opacity="0.4"' : ''}/>`);
        }
        const tx = left ? (r.empty ? jx - 24 : LABEL_L) : (r.empty ? jx + 24 : LABEL_R);
        out.push(`<text class="rw-flow-label${r.empty ? ' rw-flow-label--empty' : ''}${r.idle && !r.empty ? ' rw-flow-label--idle' : ''}" x="${tx}" y="${(r.empty ? jy : y) + 4}" text-anchor="${left ? 'end' : 'start'}"><title>${esc(r.label)}</title>${esc(clip(r.label, 26))}</text>`);
      }
      out.push(`<circle class="rw-flow-jack" cx="${jx}" cy="${jy}" r="4.5" stroke="${col}"/>`);
    }
    if (s.hidden) {
      const y = rowY(count, s.rows.length);
      out.push(`<text class="rw-flow-label rw-flow-label--empty" x="${left ? LABEL_L : LABEL_R}" y="${y + 4}" text-anchor="${left ? 'end' : 'start'}">+${s.hidden} more</text>`);
    }
  };
  side(L, extraL, true);
  side(R, extraR, false);

  if (!f.inputs.length) out.push(`<text class="rw-flow-label rw-flow-label--empty" x="${LABEL_L}" y="${top + HEAD + PAD + (n * ROW) / 2 + 4}" text-anchor="end">no inputs</text>`);
  if (!f.outputs.length) out.push(`<text class="rw-flow-label rw-flow-label--empty" x="${LABEL_R}" y="${top + HEAD + PAD + (n * ROW) / 2 + 4}" text-anchor="start">no outputs</text>`);
  if (f.unpatched) {
    out.push(`<text class="rw-flow-foot" x="${(BOX_L + BOX_R) / 2}" y="${boxH + top + 18}" text-anchor="middle">+ ${f.unpatched} more with no cable</text>`);
  }
  out.push('</svg>');
  return out.join('');
}
