// Lesson 3 — Sources: Pattern Generator kinds, then a video file underneath.
import { bootPattern } from '../lib/helpers.mjs';

export const lines = [
  { id: 'intro', text: 'Every picture starts with a source. You can pick one on the start screen, or any time in the Video Source A section of the Controls.' },
  { id: 'tab', text: 'Open the Synth tab. Source is near the top.' },
  { id: 'kind', text: 'The Pattern Generator makes pictures with no camera at all. Change its Kind to try another pattern. Lissajous.' },
  { id: 'kind2', text: 'Spiral. And Worley cells. Each kind brings its own controls, just below.' },
  { id: 'file', text: 'To use your own footage, choose a video file. Webcam, screen capture, and stream URLs work the same way.' },
  { id: 'auto', text: 'The pattern was covering the whole picture, so loading a video switched it off. This is the video alone.' },
  { id: 'layer', text: 'Turn the pattern back on, and set Blend to Screen. Now both show through.' },
  { id: 'outro', text: 'Any source can feed the raster. Next, we will find our way around the Controls panel.' },
];
export const poster = 'layer';

export async function pre(page) { await bootPattern(page); }

/** Point at the Pattern Generator group's Kind select. */
async function kindSelect(page) {
  return page.evaluate(() => {
    const g = [...document.querySelectorAll('#panel-root .rw-group')].find((e) => e.querySelector('.rw-group-head')?.textContent.trim() === 'Pattern Generator');
    const r = [...g.querySelectorAll('.rw-row')].find((e) => e.querySelector('.rw-label')?.textContent.trim() === 'Kind');
    const b = r.querySelector('select').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
}

export async function run(page, seg, h) {
  await seg('intro', async () => { await h.wait(2700); await h.glide({ x: 180, y: 300 }, 40); });

  await seg('tab', async () => {
    await h.click('#panel-root .rw-tab[data-tab="synth"]');
    await h.wait(500);
    await h.section('Video Source A');
    await page.evaluate(() => {
      const g = [...document.querySelectorAll('#panel-root .rw-group-head')].find((e) => e.textContent.trim() === 'Pattern Generator');
      g?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    await h.wait(900);
  });

  await seg('kind', async () => {
    await h.wait(2600);
    await h.choose(await kindSelect(page), null, 'lissajous');
  });

  await seg('kind2', async () => {
    await h.choose(await kindSelect(page), null, 'spiral');
    await h.wait(1800);
    await h.choose(await kindSelect(page), null, 'worleyNoise');
  });

  await seg('file', async () => {
    await page.evaluate(() => {
      const l = [...document.querySelectorAll('#panel-root .rw-label')].find((e) => e.textContent.trim() === 'File');
      l?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    await h.wait(900);
    const pt = await h.row('File', 'input[type=file]');
    const chooser = page.waitForEvent('filechooser');
    await h.click(pt);
    await (await chooser).setFiles(h.fixtures.clip);
    await h.wait(800);
  });

  await seg('auto', async () => {
    await h.check(() => !document.querySelector('#panel-root .rw-toggle[data-param-key="patternEnabled"] input')?.checked, 'pattern auto-off');
    await h.glide({ x: 980, y: 450 }, 40);
  });

  await seg('layer', async () => {
    await page.evaluate(() => {
      const g = [...document.querySelectorAll('#panel-root .rw-group-head')].find((e) => e.textContent.trim() === 'Pattern Generator');
      g?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    await h.settle();
    await h.click('#panel-root .rw-toggle[data-param-key="patternEnabled"]');
    await h.wait(700);
    await h.choose(await h.at('#panel-root select[data-param-key="patternBlendMode"]'), null, 'screen');
  });

  await seg('outro', async () => { await h.glide({ x: 980, y: 420 }, 40); });
}
