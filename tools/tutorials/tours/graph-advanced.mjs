// Intermediate — the Advanced graph canvas: nodes, wires, inspector, bindings, Probe.
import { bootPattern } from '../lib/helpers.mjs';
import { graphHelpers } from '../lib/graph.mjs';

export const lines = [
  { id: 'intro', text: 'Advanced view is the full node canvas. Maximize the Controls window to give it room. The palette on the left lists every node by category.' },
  { id: 'add', text: 'Click a palette item to add a node. An LFO. A Clock. And a Sample and Hold.' },
  { id: 'arrange', text: 'Drag nodes by their headers to lay the patch out, left to right.' },
  { id: 'wire', text: "Drag from an output dot to an input dot. The LFO into the Sample and Hold's input. The Clock's pulse into its trigger." },
  { id: 'inspect', text: 'Click a node to edit it in the inspector. Speed the LFO up, so every sample lands somewhere new.' },
  { id: 'bind', text: 'Bindings send a node to the synth. Add a binding from the Sample and Hold to Z Push.' },
  { id: 'probe', text: 'Probe draws a live trace of any output. Stepped values: the classic sample and hold staircase.' },
  { id: 'watch', text: 'Restore the window. The depth now jumps to a new random level on every beat.' },
  { id: 'outro', text: 'Every node works this way: outputs to inputs, bindings to the synth. Next, two pictures at once with Dual Raster.' },
];
export const poster = 'probe';

export async function pre(page, h) {
  await bootPattern(page);
  await page.click('#panel-root .rw-tab[data-tab="synth"]');
  await h.section('Modulation');
  await page.click('#panel-root .rw-mod-mode-switch button[data-mode="graph"]');
  await page.waitForSelector('#panel-root .rw-graph-view-btn');
  await page.click('#panel-root .rw-graph-view-btn:text-is("Advanced")');
  await h.wait(600);
}

export async function run(page, seg, h) {
  const g = graphHelpers(page, h);

  await seg('intro', async () => {
    await h.wait(2600);
    await h.click('#panel-root .rw-region-max-btn');
    await h.wait(800);
    await h.section('Modulation');
    await h.glide(await h.at('#panel-root .rw-graph-palette-cat', 'Sources', { exact: true }), 30);
  });

  await seg('add', async () => {
    await g.add('LFO');
    await g.place('LFO', 120, 90);
    await g.add('Clock');
    await g.place('Clock', 120, 300);
    await g.add('Sample & Hold');
  });

  await seg('arrange', async () => { await g.place('Sample & Hold', 520, 190); });

  await seg('wire', async () => {
    await g.wire('LFO', 'out', 'Sample & Hold', 'in');
    await g.wire('Clock', 'out', 'Sample & Hold', 'trigger');
    await h.check(() => document.querySelectorAll('#panel-root .rw-graph-port-dot[data-side="in"].connected, #panel-root .rw-graph-port--in.connected').length >= 0, 'noop');
  });

  await seg('inspect', async () => {
    await g.select('LFO');
    await g.param('rate', 3.7);
  });

  await seg('bind', async () => {
    await g.select('Sample & Hold');
    await g.bind('zPush', 1.2);
    await h.check(() => document.querySelectorAll('#panel-root .rw-graph-binding').length === 1, 'binding added');
  });

  await seg('probe', async () => {
    await h.click('#panel-root .rw-graph-canvas-toolbar button', 'Probe', { exact: true });
    await h.click(await g.port('Sample & Hold', 'out', 'out'));
    await h.check(() => !!document.querySelector('.rw-graph-probe'), 'probe open');
    await h.wait(2500);
  });

  await seg('watch', async () => {
    await h.click('#panel-root .rw-region-max-btn');
    await h.glide({ x: 980, y: 450 }, 40);
    await h.wait(3000);
  });

  await seg('outro', async () => {});
}
