// Lesson 5 — Shaping the raster: the Display Control Unit.
import { bootPattern } from '../lib/helpers.mjs';

export const lines = [
  { id: 'intro', text: 'The Display Control Unit is the scan processor itself. It decides where every line is drawn.' },
  { id: 'size', text: 'H Size and V Size stretch the raster. H Position and V Position slide it around.' },
  { id: 'depth', text: 'Z Push is depth: how far bright areas lift toward you. Z Bias moves the whole sheet forward or back.' },
  { id: 'rotate', text: 'Rotation turns the raster in its own plane.' },
  { id: 'spin', text: 'V Spin turns it around its vertical axis.' },
  { id: 'lum', text: 'Threshold hides the darkest parts of the picture, so only the brighter areas draw.' },
  { id: 'beam', text: 'Intensity sets the brightness of the beam. Focus softens or sharpens it.' },
  { id: 'outro', text: 'Double-click any knob to put it back. Next: color, glow, and presets.' },
];
export const poster = 'lum';

export async function pre(page, h) {
  await bootPattern(page);
  await page.click('#panel-root .rw-tab[data-tab="synth"]');
  await h.section('Display Control Unit', { scrollOnly: true });
}

const K = (key) => `#panel-root [data-param-key="${key}"] .rw-knob`;

export async function run(page, seg, h) {
  await seg('intro', async () => { await h.wait(2700); await h.glide(await h.at(K('hPos')), 40); });

  await seg('size', async () => {
    await h.knob(await h.at(K('hSize')), 40);
    await h.knob(await h.at(K('vSize')), -30);
    await h.knob(await h.at(K('hPos')), 25);
    await h.wait(400);
    for (const k of ['hSize', 'vSize', 'hPos']) { const p = await h.at(K(k)); await h.glide(p, 15); await page.mouse.dblclick(p.x, p.y); }
  });

  await seg('depth', async () => {
    await h.reveal(K('zPush'), null, 'center');
    await h.knob(await h.at(K('zPush')), 60);
    await h.wait(500);
    await h.knob(await h.at(K('zBias')), 30);
    await h.wait(500);
    const p = await h.at(K('zBias')); await page.mouse.dblclick(p.x, p.y);
  });

  await seg('rotate', async () => {
    await h.reveal(K('rotation'), null, 'center');
    await h.knob(await h.at(K('rotation')), 25);
    await h.wait(900);
    const p = await h.at(K('rotation')); await h.glide(p, 10); await page.mouse.dblclick(p.x, p.y);
  });

  await seg('spin', async () => {
    await h.knob(await h.at(K('vSpin')), 30);
    await h.wait(1600);
    const p = await h.at(K('vSpin')); await h.glide(p, 10); await page.mouse.dblclick(p.x, p.y);
  });

  await seg('lum', async () => {
    await h.reveal(K('threshold'), null, 'center');
    await h.knob(await h.at(K('threshold')), 45, 60);
    await h.wait(1200);
    const p = await h.at(K('threshold')); await page.mouse.dblclick(p.x, p.y);
  });

  await seg('beam', async () => {
    await h.reveal(K('intensity'), null, 'center');
    await h.knob(await h.at(K('intensity')), 40);
    await h.wait(600);
    await h.knob(await h.at(K('focus')), 50);
    await h.wait(900);
    for (const k of ['intensity', 'focus']) { const p = await h.at(K(k)); await h.glide(p, 10); await page.mouse.dblclick(p.x, p.y); }
  });

  await seg('outro', async () => { await h.glide({ x: 980, y: 420 }, 40); });
}
