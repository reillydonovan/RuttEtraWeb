/**
 * First-run auto-open helper for the Help tab.
 *
 * The previously-floating "?" button has been retired — desktop users open
 * the Help tab in the control panel; compact (mobile) users tap the "?"
 * button in the top strip, which opens a dedicated help sheet.
 */

import { SettingsStore } from '../../state/Settings';

/** Compatibility no-op. The standalone help FAB has been removed. */
export function mountHelpFab(_settings: SettingsStore): void {
  // Intentionally empty. Kept exported so existing dynamic-import call sites
  // continue to work without further plumbing.
  void _settings;
  document.getElementById('help-fab')?.remove();
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
