// Advanced — resonant noise, Param Out, delay, and a feedback loop.
import { bootPattern } from '../lib/helpers.mjs';
import { graphHelpers } from '../lib/graph.mjs';

export const lines = [
  { id: 'intro', text: 'Nodes can feed each other, and they can feed back. Start with Noise: a new random value on every frame.' },
  { id: 'filter', text: 'Raw noise is jittery. A resonant low-pass filter turns it into a slow, rubbery wobble.' },
  { id: 'bind', text: 'Send the filtered noise to H Position, Rotation and Z Push. The raster drifts like it is underwater.' },
  { id: 'paramout', text: "Param Out reads any parameter's live value back into the graph. This one reads Z Push." },
  { id: 'delay', text: 'Delay it by thirty frames, half a second, and scale it up.' },
  { id: 'loop', text: 'Now close the loop: send the delayed copy back into Z Push. The depth chases its own echo. Keep the loop gain below one, or it runs away.' },
  { id: 'probe', text: 'Probe the loop. No two cycles are quite the same.' },
  { id: 'watch', text: 'Restore the window, and let it run.' },
  { id: 'outro', text: 'Feedback is where the strange stuff lives. Keep the amounts small, and nudge. Next: the camera as a modulation source.' },
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
    await g.add('Noise');
    await g.place('Noise', 60, 80);
  });

  await seg('filter', async () => {
    await g.add('Filter (LP/HP/BP)');
    await g.place('Filter (LP/HP/BP)', 320, 80);
    await g.wire('Noise', 'out', 'Filter (LP/HP/BP)', 'in');
    await g.select('Filter (LP/HP/BP)');
    await g.param('cutoffHz', 0.5);
    await g.param('resonance', 0.9);
  });

  await seg('bind', async () => {
    await g.bind('hPos', 0.6);
    await g.bind('rotation', 15);
    await g.bind('zPush', 0.8);
  });

  await seg('paramout', async () => {
    await g.add('Param Out');
    await g.place('Param Out', 60, 300);
  });

  await seg('delay', async () => {
    await g.add('Delay');
    await g.place('Delay', 320, 300);
    await g.wire('Param Out', 'out', 'Delay', 'in');
    await g.select('Delay');
    await g.param('frames', 30);
    await g.add('Scale');
    await g.place('Scale', 580, 300);
    await g.wire('Delay', 'out', 'Scale', 'in');
    await g.select('Scale');
    await g.param('factor', 1.6);
  });

  await seg('loop', async () => {
    await g.bind('zPush', 0.5);
    await h.check(() => document.querySelectorAll('#panel-root .rw-graph-binding').length >= 1, 'loop binding');
  });

  await seg('probe', async () => {
    await h.click('#panel-root .rw-graph-canvas-toolbar button', 'Probe', { exact: true });
    await h.click(await g.port('Scale', 'out', 'out'));
    await h.wait(3000);
  });

  await seg('watch', async () => {
    await h.click('#panel-root .rw-region-max-btn');
    await h.glide({ x: 980, y: 450 }, 40);
    await h.wait(4000);
  });

  await seg('outro', async () => { await h.drag({ x: 880, y: 450 }, { x: 1080, y: 380 }, 90); });
}
