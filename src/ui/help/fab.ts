/**
 * Floating "?" Help button + first-run auto-open helper.
 *
 * The button lives at the bottom-left so it doesn't collide with the right-
 * docked panel or the timeline strip at the bottom. It's hidden in
 * `body.viewer-mode`.
 */

import { SettingsStore } from '../../state/Settings';

export function mountHelpFab(settings: SettingsStore): void {
  if (document.getElementById('help-fab')) return;
  const btn = document.createElement('button');
  btn.id = 'help-fab';
  btn.type = 'button';
  btn.textContent = '?';
  btn.title = 'Open help / manual';
  btn.addEventListener('click', () => {
    settings.set('panelTab', 'help');
    settings.set('panelCollapsed', false);
  });
  document.body.appendChild(btn);
}

export function maybeAutoOpenHelp(settings: SettingsStore): void {
  // First-run: open Help → Quick start automatically.
  if (!settings.get('helpSeen') && settings.get('helpAutoOpen')) {
    settings.set('panelTab', 'help');
    settings.set('helpActiveTab', 'quickstart');
    settings.set('panelCollapsed', false);
  }
  // Mark as seen the first time the user navigates AWAY from the help tab.
  const off = settings.subscribe('panelTab', (v) => {
    if (v && v !== 'help') {
      settings.set('helpSeen', true);
      off();
    }
  });
}
