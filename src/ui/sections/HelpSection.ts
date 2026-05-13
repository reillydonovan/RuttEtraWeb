/**
 * In-app manual rendered as a sub-tabbed section under the third top-level
 * "help" tab. Each sub-tab is a markdown page; the Controls tab also has a
 * search input for live filtering.
 */

import { Settings, SettingsStore } from '../../state/Settings';
import { HELP_TABS, generateControlsMarkdown } from '../help/content';
import { renderMarkdown } from '../help/markdown';

export function createHelpSection(settings: SettingsStore): HTMLElement {
  const root = document.createElement('div');

  // Sub-tab strip.
  const strip = document.createElement('div');
  strip.className = 'rw-help-subtabs';
  root.appendChild(strip);

  // Body.
  const body = document.createElement('div');
  body.className = 'rw-help-body';
  root.appendChild(body);

  let activeId: Settings['helpActiveTab'] = settings.get('helpActiveTab');
  let searchTerm = '';

  const buttons: Record<string, HTMLButtonElement> = {};

  for (const t of HELP_TABS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rw-help-subtab';
    btn.textContent = t.label;
    btn.addEventListener('click', () => {
      activeId = t.id as Settings['helpActiveTab'];
      settings.set('helpActiveTab', activeId);
      render();
    });
    buttons[t.id] = btn;
    strip.appendChild(btn);
  }

  function render(): void {
    // Highlight active sub-tab.
    for (const [id, btn] of Object.entries(buttons)) {
      btn.classList.toggle('active', id === activeId);
    }

    body.innerHTML = '';

    const tab = HELP_TABS.find((t) => t.id === activeId) ?? HELP_TABS[0];

    // Controls tab gets a search input + Quickstart gets the auto-open toggle.
    if (tab.id === 'controls') {
      const search = document.createElement('input');
      search.type = 'search';
      search.placeholder = 'Search controls...';
      search.className = 'rw-help-search';
      search.value = searchTerm;
      search.addEventListener('input', () => {
        searchTerm = search.value;
        renderControlsBody();
        search.focus();
      });
      body.appendChild(search);

      const md = document.createElement('div');
      body.appendChild(md);

      function renderControlsBody(): void {
        md.innerHTML = '';
        md.appendChild(renderMarkdown(generateControlsMarkdown(searchTerm), { search: searchTerm }));
      }
      renderControlsBody();
      return;
    }

    const text = typeof tab.markdown === 'function' ? tab.markdown() : tab.markdown;
    body.appendChild(renderMarkdown(text));

    if (tab.id === 'quickstart') {
      const footer = document.createElement('div');
      footer.style.marginTop = '12px';
      footer.style.paddingTop = '8px';
      footer.style.borderTop = '1px dashed var(--re-line)';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = 'rw-help-noauto';
      cb.checked = !settings.get('helpAutoOpen');
      cb.addEventListener('change', () => {
        settings.set('helpAutoOpen', !cb.checked);
      });
      const lbl = document.createElement('label');
      lbl.htmlFor = 'rw-help-noauto';
      lbl.style.fontSize = '12px';
      lbl.style.color = 'var(--re-text-dim)';
      lbl.style.marginLeft = '6px';
      lbl.textContent = `Don't auto-open this manual on first run`;
      footer.append(cb, lbl);
      body.appendChild(footer);
    }
  }

  // Refresh body when settings change the helpActiveTab elsewhere (e.g. main.ts).
  settings.subscribe('helpActiveTab', (v) => {
    if (v === activeId) return;
    activeId = v;
    render();
  });

  render();
  return root;
}
