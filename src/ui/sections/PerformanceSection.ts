/**
 * Performance section — exposes the per-mode profile selector + render-scale
 * slider + haptics/wake-lock toggles. Lives under the "More" tab on compact,
 * the "Synth" tab on desktop.
 */

import { PerformanceProfileId, SettingsStore } from '../../state/Settings';
import { layoutManager } from '../layout/LayoutManager';
import { row, group, slider, toggle } from '../widgets';

export interface PerformanceSectionDeps {
  /** Called when user changes the active mode's profile. */
  onProfileChange: (mode: 'compact'|'standard'|'expansive', id: PerformanceProfileId) => void;
}

export function createPerformanceSection(settings: SettingsStore, deps: PerformanceSectionDeps): HTMLElement {
  const root = document.createElement('div');

  const profGroup = group('Performance Profile');
  const layout = layoutManager();

  const PROFILES: { v: PerformanceProfileId; l: string }[] = [
    { v: 'quality',  l: 'Quality (high)' },
    { v: 'balanced', l: 'Balanced (default)' },
    { v: 'battery',  l: 'Battery (mobile)' },
  ];

  for (const mode of ['compact','standard','expansive'] as const) {
    const sel = document.createElement('select');
    sel.className = 'rw-select';
    for (const p of PROFILES) {
      const opt = document.createElement('option');
      opt.value = p.v; opt.textContent = p.l;
      sel.appendChild(opt);
    }
    sel.value = settings.get('performanceProfile')[mode];
    sel.addEventListener('change', () => {
      const id = sel.value as PerformanceProfileId;
      const cur = settings.get('performanceProfile');
      settings.set('performanceProfile', { ...cur, [mode]: id });
      deps.onProfileChange(mode, id);
    });
    settings.subscribe('performanceProfile', (v) => { sel.value = v[mode]; });
    profGroup.body.appendChild(row(`${mode[0].toUpperCase()}${mode.slice(1)}`, sel));
  }
  root.appendChild(profGroup.root);

  const rsGroup = group('Render Scale');
  rsGroup.body.append(
    row('Scale', slider(settings, 'renderScale', 0.5, 1.5, 0.05)),
  );
  const hint = document.createElement('div');
  hint.className = 'rw-hint';
  hint.textContent = `Lower for better fps on this device. (Current mode: ${layout.current()})`;
  rsGroup.body.appendChild(hint);
  root.appendChild(rsGroup.root);

  const tg = group('Device');
  tg.body.append(
    row('Haptics on hits',  toggle(settings, 'hapticsEnabled')),
    row('Wake lock',        toggle(settings, 'wakeLockOnRecord')),
  );
  root.appendChild(tg.root);

  return root;
}
