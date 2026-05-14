/**
 * Entry point for `about.html` — the long-form Rutt/Etra manual.
 *
 * This is the OPPOSITE of `src/main.ts` in scope: it loads no synth
 * code, no three.js, no Web Audio, no settings store. It assembles
 * static documentation only. Any import added here MUST be either
 * pure data (no side effects beyond Map population) or a string of
 * pre-rendered HTML emitted by the build-time markdown plugin.
 *
 * Bundle goal: <50KB total (HTML + CSS + JS) gzipped. The page loads
 * in under a second on 4G; the synth state at index.html is left
 * completely untouched by visiting this page (different page,
 * different localStorage scope is unchanged because we never read or
 * write it from here).
 *
 * What this file does, in order:
 *   1. Inject each markdown-rendered section into the document.
 *   2. Append two AUTO-GENERATED sections (Param Reference, Node
 *      Catalog) built from the same source-of-truth maps used by the
 *      in-app Help, so the manual can never drift from the code.
 *   3. Wire the top-nav TOC links (smooth scroll + offset for the
 *      fixed nav).
 *   4. Wire the search input (substring match across section text,
 *      hides non-matching sections).
 *   5. Wire the hamburger toggle for mobile TOC.
 */

import './about.css';

// Markdown sections — pre-rendered HTML strings emitted by the
// `aboutMarkdown` Vite plugin (see vite.config.ts). Each import yields
// a `<section id="...">...</section>` wrapper with the id derived from
// the filename.
import introHtml         from '../../docs/about/01-intro.md?aboutMd';
import quickStartHtml    from '../../docs/about/02-quick-start.md?aboutMd';
import synthesisHtml     from '../../docs/about/03-synthesis.md?aboutMd';
import modulationHtml    from '../../docs/about/04-modulation.md?aboutMd';
import ioHtml            from '../../docs/about/05-io.md?aboutMd';
import performanceHtml   from '../../docs/about/06-performance.md?aboutMd';
import referenceHtml     from '../../docs/about/07-reference.md?aboutMd';
import aboutHtml         from '../../docs/about/08-about.md?aboutMd';

// Build the auto-generated tables. These import pure-data modules:
//   - paramDocs (settings descriptions) is a plain object literal
//   - the graph node registry is a Map populated by side-effect-free
//     `register(...)` calls; no synth runtime, no DOM access.
import { buildParamReferenceHtml, buildNodeCatalogHtml } from './autogen';

const SECTIONS: { html: string; injectAfter?: 'reference' }[] = [
  { html: introHtml },
  { html: quickStartHtml },
  { html: synthesisHtml },
  { html: modulationHtml },
  { html: ioHtml },
  { html: performanceHtml },
  { html: referenceHtml },
  { html: aboutHtml },
];

// =====================================================================
// Inject sections into the document
// =====================================================================

const doc = document.getElementById('about-doc');
if (!doc) throw new Error('about-doc element missing');

const fragment = document.createDocumentFragment();
const tmp = document.createElement('div');
for (const { html } of SECTIONS) {
  tmp.innerHTML = html;
  while (tmp.firstChild) fragment.appendChild(tmp.firstChild);
}
// Hoist the auto-generated bits INTO the Reference section so they
// appear under it rather than as siblings — the spec's TOC keeps
// "Reference" as one item.
doc.appendChild(fragment);

const referenceSection = doc.querySelector('#reference');
if (referenceSection) {
  // Append the auto-generated Param Reference + Node Catalog as
  // sub-blocks within the existing Reference section. They get their
  // own `<h2 id>` so they show up in the search index but don't
  // appear as top-level TOC entries.
  referenceSection.insertAdjacentHTML('beforeend', buildParamReferenceHtml());
  referenceSection.insertAdjacentHTML('beforeend', buildNodeCatalogHtml());
}

// =====================================================================
// TOC + smooth scroll w/ fixed-nav offset
// =====================================================================

const NAV_OFFSET = 56; // matches #about-nav height; keep in sync with about.css

function scrollToHash(hash: string): void {
  if (!hash || hash === '#') return;
  const target = document.querySelector(hash) as HTMLElement | null;
  if (!target) return;
  const top = target.getBoundingClientRect().top + window.scrollY - NAV_OFFSET - 8;
  window.scrollTo({ top, behavior: 'smooth' });
}

document.querySelectorAll<HTMLAnchorElement>('#about-toc a').forEach((a) => {
  a.addEventListener('click', (e) => {
    const href = a.getAttribute('href') ?? '';
    if (!href.startsWith('#')) return;
    e.preventDefault();
    history.replaceState(null, '', href);
    scrollToHash(href);
    closeMobileToc();
  });
});

// Honor a deep link in the URL hash on first paint (e.g. shared
// `about.html#modulation` URLs land on the Modulation section).
if (window.location.hash) {
  // Defer a tick so the section heights have settled.
  requestAnimationFrame(() => scrollToHash(window.location.hash));
}

// =====================================================================
// Search — filter sections by visible text
// =====================================================================

const search = document.getElementById('about-search') as HTMLInputElement | null;
if (search) {
  // Build a flat search index lazily on first input. Each entry is a
  // section element + its lowercased innerText. We rebuild only if
  // the doc changes, which it doesn't post-mount.
  let index: Array<{ el: HTMLElement; text: string }> | null = null;
  const buildIndex = (): void => {
    index = [];
    for (const sec of doc.querySelectorAll<HTMLElement>('section.about-section')) {
      index.push({ el: sec, text: sec.innerText.toLowerCase() });
    }
  };
  const apply = (q: string): void => {
    if (!index) buildIndex();
    const needle = q.trim().toLowerCase();
    if (!needle) {
      for (const { el } of index!) el.classList.remove('about-hidden');
      return;
    }
    let firstMatch: HTMLElement | null = null;
    for (const { el, text } of index!) {
      const hit = text.includes(needle);
      el.classList.toggle('about-hidden', !hit);
      if (hit && !firstMatch) firstMatch = el;
    }
    if (firstMatch) {
      const top = firstMatch.getBoundingClientRect().top + window.scrollY - NAV_OFFSET - 8;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  };
  let raf = 0;
  search.addEventListener('input', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => apply(search.value));
  });
  // Esc clears the filter.
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      search.value = '';
      apply('');
    }
  });
}

// =====================================================================
// Mobile TOC hamburger
// =====================================================================

const tocToggle = document.getElementById('about-toc-toggle');
const tocEl = document.getElementById('about-toc');
function closeMobileToc(): void {
  if (tocEl) tocEl.classList.remove('about-toc-open');
  if (tocToggle) tocToggle.setAttribute('aria-expanded', 'false');
}
if (tocToggle && tocEl) {
  tocToggle.setAttribute('aria-expanded', 'false');
  tocToggle.addEventListener('click', () => {
    const open = tocEl.classList.toggle('about-toc-open');
    tocToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  // Click outside to close (mobile only — on desktop the TOC is
  // always open inline, so this is a no-op there).
  document.addEventListener('click', (e) => {
    if (!tocEl.classList.contains('about-toc-open')) return;
    const target = e.target as HTMLElement;
    if (target === tocToggle || tocEl.contains(target)) return;
    closeMobileToc();
  });
}
