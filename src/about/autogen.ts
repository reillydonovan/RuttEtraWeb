/**
 * Auto-generated reference sections for the about page.
 *
 * Same source-of-truth as the in-app Help — `PARAM_DOCS` + the graph
 * node registry. The about page imports these directly so the manual
 * cannot drift from the actual code: a new param description in
 * `content.ts` and a new graph node registered in `nodes/*.ts` show
 * up here on the next build with no manual sync step.
 *
 * Pure-data only: NO three.js, NO Web Audio, NO DOM. The graph
 * registry side-effect is just `Map.set()`. The Settings module is
 * pure types + constants. This is what keeps the about bundle tiny.
 *
 * Output: pre-built HTML strings. We assemble them with simple
 * template strings (no DOM calls) so `buildXxxHtml()` can be called
 * exactly once at startup and the result inserted via insertAdjacentHTML.
 */

import { PARAM_DOCS, ParamDoc } from '../ui/help/paramDocs';
import { allDefs } from '../modulation/graph/registry';
// Pull the bootstrap as a side-effect-only import so every node def
// is registered before we ask the registry for the catalog. The
// bootstrap and node files are pure-data registrations (no three.js,
// no Web Audio, no DOM) so this stays inside the about-page budget.
import '../modulation/graph/bootstrap';
import { NodeDef, ParamSpec, PortSpec } from '../modulation/graph/types';

/** HTML-escape a string for safe insertion as text. Tiny inline helper
 *  rather than a runtime dep — we trust our own paramDocs / nodeDefs
 *  but escape anyway because some descriptions contain `<` etc. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =====================================================================
// Param Reference — every modulatable Settings key, grouped by panel
// =====================================================================

export function buildParamReferenceHtml(): string {
  // Group by `panel` so the table mirrors the in-app Help's Controls tab.
  const groups = new Map<string, Array<[string, ParamDoc]>>();
  for (const [key, doc] of Object.entries(PARAM_DOCS)) {
    const list = groups.get(doc.panel) ?? [];
    list.push([key, doc]);
    groups.set(doc.panel, list);
  }
  // Stable category order — matches the in-app Help's tab layout.
  const ORDER = [
    'Source', 'DCU', 'Camera', 'Color/PostFX', 'Geometry',
    'Modulation', 'MIDI', 'Audio', 'OSC', 'CV',
    'Record', 'Share', 'XR', 'UI',
  ];
  const sortedKeys = ORDER.filter((k) => groups.has(k))
    .concat([...groups.keys()].filter((k) => !ORDER.includes(k)).sort());

  const rows: string[] = [];
  for (const cat of sortedKeys) {
    const list = groups.get(cat)!;
    list.sort((a, b) => a[0].localeCompare(b[0]));
    rows.push(`<h3 id="param-ref-${slug(cat)}" class="about-subhead">${esc(cat === 'Camera' ? 'Virtual Camera' : cat)}</h3>`);
    rows.push('<table class="about-table">');
    rows.push('<thead><tr><th>Key</th><th>Description</th><th>Range</th></tr></thead><tbody>');
    for (const [key, doc] of list) {
      rows.push(
        `<tr><td><code>${esc(key)}</code></td>` +
        `<td>${esc(doc.description)}</td>` +
        `<td>${doc.range ? `<code>${esc(doc.range)}</code>` : '<span class="about-dim">—</span>'}</td></tr>`,
      );
    }
    rows.push('</tbody></table>');
  }

  return `
    <h2 id="param-reference" class="about-autogen-h">Param reference (auto-generated)</h2>
    <p>Every modulatable / persisted setting, grouped by control panel.
       Built at compile time from <code>src/ui/help/content.ts</code>; the
       in-app Help reads the same map.</p>
    ${rows.join('\n')}
  `;
}

// =====================================================================
// Node Catalog — every Graph node, grouped by category
// =====================================================================

export function buildNodeCatalogHtml(): string {
  const defs = allDefs();
  const byCat = new Map<string, NodeDef<unknown>[]>();
  for (const d of defs) {
    const list = byCat.get(d.category) ?? [];
    list.push(d);
    byCat.set(d.category, list);
  }
  const ORDER: NodeDef<unknown>['category'][] = [
    'Sources', 'Audio', 'Video', 'Inputs', 'Processors', 'Logic',
  ];
  const cats = ORDER.filter((c) => byCat.has(c));

  const blocks: string[] = [];
  for (const cat of cats) {
    const list = byCat.get(cat)!;
    list.sort((a, b) => a.label.localeCompare(b.label));
    blocks.push(`<h3 id="node-cat-${slug(cat)}" class="about-subhead">${esc(cat)}</h3>`);
    for (const d of list) {
      blocks.push(renderNodeDef(d));
    }
  }

  return `
    <h2 id="node-catalog" class="about-autogen-h">Node catalog (auto-generated)</h2>
    <p>Every Graph mode node, grouped by palette category. Built from
       the registered node definitions; new nodes appear here as soon as
       they're added to <code>src/modulation/graph/nodes/</code>.</p>
    ${blocks.join('\n')}
  `;
}

function renderNodeDef(d: NodeDef<unknown>): string {
  const inputs = portsList(d.inputs);
  const outputs = portsList(d.outputs);
  const params = paramsList(d.params);
  return `
    <article class="about-node">
      <h4 id="node-${slug(d.type)}"><code>${esc(d.type)}</code> — ${esc(d.label)}</h4>
      <p>${esc(d.description)}</p>
      ${inputs ? `<div class="about-kvp"><span class="about-k">Inputs</span><span>${inputs}</span></div>` : ''}
      ${outputs ? `<div class="about-kvp"><span class="about-k">Outputs</span><span>${outputs}</span></div>` : ''}
      ${params ? `<div class="about-kvp"><span class="about-k">Params</span><span>${params}</span></div>` : ''}
    </article>
  `;
}

function portsList(ports: PortSpec[]): string {
  if (!ports || ports.length === 0) return '<span class="about-dim">none</span>';
  return ports
    .map((p) => `<code>${esc(p.name)}</code> <span class="about-dim">(${esc(p.kind)})</span>`)
    .join(', ');
}

function paramsList(params: Record<string, ParamSpec>): string {
  const keys = Object.keys(params);
  if (keys.length === 0) return '';
  return keys
    .map((k) => {
      const p = params[k];
      let r = '';
      if (p.kind === 'number') {
        r = `${p.min}…${p.max} (default ${p.default})`;
      } else if (p.kind === 'enum') {
        r = `${p.options.join(' | ')} (default ${p.default})`;
      } else if (p.kind === 'boolean') {
        r = `default ${p.default}`;
      }
      return `<code>${esc(k)}</code> <span class="about-dim">${esc(r)}</span>`;
    })
    .join('; ');
}

// =====================================================================
// Helpers
// =====================================================================

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
