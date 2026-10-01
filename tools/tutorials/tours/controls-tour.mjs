// Lesson 4 — Finding your way around the Controls panel.
import { bootPattern } from '../lib/helpers.mjs';

export const lines = [
  { id: 'intro', text: 'The Controls panel holds every parameter, in three tabs. Synth shapes the picture.' },
  { id: 'tabs', text: 'I O connects MIDI, audio, OSC, and control voltage. Help holds the manual. Back to Synth.' },
  { id: 'sections', text: 'Each tab is a stack of sections. Click a header to fold a section open or closed.' },
  { id: 'search', text: 'To find anything fast, press slash, or click the search box, and type. Bloom.' },
  { id: 'knob', text: 'Drag a knob up or down to change it. Hold Shift for fine control. Double-click to reset it.' },
  { id: 'range', text: "The small arrow by a knob opens its menu: type an exact value, widen the knob's range, or reset." },
  { id: 'info', text: 'The i button on a section header explains it, and draws what is patched into it right now.' },
  { id: 'clear', text: 'Press Escape in the search box to clear it, and everything folds back the way it was.' },
  { id: 'outro', text: 'Next, we will use these controls to shape the raster itself.' },
];
export const poster = 'info';

export async function pre(page) { await bootPattern(page); }

export async function run(page, seg, h) {
  await seg('intro', async () => {
    await h.wait(2700);
    await h.click('#panel-root .rw-tab[data-tab="synth"]');
  });

  await seg('tabs', async () => {
    await h.click('#panel-root .rw-tab[data-tab="io"]');
    await h.wait(1500);
    await h.click('#panel-root .rw-tab[data-tab="help"]');
    await h.wait(1200);
    await h.click('#panel-root .rw-tab[data-tab="synth"]');
  });

  await seg('sections', async () => {
    await h.section('Virtual Camera');
    await h.wait(1500);
    const head = await h.at('#panel-root .rw-section-head span', 'Virtual Camera', { exact: true });
    await h.click(head);
  });

  await seg('search', async () => {
    await h.click('#panel-root input[placeholder^="Search"]');
    await page.keyboard.type('bloom', { delay: 130 });
    await h.wait(600);
  });

  await seg('knob', async () => {
    const k = await h.at('#panel-root [data-param-key="bloomIntensity"] .rw-knob');
    await h.knob(k, 70, 50);
    await h.wait(900);
    const val = () => document.querySelector('#panel-root [data-param-key="bloomIntensity"] .rw-knob')?.getAttribute('aria-valuenow');
    const turned = await page.evaluate(val);
    await page.mouse.dblclick(k.x, k.y);
    await h.check((t) => document.querySelector('#panel-root [data-param-key="bloomIntensity"] .rw-knob')?.getAttribute('aria-valuenow') !== t,
      'double-click reset bloomIntensity', turned);
  });

  await seg('range', async () => {
    await h.click('#panel-root [data-param-key="bloomIntensity"] .rw-range-menu-btn');
    await h.wait(400);
    const items = ['Set range', 'Reset range', 'Reset value'];
    for (const t of items) { await h.glide(await h.at('#rw-range-menu li', t), 18); await h.wait(450); }
    await page.keyboard.press('Escape');
    await h.click({ x: 1100, y: 70 });
  });

  await seg('info', async () => {
    const btn = await page.evaluate(() => {
      const head = [...document.querySelectorAll('#panel-root .rw-section-head')].find((e) => e.querySelector('span')?.textContent.trim() === 'Color / Post FX');
      const b = head.querySelector('.rw-info-btn').getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    await h.click(btn);
    await h.wait(3000);
    await h.click('.rw-info-close');
  });

  await seg('clear', async () => {
    await h.click('#panel-root input[placeholder^="Search"]');
    await page.keyboard.press('Escape');
  });

  await seg('outro', async () => { await h.glide({ x: 980, y: 420 }, 40); });
}
