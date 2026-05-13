/**
 * Tiny markdown-to-HTMLElement renderer.
 *
 * Supports:
 *   #, ##, ### headings
 *   **bold**, *italic*
 *   `inline code` (rendered as <kbd> for keystroke-flavor)
 *   [text](url) links
 *   - and 1. lists (single level; flat output is fine)
 *   | tables |
 *   > blockquotes
 *
 * Not a general markdown parser — just enough for the in-app manual.
 */

export function renderMarkdown(md: string, opts: { search?: string } = {}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'rw-help-md';

  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  // Skip leading blank lines.
  while (i < lines.length && lines[i].trim() === '') i++;

  while (i < lines.length) {
    const line = lines[i];

    // Tables (must come before list/heading checks).
    if (isTableHeader(line, lines[i + 1])) {
      const { node, consumed } = parseTable(lines, i);
      root.appendChild(node);
      i += consumed;
      continue;
    }

    // Headings.
    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const tag = `h${headingMatch[1].length}` as 'h1' | 'h2' | 'h3';
      const h = document.createElement(tag);
      h.append(...renderInline(headingMatch[2]));
      root.appendChild(h);
      i++;
      continue;
    }

    // Blockquote.
    if (line.startsWith('> ')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        buf.push(lines[i].slice(2));
        i++;
      }
      const bq = document.createElement('blockquote');
      bq.append(...renderInline(buf.join(' ')));
      root.appendChild(bq);
      continue;
    }

    // Lists (- or 1.)
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const list = document.createElement(ordered ? 'ol' : 'ul');
      while (
        i < lines.length &&
        (ordered ? /^\s*\d+\.\s+/.test(lines[i]) : /^\s*[-*]\s+/.test(lines[i]))
      ) {
        const text = lines[i].replace(/^\s*(?:\d+\.|[-*])\s+/, '');
        const li = document.createElement('li');
        li.append(...renderInline(text));
        list.appendChild(li);
        i++;
      }
      root.appendChild(list);
      continue;
    }

    // Blank line → paragraph break (skip).
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Plain paragraph: gather consecutive non-empty, non-special lines.
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,3})\s/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !lines[i].startsWith('> ') &&
      !isTableHeader(lines[i], lines[i + 1])
    ) {
      buf.push(lines[i]);
      i++;
    }
    if (buf.length > 0) {
      const p = document.createElement('p');
      p.append(...renderInline(buf.join(' ')));
      root.appendChild(p);
    }
  }

  if (opts.search && opts.search.trim()) {
    highlightSearch(root, opts.search.trim());
  }
  return root;
}

// ---------- inline ----------

function renderInline(text: string): Node[] {
  // Process in a single pass: walk the string and emit text nodes / elements.
  const out: Node[] = [];
  let i = 0;
  const len = text.length;
  let buf = '';
  const flush = () => {
    if (buf) { out.push(document.createTextNode(buf)); buf = ''; }
  };

  while (i < len) {
    const c = text[i];
    // Inline code (kbd).
    if (c === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i) {
        flush();
        const k = document.createElement('kbd');
        k.textContent = text.slice(i + 1, end);
        out.push(k);
        i = end + 1;
        continue;
      }
    }
    // Bold: **x**.
    if (c === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end > i + 1) {
        flush();
        const s = document.createElement('strong');
        s.append(...renderInline(text.slice(i + 2, end)));
        out.push(s);
        i = end + 2;
        continue;
      }
    }
    // Italic: *x*.
    if (c === '*') {
      const end = text.indexOf('*', i + 1);
      if (end > i) {
        flush();
        const e = document.createElement('em');
        e.append(...renderInline(text.slice(i + 1, end)));
        out.push(e);
        i = end + 1;
        continue;
      }
    }
    // Link: [text](url).
    if (c === '[') {
      const close = text.indexOf(']', i + 1);
      if (close > i && text[close + 1] === '(') {
        const urlEnd = text.indexOf(')', close + 2);
        if (urlEnd > close + 1) {
          flush();
          const a = document.createElement('a');
          a.href = text.slice(close + 2, urlEnd);
          a.textContent = text.slice(i + 1, close);
          a.target = '_blank';
          a.rel = 'noopener';
          out.push(a);
          i = urlEnd + 1;
          continue;
        }
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

// ---------- tables ----------

function isTableHeader(line: string, next: string | undefined): boolean {
  if (!line || !next) return false;
  if (!line.includes('|')) return false;
  return /^\s*\|?\s*:?-{2,}/.test(next.trim()) || /\|\s*-{2,}\s*\|/.test(next);
}

function parseTable(lines: string[], start: number): { node: HTMLElement; consumed: number } {
  const tbl = document.createElement('table');
  const head = document.createElement('thead');
  const body = document.createElement('tbody');
  const headerCells = splitRow(lines[start]);
  const tr = document.createElement('tr');
  for (const c of headerCells) {
    const th = document.createElement('th');
    th.append(...renderInline(c));
    tr.appendChild(th);
  }
  head.appendChild(tr);
  tbl.appendChild(head);

  let i = start + 2; // skip header + separator
  while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
    const cells = splitRow(lines[i]);
    const row = document.createElement('tr');
    for (const c of cells) {
      const td = document.createElement('td');
      td.append(...renderInline(c));
      row.appendChild(td);
    }
    body.appendChild(row);
    i++;
  }
  tbl.appendChild(body);
  return { node: tbl, consumed: i - start };
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

// ---------- search highlight ----------

function highlightSearch(root: HTMLElement, query: string): void {
  const q = query.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if ((node.textContent ?? '').toLowerCase().includes(q)) {
      targets.push(node as Text);
    }
  }
  for (const t of targets) {
    const text = t.textContent ?? '';
    const lower = text.toLowerCase();
    let idx = lower.indexOf(q);
    if (idx < 0) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    while (idx >= 0) {
      if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
      const m = document.createElement('mark');
      m.textContent = text.slice(idx, idx + q.length);
      frag.appendChild(m);
      last = idx + q.length;
      idx = lower.indexOf(q, last);
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    t.replaceWith(frag);
  }
}
