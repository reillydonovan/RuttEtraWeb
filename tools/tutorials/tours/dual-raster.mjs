// Intermediate — Dual Raster: two independent rasters on one screen.
import { findJack, scrollToModule } from '../lib/bay.mjs';

export const fakeMedia = true;

export const lines = [
  { id: 'intro', text: 'Dual Raster draws a second, independent raster alongside the first, like the two-channel scan processors of the seventies. Here the source is a camera.' },
  { id: 'enable', text: 'Open the Dual Raster section and switch on raster B.' },
  { id: 'trace', text: 'Trace splits the frame between the two. Sweep it across: A on one side, B on the other.' },
  { id: 'bparams', text: 'Raster B has its own geometry. Push its depth the other way, and turn it.' },
  { id: 'alternate', text: 'Alternate lines interleaves them instead. Every other scan line belongs to B.' },
  { id: 'patch', text: "B still shows the camera. In the Patch Bay, give it a picture of its own: the Pattern Generator's output into Dual Raster's B input." },
  { id: 'route', text: "Then the Dual Raster's output into the Renderer." },
  { id: 'result', text: 'Restore the window. The camera and the pattern now share one raster, line by line.' },
  { id: 'outro', text: 'Each raster can take a camera, a file, a stream, a pattern, or a composite of two. Next, sound.' },
];
export const poster = 'result';

export async function pre(page, h) {
  await page.click('#boot-webcam');
  await page.waitForTimeout(2000);
  await page.click('#panel-root .rw-tab[data-tab="synth"]');
}

const K = (key) => `#panel-root [data-param-key="${key}"] .rw-knob`;
const jack = async (page, q) => {
  const p = await page.evaluate(findJack, q);
  if (!p) throw new Error(`no visible jack ${JSON.stringify(q)}`);
  return p;
};

export async function run(page, seg, h) {
  await seg('intro', async () => { await h.wait(2700); await h.glide({ x: 980, y: 450 }, 40); });

  await seg('enable', async () => {
    await h.section('Dual Raster');
    await h.click('#panel-root .rw-toggle[data-param-key="dualRasterEnabled"]');
    await h.check(() => document.querySelector('#panel-root .rw-toggle[data-param-key="dualRasterEnabled"] input')?.checked, 'dual on');
  });

  await seg('trace', async () => {
    const k = await h.at(K('dualTracePos'));
    await h.knob(k, 80, 60);
    await h.wait(600);
    await h.knob(await h.at(K('dualTracePos')), -40, 50);
  });

  await seg('bparams', async () => {
    await h.knob(await h.at(K('bZPush')), -40, 50);
    await h.wait(400);
    await h.knob(await h.at(K('bRotation')), 25, 40);
  });

  await seg('alternate', async () => {
    await h.choose(await h.at('#panel-root select[data-param-key="dualMode"]'), null, 'alternate');
    await h.glide({ x: 980, y: 450 }, 40);
  });

  await seg('patch', async () => {
    await h.click('#rw-left-shell .rw-region-max-btn');
    await h.wait(700);
    await page.evaluate(scrollToModule, 'PATTERN GENERATOR');
    await h.settle();
    const from = await jack(page, { mod: 'PATTERN GENERATOR', out: true });
    await h.dragPan(from, { x: 900, y: 66 }, findJack, { mod: 'DUAL RASTER', row: 'B', margin: 60 });
  });

  await seg('route', async () => {
    const from = await jack(page, { mod: 'DUAL RASTER', out: true });
    const to = await page.evaluate(findJack, { mod: 'RENDERER', row: 'IN', margin: 60 });
    if (to) await h.drag(from, to, 60);
    else await h.dragPan(from, { x: 1700, y: 1062 }, findJack, { mod: 'RENDERER', row: 'IN', margin: 70 });
  });

  await seg('result', async () => {
    await h.click('#rw-left-shell .rw-region-max-btn');
    await h.glide({ x: 980, y: 450 }, 40);
    await h.wait(2500);
  });

  await seg('outro', async () => { await h.drag({ x: 880, y: 450 }, { x: 1080, y: 400 }, 90); });
}
