/**
 * MIDI section UI.
 *
 * - Device pickers for input + output (populated from MidiManager).
 * - Clock indicator: smoothed BPM + a flashing dot driven by `beatPulse`.
 * - Learn table for MidiBindings using the shared LearnBinding widget.
 * - "Map a control" affordance is built into the learn table.
 *
 * In Safari (no Web MIDI), the section renders an explainer with a link to
 * a documented workaround (use the WebMIDIBrowser polyfill) and disables
 * everything else.
 */

import { MidiBinding, SettingsStore } from '../../state/Settings';
import { MidiManager } from '../../midi/MidiManager';
import { describeBindingSource } from '../../midi/MidiMapping';
import { group, row, button, toggle } from '../widgets';
import { createLearnTable } from '../widgets/LearnBinding';
import { TARGET_OPTIONS } from '../targets';

export function createMidiSection(settings: SettingsStore, midi: MidiManager): HTMLElement {
  const root = document.createElement('div');

  if (!midi.available) {
    const note = document.createElement('div');
    note.className = 'rw-readout';
    note.textContent =
      'Web MIDI is not available in this browser. Use Chrome, Edge, or Opera. ' +
      'Safari users can install the "WebMIDIBrowser" extension for partial support.';
    root.appendChild(note);
    return root;
  }

  // Device pickers
  const devGroup = group('Devices');

  const inputSel = document.createElement('select');
  inputSel.className = 'rw-select';
  const outputSel = document.createElement('select');
  outputSel.className = 'rw-select';

  function refreshDevices(): void {
    const state = midi.getState();
    rebuildSelect(inputSel,  state.inputs.map((d) => ({ value: d.id, label: d.name ?? d.id })),  settings.get('midiInputId'));
    rebuildSelect(outputSel, state.outputs.map((d) => ({ value: d.id, label: d.name ?? d.id })), settings.get('midiOutputId'));
  }

  inputSel.addEventListener('change',  () => settings.set('midiInputId',  inputSel.value));
  outputSel.addEventListener('change', () => settings.set('midiOutputId', outputSel.value));

  const enableBtn = button('Connect MIDI', async () => {
    const ok = await midi.ensure();
    enableBtn.textContent = ok ? 'Connected' : 'Denied';
    enableBtn.classList.toggle('primary', ok);
    refreshDevices();
  }, 'primary');

  midi.subscribe(() => refreshDevices());
  refreshDevices();

  devGroup.body.appendChild(enableBtn);
  devGroup.body.appendChild(row('Input',  inputSel));
  devGroup.body.appendChild(row('Output', outputSel));
  root.appendChild(devGroup.root);

  // Clock indicator
  const clockGroup = group('Clock');
  const clockRow = document.createElement('div');
  clockRow.className = 'rw-status';
  const dot = document.createElement('span');
  dot.className = 'rw-status-dot';
  const bpmEl = document.createElement('span');
  bpmEl.textContent = '— BPM';
  const transportEl = document.createElement('span');
  transportEl.textContent = '(stopped)';
  clockRow.append(dot, bpmEl, transportEl);
  clockGroup.body.appendChild(clockRow);

  midi.clock.subscribe((s) => {
    bpmEl.textContent = midi.clock.receiving ? `${s.bpm.toFixed(1)} BPM` : '— BPM';
    transportEl.textContent = `(${s.transport})`;
  });
  // Flash on beat
  setInterval(() => {
    dot.classList.toggle('on', midi.clock.beatPulse > 0.3);
  }, 30);
  // v22: clock OUT — send 24-PPQ 0xF8 from the shared Tempo (internalBpm)
  // on the selected output. Re-armed each session (forced off on load).
  clockGroup.body.appendChild(
    row('Clock Out', toggle(settings, 'midiClockOutEnabled', 'send 24-PPQ clock at Tempo BPM')),
  );
  root.appendChild(clockGroup.root);

  // Bindings
  const bindGroup = group('Bindings');
  const table = createLearnTable<MidiBinding>({
    list: () => settings.get('midiBindings'),
    describeSource: (b) => describeBindingSource(b),
    learn: async (target) => midi.mapping.learn(target),
    update: (id, patch) => midi.mapping.updateBinding(id, patch),
    remove: (id) => midi.mapping.removeBinding(id),
    isLearning: () => midi.mapping.isLearning(),
    cancelLearn: () => midi.mapping.cancelLearn(),
    subscribe: (fn) => midi.mapping.subscribe(fn),
    targetOptions: TARGET_OPTIONS,
  });
  bindGroup.body.appendChild(table);
  root.appendChild(bindGroup.root);

  return root;
}

function rebuildSelect(sel: HTMLSelectElement, opts: { value: string; label: string }[], current: string): void {
  sel.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = ''; empty.textContent = '— none —';
  sel.appendChild(empty);
  for (const o of opts) {
    const opt = document.createElement('option');
    opt.value = o.value; opt.textContent = o.label;
    sel.appendChild(opt);
  }
  sel.value = current;
}
