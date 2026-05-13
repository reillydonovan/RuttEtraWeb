/**
 * OSC section UI.
 *
 * - Bridge URL text input + connect/disconnect buttons + status indicator.
 * - LearnBinding table for incoming OSC bindings (mirrors the MIDI section).
 * - "Copy TouchOSC layout" button that builds a JSON snippet listing one
 *   fader per binding and copies it to the clipboard.
 * - Inline link to the bridge README.
 */

import { OscBinding, SettingsStore } from '../../state/Settings';
import { OscClient } from '../../osc/OscClient';
import { row, group, button, textInput, toggle } from '../widgets';
import { createLearnTable } from '../widgets/LearnBinding';
import { TARGET_OPTIONS } from '../targets';

export function createOscSection(settings: SettingsStore, osc: OscClient): HTMLElement {
  const root = document.createElement('div');

  // Connection group
  const connGroup = group('Bridge');
  const urlInp = textInput(settings.get('oscBridgeUrl'), 'ws://localhost:8080');
  urlInp.addEventListener('change', () => settings.set('oscBridgeUrl', urlInp.value));
  connGroup.body.appendChild(row('URL', urlInp));

  const statusRow = document.createElement('div');
  statusRow.className = 'rw-status';
  const dot = document.createElement('span');
  dot.className = 'rw-status-dot';
  const txt = document.createElement('span');
  txt.textContent = 'idle';
  statusRow.append(dot, txt);
  connGroup.body.appendChild(statusRow);

  osc.subscribe((s) => {
    txt.textContent = s;
    dot.classList.toggle('on',   s === 'connected');
    dot.classList.toggle('warn', s === 'connecting');
    dot.classList.toggle('err',  s === 'error');
  });

  const btnRow = document.createElement('div');
  btnRow.className = 'rw-btn-row';
  btnRow.appendChild(button('Connect',    () => osc.connect(), 'primary'));
  btnRow.appendChild(button('Disconnect', () => osc.disconnect()));
  connGroup.body.appendChild(btnRow);

  connGroup.body.appendChild(row('Auto-connect on startup', toggle(settings, 'oscAutoConnect', '')));

  const readme = document.createElement('div');
  readme.className = 'rw-hint';
  readme.innerHTML = 'Run the bridge from <code>tools/osc-bridge/</code>. See its README for setup details.';
  connGroup.body.appendChild(readme);

  root.appendChild(connGroup.root);

  // Bindings
  const bindGroup = group('Bindings');
  const table = createLearnTable<OscBinding>({
    list: () => settings.get('oscBindings'),
    describeSource: (b) => `${b.address}[${b.argIndex}]`,
    learn: (target) => osc.learn(target),
    update: (id, patch) => osc.updateBinding(id, patch),
    remove: (id) => osc.removeBinding(id),
    isLearning: () => osc.isLearning(),
    cancelLearn: () => osc.cancelLearn(),
    subscribe: (fn) => settings.subscribe('oscBindings', fn),
    targetOptions: TARGET_OPTIONS,
  });
  bindGroup.body.appendChild(table);

  // TouchOSC layout export
  bindGroup.body.appendChild(button('Copy TouchOSC layout', async () => {
    const bindings = settings.get('oscBindings');
    const layout = {
      name: 'Rutt/Etra',
      faders: bindings.map((b) => ({
        address: b.address,
        type: 'fader',
        min: b.min,
        max: b.max,
      })),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(layout, null, 2));
    } catch {
      // Fallback for browsers without clipboard API: download instead.
      const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'touchosc-layout.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }));
  root.appendChild(bindGroup.root);

  return root;
}
