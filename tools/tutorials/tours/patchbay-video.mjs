// Lesson 12 — Video routing: file + Pattern Generator through Composite into the Renderer.
import { bootPattern } from '../lib/helpers.mjs';
import { findJack, findModule, scrollToModule } from '../lib/bay.mjs';

export const lines = [
  { id: 'intro', text: 'The Patch Bay also routes the picture itself. Video cables are magenta.' },
  { id: 'file', text: "Load a video into Video Source A, with its File button." },
  { id: 'preview', text: 'Open its preview to check that it is playing.' },
  { id: 'pattern', text: "Now patch the Pattern Generator's video output into Composite's B input." },
  { id: 'blend', text: 'Set the Composite blend to Screen, so both pictures show.' },
  { id: 'renderer', text: "Finally, patch Composite's output into the Renderer's input." },
  { id: 'result', text: 'Restore the window. The raster now carries both pictures at once.' },
  { id: 'outro', text: 'Video Source B and Dual Raster patch the same way. From here, everything is one cable away.' },
];
export const poster = 'result';

export async function pre(page, h) {
  await bootPattern(page);
  await page.click('#rw-left-shell .rw-region-max-btn');
  await h.wait(600);
}

const jack = async (page, q) => {
  const p = await page.evaluate(findJack, q);
  if (!p) throw new Error(`no visible jack ${JSON.stringify(q)}`);
  return p;
};
const inModule = (page, title, sel, text) => page.evaluate(([t, s, x]) => {
  const m = [...document.querySelectorAll('.rw-pb-module')].find((e) => e.querySelector('.rw-pb-module-head')?.textContent.trim().startsWith(t));
  const el = [...m.querySelectorAll(s)].find((e) => x == null || e.textContent.trim() === x);
  const b = el.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}, [title, sel, text ?? null]);

export async function run(page, seg, h) {
  await seg('intro', async () => {
    await h.wait(2600);
    await h.glide(await jack(page, { mod: 'VIDEO SOURCE A', out: true }), 30);
    await page.evaluate(scrollToModule, 'COMPOSITE');
    await h.settle();
    await h.glide(await jack(page, { mod: 'COMPOSITE', row: 'A' }), 30);
    await page.evaluate(() => document.querySelector('.rw-patchbay').scrollTo({ top: 0, behavior: 'smooth' }));
    await h.settle();
  });

  await seg('file', async () => {
    const chooser = page.waitForEvent('filechooser');
    await h.click(await inModule(page, 'VIDEO SOURCE A', 'button', 'FILE'));
    await (await chooser).setFiles(h.fixtures.clip);
    await h.wait(800);
  });

  await seg('preview', async () => {
    await h.click(await inModule(page, 'VIDEO SOURCE A', '.rw-pb-preview-toggle'));
  });

  await seg('pattern', async () => {
    await page.evaluate(scrollToModule, 'PATTERN GENERATOR');
    await h.settle();
    const from = await jack(page, { mod: 'PATTERN GENERATOR', out: true });
    const to = await page.evaluate(findJack, { mod: 'COMPOSITE', row: 'B', margin: 60 });
    if (to) await h.drag(from, to, 55);
    else await h.dragPan(from, { x: 1700, y: 1062 }, findJack, { mod: 'COMPOSITE', row: 'B', margin: 70 });
    await h.check(() => {
      const m = [...document.querySelectorAll('.rw-pb-module')].find((e) => e.querySelector('.rw-pb-module-head')?.textContent.trim().startsWith('PATTERN GENERATOR'));
      return m?.querySelector('.rw-rack-jack--out')?.classList.contains('rw-rack-jack--plugged');
    }, 'pattern OUT patched');
  });

  await seg('blend', async () => {
    await h.choose(await inModule(page, 'COMPOSITE', 'select'), null, 'screen');
  });

  await seg('renderer', async () => {
    await page.evaluate(scrollToModule, 'COMPOSITE');
    await h.settle();
    const to = await page.evaluate(findJack, { mod: 'RENDERER', row: 'IN', margin: 60 });
    const from = await jack(page, { mod: 'COMPOSITE', out: true });
    if (to) await h.drag(from, to, 45);
    else await h.dragPan(from, { x: 1700, y: 1062 }, findJack, { mod: 'RENDERER', row: 'IN', margin: 70 });
  });

  await seg('result', async () => {
    await h.click('#rw-left-shell .rw-region-max-btn');
    await h.glide({ x: 980, y: 450 }, 40);
    await h.wait(3000);
  });

  await seg('outro', async () => { await h.drag({ x: 900, y: 450 }, { x: 1080, y: 400 }, 90); });
  void findModule;
}
