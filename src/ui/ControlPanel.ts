/**
 * The collapsible side panel that hosts every control section.
 *
 * Sections are added via `addSection(title, content)` and rendered as
 * a vertical accordion. The panel itself can dock left or right and
 * collapse to a thin strip — useful when recording or streaming so the
 * UI doesn't compete with the canvas.
 */

import './panel.css';
import { SettingsStore } from '../state/Settings';

export interface PanelSection {
  title: string;
  body: HTMLElement;
  initiallyOpen?: boolean;
}

export class ControlPanel {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private collapsed = false;

  constructor(host: HTMLElement, private settings: SettingsStore) {
    this.root = host;
    this.root.setAttribute('data-dock', settings.get('panelDock'));
    if (settings.get('panelCollapsed')) this.root.classList.add('collapsed');

    const title = document.createElement('div');
    title.className = 'rw-panel-title';

    const titleText = document.createElement('div');
    titleText.className = 'rw-panel-title-text';
    titleText.textContent = 'RUTT/ETRA';
    title.appendChild(titleText);

    const actions = document.createElement('div');
    actions.className = 'rw-panel-actions';

    const dockBtn = document.createElement('button');
    dockBtn.title = 'Toggle dock side';
    dockBtn.textContent = '↔';
    dockBtn.addEventListener('click', () => {
      const next = settings.get('panelDock') === 'right' ? 'left' : 'right';
      settings.set('panelDock', next);
    });
    settings.subscribe('panelDock', (v) => this.root.setAttribute('data-dock', v));

    const collapseBtn = document.createElement('button');
    collapseBtn.title = 'Collapse panel';
    collapseBtn.textContent = '–';
    collapseBtn.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.root.classList.toggle('collapsed', this.collapsed);
      settings.set('panelCollapsed', this.collapsed);
      collapseBtn.textContent = this.collapsed ? '+' : '–';
    });
    settings.subscribe('panelCollapsed', (v) => {
      this.collapsed = !!v;
      this.root.classList.toggle('collapsed', this.collapsed);
      collapseBtn.textContent = this.collapsed ? '+' : '–';
    });

    actions.append(dockBtn, collapseBtn);
    title.appendChild(actions);

    const body = document.createElement('div');
    body.className = 'rw-panel-body';
    this.body = body;

    this.root.append(title, body);
  }

  addSection(section: PanelSection): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'rw-section';
    if (!section.initiallyOpen) wrap.classList.add('collapsed');

    const head = document.createElement('div');
    head.className = 'rw-section-head';
    const titleSpan = document.createElement('span');
    titleSpan.textContent = section.title;
    const chev = document.createElement('span');
    chev.className = 'rw-chev';
    chev.textContent = '▾';
    head.append(titleSpan, chev);

    const body = document.createElement('div');
    body.className = 'rw-section-body';
    body.appendChild(section.body);

    head.addEventListener('click', () => wrap.classList.toggle('collapsed'));

    wrap.append(head, body);
    this.body.appendChild(wrap);
    return wrap;
  }
}
