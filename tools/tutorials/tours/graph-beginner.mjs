// Intermediate — Graph mode, Beginner view, and the patch Library.
import { bootPattern } from '../lib/helpers.mjs';

export const lines = [
  { id: 'intro', text: 'Generators mode gives you four function generators. Graph mode is a node engine with more than fifty node types. Switch the Modulation section to Graph.' },
  { id: 'add', text: 'Beginner view looks like the function generators, but each row is a real node with a binding. Click Add patch: an LFO into Z Push.' },
  { id: 'noise', text: 'Change its source to Noise. White noise jitters the depth on every frame.' },
  { id: 'target', text: 'Point it at Rotation instead, and turn the amount up. Now the whole raster shivers.' },
  { id: 'ramp', text: 'Add a second row. A Ramp, sweeping H Size from narrow to wide, over and over.' },
  { id: 'library', text: 'The Library holds ready-made patches. Load Getting Started, a slow breathing depth with a note explaining it.' },
  { id: 'both', text: 'Both mode runs the function generators and the graph together, so switching never throws your patches away.' },
  { id: 'outro', text: 'Beginner view covers simple one-to-one patches. Next, the Advanced canvas, where nodes feed each other.' },
];
export const poster = 'target';

export async function pre(page, h) {
  await bootPattern(page);
  await page.click('#panel-root .rw-tab[data-tab="synth"]');
  await h.section('Modulation');
}

const lastRow = '#panel-root .rw-beginner-view .rw-mod-slot:last-of-type';

export async function run(page, seg, h) {
  await seg('intro', async () => {
    await h.wait(2700);
    await h.click('#panel-root .rw-mod-mode-switch button[data-mode="graph"]');
    await h.check(() => !!document.querySelector('#panel-root .rw-beginner-view'), 'graph pane loaded');
  });

  await seg('add', async () => {
    await h.click('#panel-root .rw-beginner-footer button.rw-btn', '+ Add patch', { exact: true });
    await h.check(() => document.querySelectorAll('#panel-root .rw-beginner-view .rw-mod-slot').length === 1, 'row added');
  });

  await seg('noise', async () => {
    await h.choose(await h.at(`${lastRow} select.rw-mod-slot-src`), null, 'noise');
  });

  await seg('target', async () => {
    await h.choose(await h.at(`${lastRow} select.rw-mod-slot-tgt`), null, 'rotation');
    await h.wait(400);
    await h.knob(await h.at(`${lastRow} .rw-mod-slot-amount .rw-knob`), 3, 20);
    await h.glide({ x: 980, y: 450 }, 40);
  });

  await seg('ramp', async () => {
    await h.click('#panel-root .rw-beginner-footer button.rw-btn', '+ Add patch', { exact: true });
    await h.wait(400);
    await h.choose(await h.at(`${lastRow} select.rw-mod-slot-src`), null, 'ramp');
    await h.wait(300);
    await h.choose(await h.at(`${lastRow} select.rw-mod-slot-tgt`), null, 'hSize');
    await h.glide({ x: 980, y: 450 }, 40);
  });

  await seg('library', async () => {
    await h.click('#panel-root .rw-graph-library-btn');
    await h.wait(600);
    await h.click('#panel-root .rw-graph-library-card', 'Getting Started');
    await h.check(() => [...document.querySelectorAll('#panel-root .rw-beginner-view .rw-mod-slot')].length >= 1, 'patch loaded');
    await h.click('#panel-root .rw-graph-library-btn');
  });

  await seg('both', async () => {
    await h.click('#panel-root .rw-mod-mode-switch button[data-mode="both"]');
    await h.glide({ x: 980, y: 450 }, 40);
  });

  await seg('outro', async () => {});
}
