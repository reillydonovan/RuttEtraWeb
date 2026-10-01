// Intermediate — render modes and the full Post FX chain.
import { bootPattern } from '../lib/helpers.mjs';

export const lines = [
  { id: 'intro', text: 'Beyond bloom and color, Geometry and Post FX change the whole character of the beam.' },
  { id: 'geometry', text: 'Geometry sets how the raster is drawn. Wireframe makes it a solid mesh. Dot Raster draws only the points.' },
  { id: 'tint', text: 'Custom Tint picks any phosphor color you like. Magenta, for a start.' },
  { id: 'feedback', text: 'Burn-In Feedback leaves trails. Its shape can be a circle, so only the middle of the frame smears. Move the camera to paint with it.' },
  { id: 'analog', text: 'Analog Character adds grain, dropouts and a rolling hum bar, like a tired old monitor.' },
  { id: 'lens', text: 'Chromatic aberration splits the colors at the edges. Scanlines and a vignette finish the CRT look.' },
  { id: 'outro', text: 'Each effect has its own on switch, and every slider can be modulated. Next: saving and sharing your work.' },
];
export const poster = 'feedback';

export async function pre(page, h) {
  await bootPattern(page);
  await page.click('#panel-root .rw-tab[data-tab="synth"]');
  await h.wait(400);
}

const K = (key) => `#panel-root [data-param-key="${key}"] .rw-knob`;
const T = (key) => `#panel-root .rw-toggle[data-param-key="${key}"]`;

export async function run(page, seg, h) {
  await seg('intro', async () => { await h.wait(2700); await h.section('Geometry'); });

  await seg('geometry', async () => {
    const sel = await h.at('#panel-root select[data-param-key="renderMode"]');
    await h.choose(sel, null, 'wireframe');
    await h.glide({ x: 980, y: 450 }, 30);
    await h.wait(1800);
    await h.choose(await h.at('#panel-root select[data-param-key="renderMode"]'), null, 'dots');
    await h.glide({ x: 980, y: 450 }, 30);
    await h.wait(1800);
    await h.choose(await h.at('#panel-root select[data-param-key="renderMode"]'), null, 'scanlines');
  });

  await seg('tint', async () => {
    await h.section('Color / Post FX');
    await h.choose(await h.at('#panel-root select[data-param-key="colorMode"]'), null, 'phosphorCustom');
    await h.wait(300);
    const c = await h.at('#panel-root input[type=color][data-param-key="customTint"]');
    await h.glide(c, 25);
    await page.evaluate(() => {
      const i = document.querySelector('#panel-root input[type=color][data-param-key="customTint"]');
      i.value = '#ff3cf0';
      i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await h.glide({ x: 980, y: 450 }, 30);
  });

  await seg('feedback', async () => {
    await h.click(T('feedbackEnabled'));
    await h.wait(300);
    await h.choose(await h.at('#panel-root select[data-param-key="feedbackShape"]'), null, 'circle');
    await h.knob(await h.at(K('feedbackDecay')), 30, 30);
    await h.drag({ x: 850, y: 450 }, { x: 1150, y: 380 }, 90);
    await h.drag({ x: 1150, y: 380 }, { x: 880, y: 500 }, 90);
  });

  await seg('analog', async () => {
    await h.click(T('feedbackEnabled'));
    await h.click(T('analogEnabled'));
    await h.wait(300);
    await h.knob(await h.at(K('analogNoise')), 40, 30);
    await h.knob(await h.at(K('analogHum')), 50, 30);
    await h.glide({ x: 980, y: 450 }, 30);
    await h.wait(1200);
  });

  await seg('lens', async () => {
    await h.click(T('chromaEnabled'));
    await h.knob(await h.at(K('chromaAmount')), 60, 30);
    await h.click(T('scanlineEnabled'));
    await h.click(T('vignetteEnabled'));
    await h.glide({ x: 980, y: 450 }, 30);
  });

  await seg('outro', async () => { await h.drag({ x: 880, y: 450 }, { x: 1080, y: 400 }, 90); });
}
