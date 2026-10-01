// Lesson 6 — Color, glow and presets.
import { bootPattern } from '../lib/helpers.mjs';

export const lines = [
  { id: 'intro', text: 'Color and Post FX change how the beam looks on screen, after the scan processor has drawn it.' },
  { id: 'color', text: 'Color Mode picks the phosphor. Amber, like an old terminal. Then back to green.' },
  { id: 'bloom', text: 'Bloom is the phosphor glow. Push the intensity for a hot, blown-out beam.' },
  { id: 'feedback', text: 'Burn-In Feedback leaves trails, like slow phosphor. Turn it on, and move the camera to see them.' },
  { id: 'camera', text: 'In Virtual Camera, Field of View works like a zoom lens.' },
  { id: 'presets', text: 'Presets apply a whole look at once. Heavy Bloom. Lissajous Scope. Classic 1974.' },
  { id: 'outro', text: 'Mix and match, then save your own look in the Presets section. Next: modulation.' },
];
export const poster = 'presets';

export async function pre(page, h) {
  await bootPattern(page);
  await page.click('#panel-root .rw-tab[data-tab="synth"]');
  await h.section('Color / Post FX');
}

const K = (key) => `#panel-root [data-param-key="${key}"] .rw-knob`;

export async function run(page, seg, h) {
  await seg('intro', async () => { await h.wait(2700); await h.glide(await h.at('#panel-root select[data-param-key="colorMode"]'), 40); });

  await seg('color', async () => {
    const sel = await h.at('#panel-root select[data-param-key="colorMode"]');
    await h.choose(sel, null, 'phosphorAmber');
    await h.wait(2200);
    await h.choose(sel, null, 'phosphorGreen');
  });

  await seg('bloom', async () => {
    await h.reveal(K('bloomIntensity'), null, 'center');
    await h.knob(await h.at(K('bloomIntensity')), 70, 60);
  });

  await seg('feedback', async () => {
    await h.reveal('#panel-root .rw-toggle[data-param-key="feedbackEnabled"]', null, 'center');
    await h.click('#panel-root .rw-toggle[data-param-key="feedbackEnabled"]');
    await h.wait(400);
    await h.drag({ x: 850, y: 450 }, { x: 1150, y: 380 }, 80);
    await h.drag({ x: 1150, y: 380 }, { x: 900, y: 470 }, 80);
    await h.click('#panel-root .rw-toggle[data-param-key="feedbackEnabled"]');
    const p = await h.at(K('bloomIntensity')); await h.glide(p, 15); await page.mouse.dblclick(p.x, p.y);
  });

  await seg('camera', async () => {
    await h.section('Virtual Camera');
    await h.reveal(K('cameraFov'), null, 'center');
    await h.knob(await h.at(K('cameraFov')), -50, 50);
    await h.wait(700);
    await h.knob(await h.at(K('cameraFov')), 90, 50);
    await h.wait(500);
    const p = await h.at(K('cameraFov')); await page.mouse.dblclick(p.x, p.y);
  });

  await seg('presets', async () => {
    await h.section('Presets');
    for (const name of ['Heavy Bloom', 'Lissajous Scope', 'Classic 1974']) {
      await h.click('#panel-root .rw-preset-chip', name, { exact: true });
      await h.wait(1900);
    }
  });

  await seg('outro', async () => { await h.glide({ x: 980, y: 420 }, 40); });
}
