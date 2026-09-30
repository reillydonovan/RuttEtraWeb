/**
 * Entry point for `about.html` — the long-form Rutt/Etra manual.
 *
 * This is the OPPOSITE of `src/main.ts` in scope: it loads no synth
 * code, no three.js, no Web Audio, no settings store. It assembles
 * static documentation only. Any import added here MUST be either
 * pure data (no side effects beyond Map population) or a string of
 * pre-rendered HTML emitted by the build-time markdown plugin.
 *
 * Bundle: ~54KB total (HTML + CSS + JS) gzipped as of the sidebar TOC
 * (was ~26KB before it) — still well under a second on 4G. The page
 * loads independently of the synth state at index.html; visiting it
 * leaves that untouched (different page, different scope, but the
 * same `localStorage` content since it's the same origin).
 *
 * What this file does, in order:
 *   1. Inject each markdown-rendered section into the document.
 *   2. Append two AUTO-GENERATED sections (Param Reference, Node
 *      Catalog) built from the same source-of-truth maps used by the
 *      in-app Help, so the manual can never drift from the code.
 *   3. Build the sidebar TOC's nested sub-headings (h3/h4 within each
 *      section) from the live DOM, wire every link's smooth-scroll
 *      click handler, and run a scrollspy that highlights wherever
 *      you're currently reading — top-level AND nested.
 *   4. Wire the search input (heading-level index + results dropdown;
 *      Enter / click jumps to the matched heading).
 *   5. Wire the hamburger toggle that opens the sidebar as an
 *      off-canvas drawer on narrow viewports.
 */

// Self-hosted fonts — static CSS + font files, no synth runtime.
import '@fontsource/vt323';
import '@fontsource/share-tech-mono';
import './about.css';

// Markdown sections — pre-rendered HTML strings emitted by the
// `aboutMarkdown` Vite plugin (see vite.config.ts). Each import yields
// a `<section id="...">...</section>` wrapper with the id derived from
// the filename.
import introHtml         from '../../docs/about/01-intro.md?aboutMd';
import principlesHtml    from '../../docs/about/02-design-principles.md?aboutMd';
import quickStartHtml    from '../../docs/about/03-quick-start.md?aboutMd';
import synthesisHtml     from '../../docs/about/04-synthesis.md?aboutMd';
import modulationHtml    from '../../docs/about/05-modulation.md?aboutMd';
import ioHtml            from '../../docs/about/06-io.md?aboutMd';
import performanceHtml   from '../../docs/about/07-performance.md?aboutMd';
import referenceHtml     from '../../docs/about/08-reference.md?aboutMd';
import aboutHtml         from '../../docs/about/09-about.md?aboutMd';
import tutorialsHtml     from '../../docs/about/10-tutorials.md?aboutMd';

// Build the auto-generated tables. These import pure-data modules:
//   - paramDocs (settings descriptions) is a plain object literal
//   - the graph node registry is a Map populated by side-effect-free
//     `register(...)` calls; no synth runtime, no DOM access.
import { buildParamReferenceHtml, buildNodeCatalogHtml } from './autogen';

const SECTIONS: { html: string; injectAfter?: 'reference' }[] = [
  { html: introHtml },
  { html: principlesHtml },
  { html: quickStartHtml },
  { html: synthesisHtml },
  { html: modulationHtml },
  { html: ioHtml },
  { html: performanceHtml },
  { html: referenceHtml },
  { html: tutorialsHtml },
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
// Sidebar TOC: nested h3/h4 sub-headings, smooth-scroll links,
// scrollspy highlighting.
//
// The 9 top-level links are hand-authored in about.html (one per
// markdown file, matching the section id the `aboutMarkdown` build
// plugin derives from the filename). Everything below THAT is built
// here, once, from the live DOM after the sections mount — so a new
// `###`/`####` heading in any docs/about/*.md file just shows up on
// the next load with no TOC upkeep required.
// =====================================================================

const NAV_OFFSET = 8; // small breathing room; see --about-scroll-offset in about.css

function scrollToHash(hash: string): void {
  if (!hash || hash === '#') return;
  const target = document.querySelector(hash) as HTMLElement | null;
  if (!target) return;
  const top = target.getBoundingClientRect().top + window.scrollY - NAV_OFFSET;
  window.scrollTo({ top, behavior: 'smooth' });
}

const tocNav = document.getElementById('about-toc') as HTMLElement;
const topLinks = Array.from(tocNav.querySelectorAll<HTMLAnchorElement>(':scope > a'));

// Nest each section's own h3/h4 sub-headings under its top-level link.
// Deliberately EXCLUDES the auto-generated Param Reference / Node
// Catalog sub-content (`.about-subhead` category headers, and the
// per-node-type `<h4>`s inside `.about-node` cards) — indexing those
// individually would bury the real manual's headings under ~60 param
// and node names. That content is still fully searchable; it just
// isn't a TOC entry.
const usedIds = new Set<string>(); // avoids clobbering existing ids (e.g. section ids)
function slugify(s: string): string {
  const base = s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
  let id = base;
  let n = 1;
  while (usedIds.has(id) || document.getElementById(id)) id = `${base}-${++n}`;
  usedIds.add(id);
  return id;
}

/** Sub-link -> the top-level link it's nested under (for scrollspy). */
const subLinkOwner = new Map<HTMLAnchorElement, HTMLAnchorElement>();

for (const topLink of topLinks) {
  const href = topLink.getAttribute('href') ?? '';
  const section = href ? doc.querySelector(href) : null;
  if (!section) continue;
  const heads = section.querySelectorAll<HTMLElement>('h3:not(.about-subhead), h4:not(.about-subhead)');
  const subNav = document.createElement('div');
  subNav.className = 'about-toc-sub';
  let any = false;
  for (const h of Array.from(heads)) {
    if (h.closest('.about-node')) continue; // per-node-type h4 (Node Catalog)
    if (!h.id) h.id = slugify(h.textContent ?? '');
    const a = document.createElement('a');
    a.href = `#${h.id}`;
    a.textContent = h.textContent ?? '';
    a.className = h.tagName === 'H4' ? 'about-toc-l2' : 'about-toc-l1';
    subNav.appendChild(a);
    subLinkOwner.set(a, topLink);
    any = true;
  }
  if (any) topLink.insertAdjacentElement('afterend', subNav);
}

// Click handling for every link in the sidebar — top-level and nested.
tocNav.querySelectorAll<HTMLAnchorElement>('a').forEach((a) => {
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
// `about.html#modulation` or `about.html#automation-lanes` URLs land
// on the right heading, section or sub-heading alike).
if (window.location.hash) {
  // Defer a tick so the section heights have settled.
  requestAnimationFrame(() => scrollToHash(window.location.hash));
}

// Scrollspy: highlight whichever heading is currently being read, in
// both its own sidebar link and (if it's a sub-heading) the owning
// top-level link, so you always know where you are in a long page.
interface SpyTarget { el: HTMLElement; link: HTMLAnchorElement; owner: HTMLAnchorElement }
const spyTargets: SpyTarget[] = [];
for (const topLink of topLinks) {
  const href = topLink.getAttribute('href') ?? '';
  const section = href ? (doc.querySelector(href) as HTMLElement | null) : null;
  if (section) spyTargets.push({ el: section, link: topLink, owner: topLink });
}
tocNav.querySelectorAll<HTMLAnchorElement>('.about-toc-l1, .about-toc-l2').forEach((a) => {
  const href = a.getAttribute('href') ?? '';
  const el = href ? document.getElementById(href.slice(1)) : null;
  const owner = subLinkOwner.get(a);
  if (el && owner) spyTargets.push({ el, link: a, owner });
});
// Document order matters for the "last one above the threshold wins"
// scan in updateSpy() below.
spyTargets.sort((a, b) => {
  const pos = a.el.compareDocumentPosition(b.el);
  if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
});

function updateSpy(): void {
  const threshold = window.scrollY + 96; // a bit below the viewport top
  let current: SpyTarget | null = null;
  for (const t of spyTargets) {
    if (t.el.getBoundingClientRect().top + window.scrollY <= threshold) current = t;
    else break;
  }
  for (const t of spyTargets) {
    t.link.classList.toggle('about-toc-active', t === current);
    t.link.classList.toggle('about-toc-section-active', current != null && t.owner === current.owner);
  }
}
let spyRaf = 0;
window.addEventListener('scroll', () => {
  cancelAnimationFrame(spyRaf);
  spyRaf = requestAnimationFrame(updateSpy);
}, { passive: true });
updateSpy();

// =====================================================================
// Search — heading-level index + results dropdown
//
// The previous implementation filtered whole <section>s and scrolled
// to the first match. With only nine huge sections, almost any query
// matched section 1 (Intro), so every search appeared to "jump to the
// top and do nothing". This version indexes each heading (h1–h4) plus
// the prose under it, shows a ranked dropdown of matches with
// highlighted snippets, and jumps to the exact heading on selection.
// =====================================================================

interface SearchEntry {
  heading: HTMLElement;      // scroll target
  title: string;             // heading text
  trail: string;             // "Section › Heading" breadcrumb
  body: string;              // prose under the heading (until next heading)
  haystack: string;          // lowercased title + body, for matching
}

const search = document.getElementById('about-search') as HTMLInputElement | null;
const sidebarHead = document.getElementById('about-sidebar-head');
if (search && sidebarHead) {
  const MAX_RESULTS = 12;
  const SNIPPET_RADIUS = 60; // chars of context either side of the match

  // Results dropdown lives in the sidebar head so it anchors under the input.
  const resultsEl = document.createElement('div');
  resultsEl.id = 'about-search-results';
  resultsEl.setAttribute('role', 'listbox');
  resultsEl.hidden = true;
  sidebarHead.appendChild(resultsEl);

  // Build the index lazily on first keystroke — the doc is static
  // after mount, so one build is enough.
  let index: SearchEntry[] | null = null;
  const buildIndex = (): SearchEntry[] => {
    const entries: SearchEntry[] = [];
    for (const sec of doc.querySelectorAll<HTMLElement>('section.about-section')) {
      const headings = sec.querySelectorAll<HTMLElement>('h1, h2, h3, h4');
      const sectionTitle = headings[0]?.textContent?.trim() ?? sec.id;
      for (const h of headings) {
        // Collect the prose between this heading and the next one.
        let body = '';
        for (let el = h.nextElementSibling; el; el = el.nextElementSibling) {
          if (/^H[1-4]$/.test(el.tagName)) break;
          body += ' ' + (el.textContent ?? '');
        }
        const title = h.textContent?.trim() ?? '';
        entries.push({
          heading: h,
          title,
          trail: h === headings[0] ? title : `${sectionTitle} › ${title}`,
          body: body.replace(/\s+/g, ' ').trim(),
          haystack: (title + ' ' + body).replace(/\s+/g, ' ').toLowerCase(),
        });
      }
    }
    return entries;
  };

  let matches: SearchEntry[] = [];
  let active = -1; // keyboard-highlighted result index

  const closeResults = (): void => {
    resultsEl.hidden = true;
    resultsEl.replaceChildren();
    matches = [];
    active = -1;
  };

  const jumpTo = (entry: SearchEntry): void => {
    closeResults();
    const top = entry.heading.getBoundingClientRect().top + window.scrollY - NAV_OFFSET - 8;
    window.scrollTo({ top, behavior: 'smooth' });
    // Brief phosphor flash so the eye lands on the right heading.
    entry.heading.classList.remove('about-flash');
    // Force a reflow so re-adding the class restarts the animation.
    void entry.heading.offsetWidth;
    entry.heading.classList.add('about-flash');
  };

  // Snippet with the matched term wrapped in <mark>, built via
  // textContent (never innerHTML on doc text) so content can't inject
  // markup into the dropdown.
  const buildSnippet = (entry: SearchEntry, needle: string): HTMLElement => {
    const snip = document.createElement('div');
    snip.className = 'about-result-snippet';
    const at = entry.body.toLowerCase().indexOf(needle);
    if (at < 0) {
      snip.textContent = entry.body.slice(0, SNIPPET_RADIUS * 2);
      return snip;
    }
    const start = Math.max(0, at - SNIPPET_RADIUS);
    const end = Math.min(entry.body.length, at + needle.length + SNIPPET_RADIUS);
    if (start > 0) snip.appendChild(document.createTextNode('…' + entry.body.slice(start, at)));
    else snip.appendChild(document.createTextNode(entry.body.slice(0, at)));
    const mark = document.createElement('mark');
    mark.textContent = entry.body.slice(at, at + needle.length);
    snip.appendChild(mark);
    snip.appendChild(document.createTextNode(entry.body.slice(at + needle.length, end) + (end < entry.body.length ? '…' : '')));
    return snip;
  };

  const setActive = (i: number): void => {
    active = i;
    resultsEl.querySelectorAll('.about-result').forEach((el, idx) => {
      el.classList.toggle('about-result-active', idx === i);
      if (idx === i) el.scrollIntoView({ block: 'nearest' });
    });
  };

  const apply = (q: string): void => {
    if (!index) index = buildIndex();
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) { closeResults(); return; }

    // Every whitespace-separated term must appear; title hits rank
    // above body-only hits, document order breaks ties.
    const terms = needle.split(/\s+/);
    const titleHits: SearchEntry[] = [];
    const bodyHits: SearchEntry[] = [];
    for (const entry of index) {
      if (!terms.every((t) => entry.haystack.includes(t))) continue;
      if (terms.some((t) => entry.title.toLowerCase().includes(t))) titleHits.push(entry);
      else bodyHits.push(entry);
    }
    matches = [...titleHits, ...bodyHits].slice(0, MAX_RESULTS);
    active = -1;
    resultsEl.replaceChildren();

    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'about-result-empty';
      empty.textContent = 'no matches';
      resultsEl.appendChild(empty);
      resultsEl.hidden = false;
      return;
    }

    matches.forEach((entry, i) => {
      const item = document.createElement('div');
      item.className = 'about-result';
      item.setAttribute('role', 'option');
      const trail = document.createElement('div');
      trail.className = 'about-result-trail';
      trail.textContent = entry.trail;
      item.appendChild(trail);
      item.appendChild(buildSnippet(entry, terms[0]));
      // mousedown (not click) so the jump wins over the input's blur.
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        jumpTo(entry);
      });
      item.addEventListener('mousemove', () => setActive(i));
      resultsEl.appendChild(item);
    });
    resultsEl.hidden = false;
  };

  let raf = 0;
  search.addEventListener('input', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => apply(search.value));
  });
  search.addEventListener('focus', () => {
    if (search.value.trim().length >= 2) apply(search.value);
  });
  search.addEventListener('blur', () => {
    // Delay so a result mousedown lands before the list disappears.
    setTimeout(closeResults, 120);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      search.value = '';
      closeResults();
      search.blur();
    } else if (e.key === 'ArrowDown' && matches.length) {
      e.preventDefault();
      setActive(Math.min(active + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp' && matches.length) {
      e.preventDefault();
      setActive(Math.max(active - 1, 0));
    } else if (e.key === 'Enter' && matches.length) {
      e.preventDefault();
      jumpTo(matches[Math.max(active, 0)]);
    }
  });
}

// =====================================================================
// Mobile sidebar drawer (hamburger toggle + dim backdrop)
// =====================================================================

const tocToggle = document.getElementById('about-toc-toggle');
const sidebarEl = document.getElementById('about-sidebar');
const backdropEl = document.getElementById('about-toc-backdrop');
function closeMobileToc(): void {
  sidebarEl?.classList.remove('about-toc-open');
  backdropEl?.classList.remove('about-toc-open');
  tocToggle?.setAttribute('aria-expanded', 'false');
}
if (tocToggle && sidebarEl) {
  tocToggle.setAttribute('aria-expanded', 'false');
  tocToggle.addEventListener('click', () => {
    const open = sidebarEl.classList.toggle('about-toc-open');
    backdropEl?.classList.toggle('about-toc-open', open);
    tocToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  // Tapping the dim backdrop closes the drawer (mobile only — on
  // desktop the sidebar is always visible inline, so this is inert).
  backdropEl?.addEventListener('click', closeMobileToc);
}
