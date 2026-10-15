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
  // First run used to switch the panel to Help → Quick start. The owner
  // wants Controls to land on Synth every time (2026-10-15); the first-run
  // pointer now is the Quick start tab being pre-selected for whenever the
  // user opens Help, plus the boot screen and Help ▸ Start Tutorial.
  if (!settings.get('helpSeen') && settings.get('helpAutoOpen')) {
    settings.set('helpActiveTab', 'quickstart');
  }
  // Mark as seen the first time the user navigates AWAY from the help tab.
  // `let` + a deferred off: subscribe() may call back synchronously (now that
  // the panel starts on Synth, it does), before `off` would exist as a const.
  let off: (() => void) | null = null;
  let done = false;
  off = settings.subscribe('panelTab', (v) => {
    if (done || !v || v === 'help') return;
    done = true;
    settings.set('helpSeen', true);
    if (off) off(); else queueMicrotask(() => off?.());
  });
}
