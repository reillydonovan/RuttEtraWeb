// Advanced — clocks, a step sequencer, clock division, gates and an ADSR envelope.
import { bootPattern } from '../lib/helpers.mjs';
import { graphHelpers } from '../lib/graph.mjs';

export const lines = [
  { id: 'intro', text: 'Clocks turn time into events. Add a Clock. It ticks in step with the tempo, which the Timeline sets.' },
  { id: 'seq', text: "Add a Sequencer, and patch the Clock's pulse into its clock input. Every tick advances one step." },
  { id: 'steps', text: 'Each step holds a value. Shape the pattern: a spike on step two, a dip on step four.' },
  { id: 'bind', text: 'Bind the sequencer to Z Push, and the depth steps in rhythm.' },
  { id: 'divide', text: 'Clock divide by N slows a clock down. Here it passes only every fourth tick.' },
  { id: 'env', text: 'Trigger to Gate stretches each tick into a gate. The ADSR envelope turns that gate into a swell and a slow fade.' },
  { id: 'bind2', text: 'Send the envelope to Bloom Intensity: the glow swells once a bar.' },
  { id: 'probe', text: 'Probe the envelope to see its shape: attack, decay, sustain, release.' },
  { id: 'watch', text: 'Restore the window. Stepped depth, and a breathing glow, both locked to the beat.' },
  { id: 'outro', text: 'Change the tempo, and the whole patch follows. Next: feedback, and a little chaos.' },
];
export const poster = 'watch';

export async function pre(page, h) {
  await bootPattern(page);
  const g = graphHelpers(page, h);
  await g.open();
}

export async function run(page, seg, h) {
  const g = graphHelpers(page, h);

  await seg('intro', async () => {
    await h.wait(2600);
    await g.add('Clock');
    await g.place('Clock', 60, 200);
  });

  await seg('seq', async () => {
    await g.add('Sequencer');
    await g.place('Sequencer', 340, 60);
    await g.wire('Clock', 'out', 'Sequencer', 'clock');
  });

  await seg('steps', async () => {
    await g.select('Sequencer');
    await g.param('s2', 1);
    await g.param('s4', -1);
  });

  await seg('bind', async () => {
    await g.bind('zPush', 1.4);
    await h.check(() => document.querySelectorAll('#panel-root .rw-graph-binding').length === 1, 'binding');
  });

  await seg('divide', async () => {
    await g.add('Clock ÷ N');
    await g.place('Clock ÷ N', 340, 300);
    await g.wire('Clock', 'out', 'Clock ÷ N', 'clock');
    await g.select('Clock ÷ N');
    await g.param('divisor', 4);
  });

  await seg('env', async () => {
    await g.add('Trigger → Gate');
    await g.place('Trigger → Gate', 620, 300);
    await g.wire('Clock ÷ N', 'out', 'Trigger → Gate', 'in');
    await g.add('Envelope (ADSR)');
    await g.place('Envelope (ADSR)', 900, 260);
    await g.wire('Trigger → Gate', 'out', 'Envelope (ADSR)', 'gate');
    await g.select('Envelope (ADSR)');
    await g.param('attackMs', 400);
    await g.param('releaseMs', 1200);
  });

  await seg('bind2', async () => { await g.bind('bloomIntensity', 2); });

  await seg('probe', async () => {
    await h.click('#panel-root .rw-graph-canvas-toolbar button', 'Probe', { exact: true });
    await h.click(await g.port('Envelope (ADSR)', 'out', 'out'));
    await h.check(() => !!document.querySelector('.rw-graph-probe'), 'probe open');
    await h.wait(3000);
  });

  await seg('watch', async () => {
    await h.click('#panel-root .rw-region-max-btn');
    await h.glide({ x: 980, y: 450 }, 40);
    await h.wait(3500);
  });

  await seg('outro', async () => {});
}
