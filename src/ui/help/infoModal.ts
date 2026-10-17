/**
 * The ⓘ info button + its modal (see infoContent.ts for the text).
 *
 * The button swallows pointerdown/click so it never starts a section
 * collapse, a module drag or a Patch Bay pan. The modal is built in the
 * button's own document, so it works in popout windows too; it closes
 * on ✕, Esc, or a click outside the card.
 */

import './infoModal.css';
import './flow.css';
import type { InfoContent } from './infoContent';
import { flowSvg } from './flowSvg';
import { infoMedia } from './infoMedia';

let openClose: (() => void) | null = null;

export function closeInfoModal(): void { openClose?.(); }

export function openInfoModal(doc: Document, info: InfoContent): HTMLElement {
  closeInfoModal();
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const overlay = el('div', 'rw-info-modal');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', info.title);
  const card = el('div', 'rw-info-card');
  overlay.appendChild(card);

  const head = el('div', 'rw-info-head');
  const titles = el('div');
  if (info.kicker) titles.appendChild(el('div', 'rw-info-kicker', info.kicker));
  titles.appendChild(el('div', 'rw-info-title', info.title));
  const close = el('button', 'rw-info-close rw-x', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  head.append(titles, close);
  card.appendChild(head);

  const body = el('div', 'rw-info-body');
  card.appendChild(body);
  if (info.summary) body.appendChild(el('p', 'rw-info-summary', info.summary));

  // The picture / clip that SHOWS this unit (owner: "GUI support for a GUI" — text is the
  // supporting act). Looked up in public/info/manifest.json by key; absent = no figure.
  if (info.mediaKey) void attachMedia(doc, body, card, info.mediaKey);

  // Live signal flow: what's plugged in (left) and where it goes (right).
  const svg = info.flow ? flowSvg(info.flow) : '';
  if (svg) {
    body.appendChild(el('div', 'rw-info-h', 'Signal flow · live'));
    const fig = el('div', 'rw-info-flow');
    fig.innerHTML = svg; // flowSvg escapes every piece of text it emits
    body.appendChild(fig);
  } else if (info.flow?.unpatched) {
    body.appendChild(el('div', 'rw-info-h', 'Signal flow · live'));
    body.appendChild(el('p', 'rw-info-flow-none', 'Nothing is patched here yet — drag from an output into one of its IN jacks.'));
  }

  if (info.tips.length) {
    body.appendChild(el('div', 'rw-info-h', 'How to use it'));
    const ul = el('ul', 'rw-info-tips');
    for (const t of info.tips) ul.appendChild(el('li', undefined, t));
    body.appendChild(ul);
  }

  for (const s of info.sections) {
    body.appendChild(el('div', 'rw-info-h', s.heading));
    const dl = el('dl', 'rw-info-rows');
    for (const r of s.rows) {
      const dt = el('dt');
      dt.appendChild(el('span', 'rw-info-name', r.name));
      if (r.detail) dt.appendChild(el('span', 'rw-info-detail', r.detail));
      dl.appendChild(dt);
      if (r.text) dl.appendChild(el('dd', undefined, r.text));
    }
    body.appendChild(dl);
  }

  if (info.aboutHash) {
    const a = el('a', 'rw-info-more', 'Read more in the manual →');
    a.href = `about.html#${info.aboutHash}`;
    a.target = '_blank';
    a.rel = 'noopener';
    body.appendChild(a);
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); }
  };
  const done = (): void => {
    doc.removeEventListener('keydown', onKey, true);
    overlay.remove();
    if (openClose === done) openClose = null;
  };
  openClose = done;
  close.addEventListener('click', done);
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) done(); });
  doc.addEventListener('keydown', onKey, true);
  doc.body.appendChild(overlay);
  close.focus({ preventScroll: true });
  return overlay;
}

/** A small ⓘ button that opens the modal built by `getInfo` (read lazily at click). */
export function infoButton(getInfo: () => InfoContent, label = 'About this module'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'rw-info-btn';
  b.textContent = 'i';
  b.setAttribute('aria-label', label);
  const stop = (e: Event): void => { e.stopPropagation(); };
  b.addEventListener('pointerdown', stop);
  b.addEventListener('mousedown', stop);
  b.addEventListener('dblclick', stop);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    openInfoModal(b.ownerDocument, getInfo());
  });
  return b;
}


/** Insert the unit's figure (looping clip and/or a screenshot of the controls) right under the summary. */
async function attachMedia(doc: Document, body: HTMLElement, card: HTMLElement, key: string): Promise<void> {
  const m = await infoMedia(key);
  if (!m || (!m.clip && !m.shot)) return;
  const fig = doc.createElement('figure');
  fig.className = 'rw-info-media' + (m.clip && m.shot ? ' two' : '');
  const add = (node: HTMLElement, caption: string | undefined): void => {
    const cell = doc.createElement('div');
    cell.className = 'rw-info-media-cell';
    cell.appendChild(node);
    if (caption) { const c = doc.createElement('figcaption'); c.textContent = caption; cell.appendChild(c); }
    fig.appendChild(cell);
  };
  if (m.clip) {
    const v = doc.createElement('video');
    v.src = m.clip; v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true; v.controls = false;
    v.setAttribute('aria-label', m.caption ?? 'Demonstration');
    v.addEventListener('error', () => v.closest('.rw-info-media-cell')?.remove());
    void v.play().catch(() => { /* autoplay blocked: the first frame still shows */ });
    add(v, m.caption);
  }
  if (m.shot) {
    const i = doc.createElement('img');
    i.src = m.shot; i.alt = m.shotCaption ?? 'The controls'; i.decoding = 'async';
    i.addEventListener('error', () => i.closest('.rw-info-media-cell')?.remove());
    // A wide strip (e.g. the timeline dock) is unreadable at half width: stack it full width.
    i.addEventListener('load', () => { if (i.naturalWidth > 2.2 * i.naturalHeight) fig.classList.remove('two'); });
    add(i, m.shotCaption);
  }
  card.classList.add('has-media');
  const first = body.querySelector('.rw-info-summary');
  if (first?.nextSibling) body.insertBefore(fig, first.nextSibling); else body.prepend(fig);
}
