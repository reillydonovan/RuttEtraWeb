// Lesson 10 — Patch Bay cables: waveform into Gen 1, Gen 1 into a param; move, unplug.
import { bootPattern } from '../lib/helpers.mjs';
import { findJack } from '../lib/bay.mjs';

export const lines = [
  { id: 'intro', text: 'The Patch Bay is the whole instrument as one hardware faceplate. Maximize it to see more.' },
  { id: 'anatomy', text: 'Along the top, the Sources bus offers signals: waveforms, audio, beats, MIDI, and more. Every parameter has an input jack, a knob, and an output jack.' },
  { id: 'srcin', text: 'Cables run from an output to an input. Drag the triangle wave toward the bottom edge, and the board scrolls with you. Drop it on Function Generator one, the same slot as in the Modulation panel.' },
  { id: 'out', text: 'Now its output. Grab the output jack, and carry it up to H Size.' },
  { id: 'watch', text: 'Restore the window. The raster now stretches in and out with the triangle wave.' },
  { id: 'move', text: 'Back in the bay, grab a cable by its input end to move it. Drop it on V Size.' },
  { id: 'unplug', text: 'Drop a cable in empty space to unplug it.' },
  { id: 'outro', text: 'Cables and the Modulation panel are two views of one patch. Next: nodes.' },
];
export const poster = 'out';

export async function pre(page) { await bootPattern(page); }

const jack = async (page, q) => {
  const p = await page.evaluate(findJack, q);
  if (!p) throw new Error(`no visible jack ${JSON.stringify(q)}`);
  return p;
};

export async function run(page, seg, h) {
  await seg('intro', async () => { await h.wait(2600); await h.click('#rw-left-shell .rw-region-max-btn'); });

  await seg('anatomy', async () => {
    for (const b of ['SINE', 'TRI', 'SAW', 'AUDIO ENV', 'BEAT', 'MIDI CC']) { await h.glide(await jack(page, { bus: b }), 14); await h.wait(250); }
    await h.wait(500);
    const zin = await jack(page, { param: 'Z Push' });
    await h.glide(zin, 30); await h.wait(500);
    await h.glide({ x: zin.x + 4, y: zin.y + 24 }, 15); await h.wait(500);
    await h.glide(await jack(page, { param: 'Z Push', out: true }), 20);
  });

  await seg('srcin', async () => {
    const from = await jack(page, { bus: 'TRI' });
    await h.dragPan(from, { x: 120, y: 1062 }, findJack, { mod: 'FUNCTION GEN 1', srcin: true, margin: 70 });
    await h.check(() => document.querySelector('[data-mod-slot="0"] select.rw-mod-slot-src')?.value === 'triangle', 'gen 1 source = triangle');
  });

  await seg('out', async () => {
    const from = await jack(page, { mod: 'FUNCTION GEN 1', out: true });
    await h.dragPan(from, { x: 520, y: 66 }, findJack, { param: 'H Size', margin: 60 });
    await h.check(() => document.querySelector('[data-mod-slot="0"] select.rw-mod-slot-tgt')?.value === 'hSize', 'gen 1 target = hSize');
  });

  await seg('watch', async () => {
    await h.click('#rw-left-shell .rw-region-max-btn');
    await h.glide({ x: 980, y: 450 }, 40);
    await h.wait(3500);
  });

  await seg('move', async () => {
    await h.click('#rw-left-shell .rw-region-max-btn');
    await h.wait(600);
    await h.drag(await jack(page, { param: 'H Size' }), await jack(page, { param: 'V Size' }), 50);
    await h.check(() => document.querySelector('[data-mod-slot="0"] select.rw-mod-slot-tgt')?.value === 'vSize', 'gen 1 target = vSize');
  });

  await seg('unplug', async () => {
    await h.drag(await jack(page, { param: 'V Size' }), { x: 640, y: 960 }, 50);
    await h.check(() => document.querySelector('[data-mod-slot="0"] select.rw-mod-slot-tgt')?.value === 'none', 'unplugged');
  });

  await seg('outro', async () => { await h.click('#rw-left-shell .rw-region-max-btn'); await h.glide({ x: 980, y: 450 }, 40); });
}
