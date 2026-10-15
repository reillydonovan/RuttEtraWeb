// Lesson 2 — Windows, tabs and layouts.
import { bootPattern } from '../lib/helpers.mjs';

export const lines = [
  { id: 'intro', text: 'The screen is four windows: left, center, right, and bottom. Each one holds tabs, like a desktop editor.' },
  { id: 'tabs', text: 'The tab strip names what each window shows. Here: the Patch Bay, the Renderer, the Controls, and the Timeline.' },
  { id: 'max', text: "The arrow button in a window's corner maximizes it. Click it again to restore." },
  { id: 'collapse', text: 'The minus button collapses a window down to just its tab strip. Click the strip, or the same button, to bring it back.' },
  { id: 'layout', text: 'The Window menu has layout presets. Tall stacks everything into one column.' },
  { id: 'default', text: 'Default brings back the four-window layout.' },
  { id: 'skin', text: 'Under View, pick a skin. CRT is flat and compact. Hardware turns sliders into knobs. Rack, the default, adds patch cables.' },
  { id: 'text', text: 'Control plus and Control minus change the text size. Control zero resets it.' },
  { id: 'outro', text: 'Rearrange freely. Reset Layout, in the Window menu, always brings you home. Next: sources.' },
];
export const poster = 'skin';

export async function pre(page) { await bootPattern(page); }

export async function run(page, seg, h) {
  await seg('intro', async () => {
    await h.wait(2700);
    for (const p of [{ x: 200, y: 500 }, { x: 980, y: 420 }, { x: 1740, y: 500 }, { x: 980, y: 960 }]) {
      await h.glide(p, 35);
      await h.wait(350);
    }
  });

  await seg('tabs', async () => {
    for (const t of ['PATCH BAY', 'RENDERER', 'CONTROLS', 'TIMELINE']) {
      await h.glide(await h.at('.rw-wtab', t), 30);
      await h.wait(500);
    }
  });

  await seg('max', async () => {
    await h.click('#rw-center-shell .rw-region-max-btn');
    await h.wait(1600);
    await h.click('#rw-center-shell .rw-region-max-btn');
  });

  await seg('collapse', async () => {
    await h.click('#timeline-dock .rw-region-collapse-btn');
    await h.check(() => document.querySelector('#timeline-dock')?.classList.contains('rw-window-collapsed'), 'timeline collapsed');
    await h.wait(1800);
    await h.click('#timeline-dock .rw-region-collapse-btn');
    await h.check(() => !document.querySelector('#timeline-dock')?.classList.contains('rw-window-collapsed'), 'timeline restored');
    await h.wait(600);
  });

  await seg('layout', async () => { await h.menu('WINDOW', 'Layout', 'Tall (everything in one column)'); });

  await seg('default', async () => { await h.menu('WINDOW', 'Layout', 'Default (4-up: bay left, output center)'); });

  await seg('skin', async () => {
    await h.menu('VIEW', 'Skin: CRT (flat)');
    await h.glide({ x: 1740, y: 600 }, 30);
    await h.wait(1500);
    await h.menu('VIEW', 'Skin: Hardware');
    await h.glide({ x: 1740, y: 600 }, 30);
    await h.wait(1500);
    await h.menu('VIEW', 'Skin: Rack (patch cables)');
  });

  await seg('text', async () => {
    await page.keyboard.press('Control+Equal');
    await h.wait(900);
    await page.keyboard.press('Control+Equal');
    await h.wait(1200);
    await page.keyboard.press('Control+0');
  });

  await seg('outro', async () => { await h.glide({ x: 980, y: 420 }, 40); });
}
